// The Weasel — a hidden-saboteur game.
// One secret Weasel. Crew plays phone missions to grow the pot; the Weasel drains it.
// After each mission everyone takes a quiz about the Weasel. Lowest crew score is out.
// Final round: best quiz score wins the pot, then the Weasel is unmasked.

const { shuffle } = require('../util');
const { TRIVIA, SYNC, ESTIMATE } = require('../weasel-content');

const MISSIONS = {
  trivia: {
    title: 'Brain Trust',
    rules: 'Everyone answers the same trivia question alone. No talking. $1,000 to the pot for every correct answer.'
  },
  sync: {
    title: 'Mind Meld',
    rules: 'No talking. Pick the answer you think the whole group will pick. Everyone matches: $5,000. 75%+ match: $2,000.'
  },
  estimate: {
    title: 'Ballpark',
    rules: 'Everyone guesses a number. Group average within 10% of the real answer: $5,000. Within 25%: $2,000.'
  },
  vault: {
    title: 'The Vault',
    rules: 'A random team cracks the vault in secret. Each member picks Crack or Jam. Zero jams: $5,000. One jam and the vault stays shut.'
  }
};
const BIG = 5000, MID = 2000, PER_CORRECT = 1000;
const QUIZ_LEN = 5;
const NO_ANSWER_TIME = 10 * 60 * 1000;

let io = null;
function init(socketIo) { io = socketIo; }

function defaultSettings() { return { rounds: 5, eliminations: true }; }
function sanitizeSettings(s) {
  s = s || {};
  const rounds = Math.min(8, Math.max(2, parseInt(s.rounds, 10) || 5));
  return { rounds, eliminations: s.eliminations !== false };
}

const crewAlive = (r) => r.alive.filter(id => id !== r.weaselId);
const isFinalRound = (r) => r.roundNum >= r.maxRounds || (r.eliminations && crewAlive(r).length <= 2);
const requiredIds = (r) => {
  if (!r.mission) return [];
  if (r.mission.type === 'vault') return r.mission.teamIds.filter(id => r.alive.includes(id));
  return r.alive.slice();
};
const socketOf = (room, id) => { const p = room.players.find(x => x.id === id); return p && p.socketId; };

function pickUnused(pool, used) {
  let avail = pool.map((_, i) => i).filter(i => !used.includes(i));
  if (!avail.length) { used.length = 0; avail = pool.map((_, i) => i); }
  const i = avail[Math.floor(Math.random() * avail.length)];
  used.push(i);
  return pool[i];
}

// ---------- lifecycle ----------

function start(room) {
  const ids = room.players.map(p => p.id);
  const weaselId = shuffle(ids)[0];
  const s = sanitizeSettings(room.settings.weasel);
  let maxRounds = s.rounds;
  // With eliminations, leave at least 2 crew for the final round.
  if (s.eliminations) maxRounds = Math.min(maxRounds, ids.length - 2);
  maxRounds = Math.max(1, maxRounds);

  room.round = {
    game: 'weasel',
    phase: 'reveal',
    weaselId,
    eliminations: s.eliminations,
    names: Object.fromEntries(room.players.map(p => [p.id, p.name])),
    joinOrder: ids.slice(),
    startHostId: room.hostId,
    alive: ids.slice(),
    eliminatedIds: [],
    roundNum: 0,
    maxRounds,
    pot: 0,
    maxPot: 0,
    queue: [],
    used: { trivia: [], sync: [], estimate: [] },
    mission: null,
    submissions: {},
    lastResult: null,
    facts: [],
    history: [],
    quizzes: {},
    quizSubs: {},
    quizStart: 0,
    totals: {},
    lastScores: null,
    lastElimId: null,
    winnerId: null,
    standings: null,
    endReason: null
  };
  room.phase = 'playing';
  room.players.forEach(p => sendRole(room, p.id));
}

function sendRole(room, id) {
  const r = room.round;
  const sid = socketOf(room, id);
  if (!sid) return;
  io.to(sid).emit('your_role', { game: 'weasel', role: id === r.weaselId ? 'weasel' : 'crew' });
}

function sendQuiz(room, id) {
  const r = room.round;
  const sid = socketOf(room, id);
  if (!sid || !r.quizzes[id]) return;
  io.to(sid).emit('your_quiz', {
    round: r.roundNum,
    questions: r.quizzes[id].map(q => ({ q: q.q, options: q.options }))
  });
}

function resendPrivate(room, id) {
  const r = room.round;
  if (!r) return;
  sendRole(room, id);
  if (r.phase === 'quiz' && r.alive.includes(id) && !r.quizSubs[id]) sendQuiz(room, id);
}

function nextRound(room) {
  const r = room.round;
  r.roundNum++;
  if (!r.queue.length) {
    r.queue = shuffle(Object.keys(MISSIONS));
    if (r.mission && r.queue[0] === r.mission.type) r.queue.push(r.queue.shift());
  }
  r.mission = buildMission(r, r.queue.shift());
  r.submissions = {};
  r.lastResult = null;
  r.lastElimId = null;
  r.phase = 'intro';
}

function buildMission(r, type) {
  const m = { type, title: MISSIONS[type].title, rules: MISSIONS[type].rules };
  if (type === 'trivia') {
    const item = pickUnused(TRIVIA, r.used.trivia);
    m.question = item.q;
    m.options = shuffle(item.a);
    m.answer = m.options.indexOf(item.a[0]);
  } else if (type === 'sync') {
    const item = pickUnused(SYNC, r.used.sync);
    m.question = item.q;
    m.options = item.a.slice();
  } else if (type === 'estimate') {
    const item = pickUnused(ESTIMATE, r.used.estimate);
    m.question = item.q;
    m.answer = item.answer;
    m.unit = item.unit;
  } else if (type === 'vault') {
    const size = Math.max(2, Math.ceil(r.alive.length / 2));
    m.teamIds = shuffle(r.alive).slice(0, size);
  }
  return m;
}

// ---------- missions ----------

function submit(room, playerId, value) {
  const r = room.round;
  if (!r || r.phase !== 'mission') return;
  if (!requiredIds(r).includes(playerId) || r.submissions[playerId] !== undefined) return;
  const t = r.mission.type;
  if (t === 'trivia' || t === 'sync') {
    const v = parseInt(value, 10);
    if (!(v >= 0 && v < r.mission.options.length)) return;
    r.submissions[playerId] = v;
  } else if (t === 'estimate') {
    const v = parseFloat(String(value).replace(/,/g, ''));
    if (!isFinite(v) || v < 0) return;
    r.submissions[playerId] = v;
  } else if (t === 'vault') {
    if (value !== 'crack' && value !== 'jam') return;
    r.submissions[playerId] = value;
  }
  if (requiredIds(r).every(id => r.submissions[id] !== undefined)) resolveMission(room);
}

function resolveMission(room) {
  const r = room.round;
  const m = r.mission;
  const req = requiredIds(r);
  const subs = r.submissions;
  const w = r.weaselId;
  const wSub = subs[w];
  let earned = 0, possible = BIG;
  const result = { type: m.type, title: m.title };

  if (m.type === 'trivia') {
    const correct = req.filter(id => subs[id] === m.answer).length;
    earned = correct * PER_CORRECT;
    possible = req.length * PER_CORRECT;
    Object.assign(result, { correct, total: req.length, answerText: m.options[m.answer] });
    r.facts.push({ type: 'trivia', round: r.roundNum, answered: wSub !== undefined, correct: wSub === m.answer });
  } else if (m.type === 'sync') {
    const counts = m.options.map((_, i) => req.filter(id => subs[id] === i).length);
    const top = Math.max(...counts);
    const n = req.length || 1;
    if (top === req.length && req.length > 0) earned = BIG;
    else if (top / n >= 0.75) earned = MID;
    Object.assign(result, { counts, options: m.options, question: m.question });
    r.facts.push({ type: 'sync', round: r.roundNum, prompt: m.question, options: m.options, pick: wSub === undefined ? null : wSub });
  } else if (m.type === 'estimate') {
    const vals = req.map(id => subs[id]).filter(v => v !== undefined);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const err = vals.length ? Math.abs(avg - m.answer) / m.answer : Infinity;
    if (err <= 0.10) earned = BIG; else if (err <= 0.25) earned = MID;
    Object.assign(result, { average: Math.round(avg * 10) / 10, answer: m.answer, unit: m.unit, question: m.question, guesses: vals.length });
    let rel = null;
    if (wSub !== undefined) {
      if (Math.abs(wSub - m.answer) / m.answer <= 0.10) rel = 'close';
      else rel = wSub > m.answer ? 'high' : 'low';
    }
    r.facts.push({ type: 'estimate', round: r.roundNum, rel });
  } else if (m.type === 'vault') {
    const jams = req.filter(id => subs[id] === 'jam').length;
    const missing = req.filter(id => subs[id] === undefined).length;
    earned = jams === 0 && missing === 0 ? BIG : 0;
    Object.assign(result, { jams, missing, teamSize: req.length });
    r.facts.push({ type: 'vault', round: r.roundNum, onTeam: m.teamIds.includes(w) });
  }

  r.pot += earned;
  r.maxPot += possible;
  result.earned = earned;
  result.possible = possible;
  r.lastResult = result;
  r.history.push({ round: r.roundNum, title: m.title, earned, possible });
  r.phase = 'mission_result';
}

// ---------- quiz ----------

function factQuestion(f) {
  if (f.type === 'trivia') return {
    q: `Mission ${f.round} (Brain Trust): Did the Weasel get the trivia right?`,
    options: ['Yes', 'No', 'Didn’t answer'],
    correct: () => (!f.answered ? 2 : f.correct ? 0 : 1)
  };
  if (f.type === 'sync') return {
    q: `Mission ${f.round} (Mind Meld — “${f.prompt}”): What did the Weasel pick?`,
    options: [...f.options, 'Didn’t answer'],
    correct: () => (f.pick === null ? f.options.length : f.pick)
  };
  if (f.type === 'estimate') return {
    q: `Mission ${f.round} (Ballpark): The Weasel’s guess was…`,
    options: ['Too high', 'Too low', 'Within 10%', 'Didn’t answer'],
    correct: () => ({ high: 0, low: 1, close: 2 }[f.rel] ?? 3)
  };
  return {
    q: `Mission ${f.round} (The Vault): Was the Weasel on the vault team?`,
    options: ['Yes', 'No'],
    correct: () => (f.onTeam ? 0 : 1)
  };
}

function identityQuestions(r) {
  const name = r.names[r.weaselId] || '';
  const qs = [];
  const first = name.trim().charAt(0).toUpperCase();
  if (/[A-Z]/.test(first)) qs.push({
    q: 'The Weasel’s name starts with a letter from…',
    options: ['A to M', 'N to Z'],
    correct: () => (first <= 'M' ? 0 : 1)
  });
  const len = name.replace(/[^A-Za-z]/g, '').length;
  qs.push({
    q: 'How many letters are in the Weasel’s name?',
    options: ['1–4', '5–6', '7 or more'],
    correct: () => (len <= 4 ? 0 : len <= 6 ? 1 : 2)
  });
  qs.push({
    q: 'Did the Weasel host this game?',
    options: ['Yes', 'No'],
    correct: () => (r.startHostId === r.weaselId ? 0 : 1)
  });
  qs.push({
    q: 'Did the Weasel join the room before or after you?',
    options: ['Before me', 'After me'],
    correct: (pid) => (r.joinOrder.indexOf(r.weaselId) < r.joinOrder.indexOf(pid) ? 0 : 1)
  });
  return qs;
}

function startQuiz(room) {
  const r = room.round;
  const current = r.facts.filter(f => f.round === r.roundNum).map(factQuestion);
  const rest = shuffle([
    ...r.facts.filter(f => f.round !== r.roundNum).map(factQuestion),
    ...identityQuestions(r)
  ]);
  const shared = [...current, ...rest].slice(0, QUIZ_LEN - 1);

  r.quizzes = {};
  r.quizSubs = {};
  r.alive.forEach(pid => {
    const optionIds = shuffle(r.alive.filter(id => id !== pid));
    const who = {
      q: 'Who is the Weasel?',
      options: optionIds.map(id => r.names[id]),
      correct: optionIds.indexOf(r.weaselId)
    };
    r.quizzes[pid] = [who, ...shared.map(s => ({ q: s.q, options: s.options, correct: s.correct(pid) }))];
  });
  r.quizStart = Date.now();
  r.phase = 'quiz';
  r.alive.forEach(pid => sendQuiz(room, pid));
}

function submitQuiz(room, playerId, answers) {
  const r = room.round;
  if (!r || r.phase !== 'quiz' || !r.alive.includes(playerId) || r.quizSubs[playerId]) return;
  if (!Array.isArray(answers)) return;
  r.quizSubs[playerId] = { answers: answers.map(a => parseInt(a, 10)), time: Date.now() - r.quizStart };
  if (r.alive.every(id => r.quizSubs[id])) gradeQuiz(room);
}

function rank(ids, table) {
  return ids.slice().sort((a, b) => (table[b].score - table[a].score) || (table[a].time - table[b].time));
}

function gradeQuiz(room) {
  const r = room.round;
  const scores = {};
  r.alive.forEach(id => {
    const sub = r.quizSubs[id];
    let score = 0;
    if (sub) r.quizzes[id].forEach((q, i) => { if (q.correct >= 0 && sub.answers[i] === q.correct) score++; });
    const time = sub ? sub.time : NO_ANSWER_TIME;
    scores[id] = { score, time };
    r.totals[id] = r.totals[id] || { score: 0, time: 0 };
    r.totals[id].score += score;
    r.totals[id].time += time;
  });
  r.lastScores = scores;
  const crew = crewAlive(r);

  if (isFinalRound(r)) {
    const table = r.eliminations ? scores : r.totals;
    const ranked = rank(crew, table);
    r.winnerId = ranked[0] || null;
    r.standings = ranked.map(id => ({ id, name: r.names[id], score: table[id].score, of: r.eliminations ? QUIZ_LEN : QUIZ_LEN * r.roundNum }));
    r.lastElimId = null;
  } else if (r.eliminations && crew.length) {
    const ranked = rank(crew, scores);
    r.lastElimId = ranked[ranked.length - 1];
  } else {
    r.lastElimId = null;
  }
  r.phase = 'quiz_done';
}

function finish(room, reason) {
  const r = room.round;
  r.endReason = reason || null;
  r.phase = 'final';
}

// ---------- host control ----------

function advance(room) {
  const r = room.round;
  if (!r) return;
  switch (r.phase) {
    case 'reveal': nextRound(room); break;
    case 'intro': r.phase = 'mission'; break;
    case 'mission': resolveMission(room); break;
    case 'mission_result': startQuiz(room); break;
    case 'quiz': gradeQuiz(room); break;
    case 'quiz_done':
      if (isFinalRound(r)) { finish(room); break; }
      if (r.lastElimId) {
        r.alive = r.alive.filter(id => id !== r.lastElimId);
        r.eliminatedIds.push(r.lastElimId);
      }
      r.phase = 'elimination';
      break;
    case 'elimination': nextRound(room); break;
  }
}

function onPlayerRemoved(room, id) {
  const r = room.round;
  if (!r || r.game !== 'weasel' || r.phase === 'final') return;
  if (id === r.weaselId) { finish(room, 'weasel_left'); return; }
  r.alive = r.alive.filter(x => x !== id);
  delete r.submissions[id];
  delete r.quizSubs[id];
  if (!crewAlive(r).length) { finish(room, 'no_crew'); return; }
  if (r.phase === 'mission') {
    const req = requiredIds(r);
    if (!req.length || req.every(x => r.submissions[x] !== undefined)) resolveMission(room);
  } else if (r.phase === 'quiz') {
    if (r.alive.every(x => r.quizSubs[x])) gradeQuiz(room);
  }
}

// ---------- public view ----------

function publicMission(m) {
  if (!m) return null;
  const out = { type: m.type, title: m.title, rules: m.rules, question: m.question, options: m.options, unit: m.unit };
  if (m.type === 'vault') out.teamIds = m.teamIds;
  return out;
}

function publicState(room) {
  const r = room.round;
  const showMission = ['intro', 'mission', 'mission_result'].includes(r.phase);
  const state = {
    game: 'weasel',
    phase: r.phase,
    roundNum: r.roundNum,
    maxRounds: r.maxRounds,
    isFinalRound: isFinalRound(r),
    eliminations: r.eliminations,
    pot: r.pot,
    alive: r.alive,
    eliminatedIds: r.eliminatedIds,
    mission: showMission ? publicMission(r.mission) : null,
    requiredIds: r.phase === 'mission' ? requiredIds(r) : [],
    submittedIds: r.phase === 'mission' ? Object.keys(r.submissions) : [],
    missionResult: r.phase === 'mission_result' ? r.lastResult : null,
    quizSubmittedIds: r.phase === 'quiz' ? Object.keys(r.quizSubs) : [],
    lastElimId: r.phase === 'elimination' ? r.lastElimId : null,
    lastElimName: r.phase === 'elimination' && r.lastElimId ? r.names[r.lastElimId] : null,
    final: null
  };
  if (r.phase === 'final') {
    state.final = {
      weaselId: r.weaselId,
      weaselName: r.names[r.weaselId],
      winnerId: r.winnerId,
      winnerName: r.winnerId ? r.names[r.winnerId] : null,
      pot: r.pot,
      maxPot: r.maxPot,
      history: r.history,
      standings: r.standings || [],
      eliminated: r.eliminatedIds.map(id => r.names[id]),
      endReason: r.endReason
    };
  }
  return state;
}

module.exports = {
  init, defaultSettings, sanitizeSettings, start, advance, submit, submitQuiz,
  resendPrivate, onPlayerRemoved, publicState, MIN_PLAYERS: 4
};
