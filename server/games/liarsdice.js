// Liar's Dice — everyone has hidden dice. Take turns raising a bid on how many of a face
// are on the whole table, or call "Liar!". Loser of a call loses a die. Last player with dice wins.

const { genId } = require('../util');

const MIN_PLAYERS = 2;

let io = null;
function init(socketIo) { io = socketIo; }
function defaultSettings() { return { dice: 5, wild: true }; }
function sanitizeSettings(s) {
  s = s || {};
  const d = parseInt(s.dice, 10);
  return { dice: [3, 4, 5, 6].includes(d) ? d : 5, wild: s.wild !== false };
}
const socketOf = (room, id) => { const p = room.players.find(x => x.id === id); return p && p.socketId; };
const roll = (n) => Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 6)).sort((a, b) => a - b);

function start(room) {
  const s = sanitizeSettings(room.settings.liarsdice);
  const order = room.players.map(p => p.id);
  room.round = {
    game: 'liarsdice',
    phase: 'bidding',
    wild: s.wild,
    order,
    names: Object.fromEntries(room.players.map(p => [p.id, p.name])),
    counts: Object.fromEntries(order.map(id => [id, s.dice])),
    dice: {},
    turnIdx: Math.floor(Math.random() * order.length),
    bid: null,
    roundNum: 0,
    reveal: null,
    result: null
  };
  room.phase = 'playing';
  newRound(room.round);
}

const alive = (r) => r.order.filter(id => r.counts[id] > 0);
const current = (r) => r.order[r.turnIdx];

function newRound(r) {
  r.roundNum++;
  r.rollId = genId();
  r.dice = Object.fromEntries(alive(r).map(id => [id, roll(r.counts[id])]));
  r.bid = null;
  r.reveal = null;
  r.phase = 'bidding';
  if (r.counts[current(r)] <= 0) advanceTurn(r);
}

function advanceTurn(r) {
  const n = r.order.length;
  for (let i = 1; i <= n; i++) {
    const idx = (r.turnIdx + i) % n;
    if (r.counts[r.order[idx]] > 0) { r.turnIdx = idx; return; }
  }
}

function totalDice(r) { return alive(r).reduce((a, id) => a + r.counts[id], 0); }

function isHigher(r, q, f) {
  if (!r.bid) return true;
  return q > r.bid.qty || (q === r.bid.qty && f > r.bid.face);
}

function bid(room, id, qty, face) {
  const r = room.round;
  if (!r || r.phase !== 'bidding' || current(r) !== id) return { error: 'Not your turn' };
  qty = parseInt(qty, 10); face = parseInt(face, 10);
  if (!(face >= 1 && face <= 6) || !(qty >= 1 && qty <= totalDice(r))) return { error: 'Invalid bid' };
  if (r.wild && face === 1) return { error: '1s are wild — bid on 2s through 6s' };
  if (!isHigher(r, qty, face)) return { error: 'Bid must be higher: more dice, or same number with a higher face' };
  r.bid = { qty, face, by: id };
  advanceTurn(r);
  return { ok: true };
}

function callLiar(room, id) {
  const r = room.round;
  if (!r || r.phase !== 'bidding' || current(r) !== id || !r.bid) return;
  const { qty, face, by } = r.bid;
  let count = 0;
  Object.values(r.dice).forEach(ds => ds.forEach(d => { if (d === face || (r.wild && d === 1)) count++; }));
  const bidTrue = count >= qty;
  const loser = bidTrue ? id : by;
  r.counts[loser]--;
  r.reveal = {
    caller: r.names[id], bidder: r.names[by], qty, face, count, bidTrue,
    loser: r.names[loser], loserId: loser, loserOut: r.counts[loser] === 0,
    dice: r.order.filter(pid => r.dice[pid]).map(pid => ({ name: r.names[pid], dice: r.dice[pid] }))
  };
  r.phase = 'reveal';
  // Loser starts the next round (or the next player if they're out)
  r.turnIdx = r.order.indexOf(loser);
  if (alive(r).length <= 1) { r.result = { winner: r.names[alive(r)[0]] }; }
}

function nextRound(room) {
  const r = room.round;
  if (!r || r.phase !== 'reveal') return;
  if (r.result) { r.phase = 'results'; return; }
  if (r.counts[current(r)] <= 0) advanceTurn(r);
  newRound(r);
}

function privateState(room, id) { const r = room.round; return { dice: r.dice[id] || [], rollId: r.rollId }; }
function syncPrivate(room) {
  const r = room.round;
  if (!r || r.game !== 'liarsdice') return;
  room.players.forEach(p => { if (p.socketId) io.to(p.socketId).emit('ld_you', privateState(room, p.id)); });
}
function resendPrivate(room, id) { const sid = socketOf(room, id); if (room.round && sid) io.to(sid).emit('ld_you', privateState(room, id)); }

function onPlayerRemoved(room, id) {
  const r = room.round;
  if (!r || r.game !== 'liarsdice' || r.phase === 'results') return;
  const wasCurrent = current(r) === id;
  r.counts[id] = 0;
  delete r.dice[id];
  if (alive(r).length <= 1) { r.result = { winner: r.names[alive(r)[0]] || null }; r.phase = 'results'; return; }
  if (wasCurrent) advanceTurn(r);
}

function publicState(room) {
  const r = room.round;
  return {
    game: 'liarsdice',
    phase: r.phase,
    wild: r.wild,
    roundNum: r.roundNum,
    players: r.order.map(id => ({ id, name: r.names[id], dice: r.counts[id] })),
    totalDice: totalDice(r),
    currentId: current(r),
    currentName: r.names[current(r)],
    bid: r.bid ? { qty: r.bid.qty, face: r.bid.face, byName: r.names[r.bid.by], byId: r.bid.by } : null,
    reveal: r.phase === 'reveal' || r.phase === 'results' ? r.reveal : null,
    result: r.phase === 'results' ? r.result : null
  };
}

module.exports = {
  init, defaultSettings, sanitizeSettings, start, bid, callLiar, nextRound,
  resendPrivate, syncPrivate, onPlayerRemoved, publicState, MIN_PLAYERS
};
