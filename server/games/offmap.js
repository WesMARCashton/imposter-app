// Off the Map — everyone shares a secret location and gets a job there, except the Weasel.
// Players question each other. Vote out the Weasel before they figure out where you are.

const { shuffle } = require('../util');
const { LOCATIONS } = require('../offmap-content');

const MIN_PLAYERS = 3;
const TIMER_OPTIONS = [0, 5, 8, 10, 15];
let io = null;
let broadcast = () => {};

function init(socketIo, broadcastFn) { io = socketIo; broadcast = broadcastFn; }
function defaultSettings() { return { minutes: 8 }; }
function sanitizeSettings(s) {
  const m = parseInt((s || {}).minutes, 10);
  return { minutes: TIMER_OPTIONS.includes(m) ? m : 8 };
}
const socketOf = (room, id) => { const p = room.players.find(x => x.id === id); return p && p.socketId; };

// Weighted random pick: each time you were the Weasel in the last 4 games cuts your odds by 60%.
// Nobody is ever ruled out, so being picked recently doesn't clear you.
function pickSpy(room, ids) {
  const recent = room.offmapRecentSpies || [];
  const weights = ids.map(id => Math.pow(0.4, recent.filter(x => x === id).length));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < ids.length; i++) {
    roll -= weights[i];
    if (roll < 0) return ids[i];
  }
  return ids[ids.length - 1];
}

function start(room) {
  const ids = room.players.map(p => p.id);
  const spyId = pickSpy(room, ids);
  const pool = LOCATIONS.filter(l => l.name !== room.lastOffmapLocation);
  const loc = pool[Math.floor(Math.random() * pool.length)];
  room.lastOffmapLocation = loc.name;
  room.offmapRecentSpies = [...(room.offmapRecentSpies || []), spyId].slice(-4);

  const jobs = {};
  let deck = shuffle(loc.jobs);
  ids.filter(id => id !== spyId).forEach(id => {
    if (!deck.length) deck = shuffle(loc.jobs);
    jobs[id] = deck.shift();
  });

  const s = sanitizeSettings(room.settings.offmap);
  room.round = {
    game: 'offmap',
    phase: 'reveal',
    spyId,
    location: loc.name,
    jobs,
    names: Object.fromEntries(room.players.map(p => [p.id, p.name])),
    firstAskerId: shuffle(ids)[0],
    minutes: s.minutes,
    endsAt: null,
    timer: null,
    votes: {},
    accusedId: null,
    result: null
  };
  room.phase = 'playing';
  room.players.forEach(p => sendRole(room, p.id));
}

function sendRole(room, id) {
  const r = room.round;
  const sid = socketOf(room, id);
  if (!sid) return;
  const spy = id === r.spyId;
  io.to(sid).emit('your_role', { game: 'offmap', spy, location: spy ? null : r.location, job: spy ? null : r.jobs[id] });
}

function resendPrivate(room, id) { if (room.round) sendRole(room, id); }

function clearTimer(r) { if (r.timer) { clearTimeout(r.timer); r.timer = null; } }

function advance(room) {
  const r = room.round;
  if (!r) return;
  if (r.phase === 'reveal') {
    r.phase = 'play';
    if (r.minutes) {
      r.endsAt = Date.now() + r.minutes * 60 * 1000;
      r.timer = setTimeout(() => {
        if (room.round === r && r.phase === 'play') { r.phase = 'vote'; r.timer = null; broadcast(room.code); }
      }, r.minutes * 60 * 1000);
    }
  } else if (r.phase === 'play') {
    clearTimer(r);
    r.phase = 'vote';
  } else if (r.phase === 'vote') {
    tally(room);
  }
}

function vote(room, playerId, targetId) {
  const r = room.round;
  if (!r || r.phase !== 'vote') return;
  if (!room.players.some(p => p.id === playerId) || !room.players.some(p => p.id === targetId) || playerId === targetId) return;
  r.votes[playerId] = targetId;
  if (room.players.every(p => r.votes[p.id])) tally(room);
}

function tally(room) {
  const r = room.round;
  const counts = {};
  Object.values(r.votes).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
  let max = 0, top = [];
  for (const id in counts) {
    if (counts[id] > max) { max = counts[id]; top = [id]; } else if (counts[id] === max) top.push(id);
  }
  r.voteCounts = counts;
  if (top.length !== 1) return finish(room, 'spy', 'tie');
  r.accusedId = top[0];
  if (top[0] !== r.spyId) return finish(room, 'spy', 'wrong_vote');
  r.phase = 'spy_guess';
}

function spyGuess(room, playerId, location) {
  const r = room.round;
  if (!r || playerId !== r.spyId || !['play', 'spy_guess'].includes(r.phase)) return;
  if (!LOCATIONS.some(l => l.name === location)) return;
  r.spyGuess = location;
  const correct = location === r.location;
  if (r.phase === 'play') finish(room, correct ? 'spy' : 'crew', correct ? 'spy_called_it' : 'spy_guessed_wrong');
  else finish(room, correct ? 'spy' : 'crew', correct ? 'caught_but_guessed' : 'caught');
}

function finish(room, winner, reason) {
  const r = room.round;
  clearTimer(r);
  r.result = { winner, reason };
  r.phase = 'results';
}

function onPlayerRemoved(room, id) {
  const r = room.round;
  if (!r || r.game !== 'offmap' || r.phase === 'results') return;
  if (id === r.spyId) return finish(room, 'crew', 'spy_left');
  delete r.votes[id];
  Object.keys(r.votes).forEach(v => { if (r.votes[v] === id) delete r.votes[v]; });
  if (room.players.length < 2) return finish(room, 'spy', 'no_crew');
  if (r.phase === 'vote' && room.players.every(p => r.votes[p.id])) tally(room);
}

function publicState(room) {
  const r = room.round;
  const s = {
    game: 'offmap',
    phase: r.phase,
    locations: LOCATIONS.map(l => l.name),
    firstAskerId: r.firstAskerId,
    firstAskerName: r.names[r.firstAskerId],
    minutes: r.minutes,
    endsAt: r.endsAt,
    serverNow: Date.now(),
    votedIds: r.phase === 'vote' ? Object.keys(r.votes) : [],
    accusedId: r.phase === 'spy_guess' ? r.accusedId : null,
    accusedName: r.phase === 'spy_guess' ? r.names[r.accusedId] : null,
    result: null
  };
  if (r.phase === 'results') {
    s.result = {
      ...r.result,
      spyId: r.spyId,
      spyName: r.names[r.spyId],
      location: r.location,
      spyGuess: r.spyGuess || null,
      accusedName: r.accusedId ? r.names[r.accusedId] : null,
      roles: Object.keys(r.names).map(id => ({ id, name: r.names[id], job: id === r.spyId ? 'WEASEL' : r.jobs[id], votes: (r.voteCounts || {})[id] || 0 }))
    };
  }
  return s;
}

module.exports = {
  init, defaultSettings, sanitizeSettings, start, advance, vote, spyGuess,
  resendPrivate, onPlayerRemoved, publicState, MIN_PLAYERS, TIMER_OPTIONS
};
