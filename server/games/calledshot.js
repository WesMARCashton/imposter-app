// Called Shot — for the shuffleboard machine. On your turn you secretly call a target spot.
// Everyone else bets Hit or Miss. Throw for real, report the result, then the call is revealed.
// Scoring: shooter +2 for a hit, +1 for every bettor who guessed wrong. Bettors +1 if right.

const { SPORTS } = require('./target');

const MIN_PLAYERS = 2;

let io = null;
function init(socketIo) { io = socketIo; }

function defaultSettings() { return { sport: 'bocce', turns: 3 }; }
function sanitizeSettings(s) {
  s = s || {};
  const t = parseInt(s.turns, 10);
  return { sport: SPORTS[s.sport] ? s.sport : 'bocce', turns: Math.min(10, Math.max(1, t || 3)) };
}

const socketOf = (room, id) => { const p = room.players.find(x => x.id === id); return p && p.socketId; };

function start(room) {
  const s = sanitizeSettings(room.settings.calledshot);
  const order = room.players.map(p => p.id);
  room.round = {
    game: 'calledshot',
    phase: 'call',
    sport: SPORTS[s.sport].name,
    options: SPORTS[s.sport].options.slice(),
    turnsEach: s.turns,
    order,
    names: Object.fromEntries(room.players.map(p => [p.id, p.name])),
    turnIdx: Math.floor(Math.random() * order.length),
    turnsTaken: 0,
    call: null,
    bets: {},
    outcome: null,
    scores: Object.fromEntries(order.map(id => [id, 0])),
    history: [],
    result: null
  };
  room.phase = 'playing';
}

const shooter = (r) => r.order[r.turnIdx];

function privateState(room, id) {
  const r = room.round;
  return { myCall: shooter(r) === id ? r.call : null, myBet: r.bets[id] || null };
}
function syncPrivate(room) {
  const r = room.round;
  if (!r || r.game !== 'calledshot') return;
  room.players.forEach(p => { if (p.socketId) io.to(p.socketId).emit('cs_you', privateState(room, p.id)); });
}
function resendPrivate(room, id) { const sid = socketOf(room, id); if (room.round && sid) io.to(sid).emit('cs_you', privateState(room, id)); }

const bettors = (r) => r.order.filter(id => id !== shooter(r));

function callShot(room, id, option) {
  const r = room.round;
  if (!r || r.phase !== 'call' || shooter(r) !== id || !r.options.includes(option)) return;
  r.call = option;
  r.bets = {};
  r.phase = bettors(r).length ? 'bet' : 'throw';
}

function bet(room, id, choice) {
  const r = room.round;
  if (!r || r.phase !== 'bet' || id === shooter(r) || !r.order.includes(id) || !['hit', 'miss'].includes(choice)) return;
  r.bets[id] = choice;
  if (bettors(r).every(x => r.bets[x])) r.phase = 'throw';
}

function report(room, id, hit, isHost) {
  const r = room.round;
  if (!r || r.phase !== 'throw' || (shooter(r) !== id && !isHost)) return;
  const sh = shooter(r);
  const right = [], wrong = [];
  Object.entries(r.bets).forEach(([pid, b]) => { ((b === 'hit') === !!hit ? right : wrong).push(pid); });
  const shooterPts = (hit ? 2 : 0) + wrong.length;
  r.scores[sh] = (r.scores[sh] || 0) + shooterPts;
  right.forEach(pid => { r.scores[pid] = (r.scores[pid] || 0) + 1; });
  r.outcome = { hit: !!hit, call: r.call, shooterName: r.names[sh], shooterPts, right: right.map(x => r.names[x]), wrong: wrong.map(x => r.names[x]), noBet: bettors(r).filter(x => !r.bets[x]).map(x => r.names[x]) };
  r.history.unshift({ shooter: r.names[sh], call: r.call, hit: !!hit });
  r.turnsTaken++;
  r.phase = 'reveal';
}

function next(room, id, isHost) {
  const r = room.round;
  if (!r || r.phase !== 'reveal' || (shooter(r) !== id && !isHost)) return;
  if (r.turnsTaken >= r.order.length * r.turnsEach) return finish(room);
  r.turnIdx = (r.turnIdx + 1) % r.order.length;
  r.call = null; r.bets = {}; r.outcome = null;
  r.phase = 'call';
}

// host: skip waiting for bets
function forceThrow(room) { const r = room.round; if (r && r.phase === 'bet') r.phase = 'throw'; }

function finish(room) {
  const r = room.round;
  const ranked = r.order.slice().sort((a, b) => r.scores[b] - r.scores[a]);
  r.result = { standings: ranked.map(id => ({ name: r.names[id], score: r.scores[id] })) };
  r.phase = 'results';
}

function endEarly(room) { const r = room.round; if (r && r.phase !== 'results') finish(room); }

function onPlayerRemoved(room, id) {
  const r = room.round;
  if (!r || r.game !== 'calledshot' || r.phase === 'results') return;
  const wasShooter = shooter(r) === id;
  const idx = r.order.indexOf(id);
  if (idx < 0) return;
  r.order.splice(idx, 1);
  delete r.bets[id];
  if (!r.order.length) return finish(room);
  if (idx < r.turnIdx) r.turnIdx--;
  if (r.turnIdx >= r.order.length) r.turnIdx = 0;
  if (wasShooter) { r.call = null; r.bets = {}; r.outcome = null; r.phase = 'call'; return; }
  if (r.phase === 'bet' && bettors(r).every(x => r.bets[x])) r.phase = 'throw';
}

function publicState(room) {
  const r = room.round;
  const totalTurns = r.order.length * r.turnsEach;
  return {
    game: 'calledshot',
    phase: r.phase,
    sport: r.sport,
    options: r.options,
    shooterId: shooter(r),
    shooterName: r.names[shooter(r)],
    turn: Math.min(r.phase === 'reveal' || r.phase === 'results' ? r.turnsTaken : r.turnsTaken + 1, totalTurns),
    totalTurns,
    betCount: Object.keys(r.bets).length,
    bettorCount: bettors(r).length,
    betIds: Object.keys(r.bets),
    outcome: r.phase === 'reveal' ? r.outcome : null,
    scores: r.order.map(id => ({ id, name: r.names[id], score: r.scores[id] || 0 })).sort((a, b) => b.score - a.score),
    history: r.history.slice(0, 8),
    result: r.result
  };
}

module.exports = {
  init, defaultSettings, sanitizeSettings, start, callShot, bet, report, next, forceThrow, endEarly,
  resendPrivate, syncPrivate, onPlayerRemoved, publicState, MIN_PLAYERS
};
