// Hit the Number — imposter game for a real-world game (Bocce, Shuffleboard, ...).
// Everyone gets the same secret target score except the Imposter, who gets nothing.
// Play the real game, then vote. A caught Imposter gets one guess at the number to steal the win.

const { shuffle } = require('../util');

const MIN_PLAYERS = 3;
// Each game's scoring spots. The secret target is one of these. Zero is always possible.
const SPORTS = {
  bocce: { name: 'Bocce', options: ['0', '10', '20', '30', '40', '50'] },
  bullseye: { name: 'Bullseye', options: ['0', 'Front 1', 'Back 1', 'Front 2', 'Back 2', 'Front 3', 'Back 3', '10', '20', '25', 'Bullseye', 'Double'] },
  shuffleboard: { name: 'Shuffleboard', options: ['0', '10', '8 Left', '8 Right', '7 Left', '7 Right', '-10'] },
  shufflealley: { name: 'ShuffleAlley', options: ['0', '1', '2', '3'] }
};

let io = null;
function init(socketIo) { io = socketIo; }

function defaultSettings() { return { sport: 'bocce', imposters: 1 }; }
function sanitizeSettings(s) {
  s = s || {};
  const sport = SPORTS[s.sport] ? s.sport : 'bocce';
  const imposters = [1, 2].includes(parseInt(s.imposters, 10)) ? parseInt(s.imposters, 10) : 1;
  return { sport, imposters };
}

const socketOf = (room, id) => { const p = room.players.find(x => x.id === id); return p && p.socketId; };

function start(room) {
  const ids = room.players.map(p => p.id);
  const s = sanitizeSettings(room.settings.target);
  const opts = SPORTS[s.sport].options;
  // Never the same target two rounds in a row
  const pickFrom = opts.filter(o => !(room.lastTarget && room.lastTarget.sport === s.sport && room.lastTarget.value === o));
  const target = pickFrom[Math.floor(Math.random() * pickFrom.length)];
  room.lastTarget = { sport: s.sport, value: target };

  // Imposter pick: weighted down for recent imposters (streak breaker), never ruled out
  const recent = room.targetRecentImposters || [];
  const count = Math.min(s.imposters, Math.max(1, ids.length - 2));
  const pool = ids.slice();
  const imposterIds = [];
  for (let k = 0; k < count; k++) {
    const weights = pool.map(id => Math.pow(0.4, recent.filter(x => x === id).length));
    let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) { roll -= weights[i]; if (roll < 0) { idx = i; break; } }
    imposterIds.push(pool.splice(idx, 1)[0]);
  }
  room.targetRecentImposters = [...recent, ...imposterIds].slice(-4);

  room.round = {
    game: 'target',
    phase: 'reveal',
    sport: SPORTS[s.sport].name,
    target,
    options: opts.slice(),
    imposterIds,
    names: Object.fromEntries(room.players.map(p => [p.id, p.name])),
    votes: {},
    accusedId: null,
    guess: null,
    voteCounts: null,
    result: null
  };
  room.phase = 'playing';
  room.players.forEach(p => sendRole(room, p.id));
}

function sendRole(room, id) {
  const r = room.round;
  const sid = socketOf(room, id);
  if (!sid) return;
  const imp = r.imposterIds.includes(id);
  io.to(sid).emit('your_role', { game: 'target', imposter: imp, target: imp ? null : r.target, sport: r.sport, options: r.options });
}
function resendPrivate(room, id) { if (room.round) sendRole(room, id); }

function advance(room) {
  const r = room.round;
  if (!r) return;
  if (r.phase === 'reveal') r.phase = 'play';
  else if (r.phase === 'play') { r.votes = {}; r.phase = 'vote'; }
  else if (r.phase === 'vote') tally(room);
}

function backToPlay(room) {
  const r = room.round;
  if (r && r.phase === 'vote') { r.votes = {}; r.phase = 'play'; }
}

function vote(room, id, targetId) {
  const r = room.round;
  if (!r || r.phase !== 'vote' || id === targetId) return;
  if (!room.players.some(p => p.id === id) || !room.players.some(p => p.id === targetId)) return;
  r.votes[id] = targetId;
  if (room.players.every(p => r.votes[p.id])) tally(room);
}

function tally(room) {
  const r = room.round;
  const counts = {};
  Object.values(r.votes).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
  r.voteCounts = counts;
  let max = 0, top = [];
  for (const id in counts) { if (counts[id] > max) { max = counts[id]; top = [id]; } else if (counts[id] === max) top.push(id); }
  if (top.length !== 1) return finish(room, 'imposter', 'tie');
  r.accusedId = top[0];
  if (!r.imposterIds.includes(top[0])) return finish(room, 'imposter', 'wrong_vote');
  r.phase = 'guess';
}

function guess(room, id, value) {
  const r = room.round;
  if (!r || r.phase !== 'guess' || id !== r.accusedId) return;
  const g = String(value);
  if (!r.options.includes(g)) return;
  r.guess = g;
  finish(room, g === r.target ? 'imposter' : 'crew', g === r.target ? 'guessed' : 'caught');
}

function finish(room, winner, reason) {
  const r = room.round;
  r.result = { winner, reason };
  r.phase = 'results';
}

function onPlayerRemoved(room, id) {
  const r = room.round;
  if (!r || r.game !== 'target' || r.phase === 'results') return;
  if (r.imposterIds.includes(id)) {
    r.imposterIds = r.imposterIds.filter(x => x !== id);
    if (!r.imposterIds.length) return finish(room, 'crew', 'imposter_left');
  }
  delete r.votes[id];
  Object.keys(r.votes).forEach(v => { if (r.votes[v] === id) delete r.votes[v]; });
  if (r.phase === 'guess' && r.accusedId === id) return finish(room, 'crew', 'imposter_left');
  if (r.phase === 'vote' && room.players.length && room.players.every(p => r.votes[p.id])) tally(room);
}

function publicState(room) {
  const r = room.round;
  const s = {
    game: 'target',
    phase: r.phase,
    sport: r.sport,
    options: r.options,
    imposterCount: r.imposterIds.length,
    votedIds: r.phase === 'vote' ? Object.keys(r.votes) : [],
    accusedId: r.phase === 'guess' ? r.accusedId : null,
    accusedName: r.accusedId ? r.names[r.accusedId] : null,
    result: null
  };
  if (r.phase === 'results') {
    s.result = {
      ...r.result,
      target: r.target,
      guess: r.guess,
      imposters: r.imposterIds.map(id => r.names[id]),
      accusedName: r.accusedId ? r.names[r.accusedId] : null,
      votes: Object.keys(r.names).map(id => ({ name: r.names[id], imposter: r.imposterIds.includes(id), votes: (r.voteCounts || {})[id] || 0 }))
    };
  }
  return s;
}

module.exports = {
  SPORTS,
  init, defaultSettings, sanitizeSettings, start, advance, backToPlay, vote, guess,
  resendPrivate, onPlayerRemoved, publicState, MIN_PLAYERS
};
