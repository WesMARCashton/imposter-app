// Clue (office edition) — deduction game. A secret suspect, weapon and room are hidden.
// Everyone else's cards are dealt out. Suggest a combo; the next player clockwise who
// holds one of those cards secretly shows one. Make a final accusation to win.

const { shuffle, genId } = require('../util');

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 6;

const SUSPECTS = [
  { id: 's:ceo', name: 'The CEO' },
  { id: 's:intern', name: 'The Intern' },
  { id: 's:it', name: 'The IT Guy' },
  { id: 's:accountant', name: 'The Accountant' },
  { id: 's:receptionist', name: 'The Receptionist' },
  { id: 's:janitor', name: 'The Janitor' }
];
const WEAPONS = [
  { id: 'w:stapler', name: 'Stapler' },
  { id: 'w:mug', name: 'Coffee Mug' },
  { id: 'w:charger', name: 'Laptop Charger' },
  { id: 'w:shredder', name: 'Paper Shredder' },
  { id: 'w:trophy', name: 'Golf Trophy' },
  { id: 'w:donut', name: 'Poisoned Donut' }
];
const ROOMS = [
  { id: 'r:break', name: 'Break Room' },
  { id: 'r:board', name: 'Boardroom' },
  { id: 'r:server', name: 'Server Room' },
  { id: 'r:mail', name: 'Mail Room' },
  { id: 'r:parking', name: 'Parking Garage' },
  { id: 'r:roof', name: 'Rooftop' },
  { id: 'r:closet', name: 'Supply Closet' },
  { id: 'r:lobby', name: 'Lobby' },
  { id: 'r:ceo', name: 'Corner Office' }
];
const ALL = [...SUSPECTS, ...WEAPONS, ...ROOMS];
const NAME = Object.fromEntries(ALL.map(c => [c.id, c.name]));
const isS = (id) => SUSPECTS.some(c => c.id === id);
const isW = (id) => WEAPONS.some(c => c.id === id);
const isR = (id) => ROOMS.some(c => c.id === id);

let io = null;
function init(socketIo) { io = socketIo; }
function defaultSettings() { return {}; }
function sanitizeSettings() { return {}; }

const socketOf = (room, id) => { const p = room.players.find(x => x.id === id); return p && p.socketId; };

function start(room) {
  const ids = room.players.map(p => p.id);
  const envelope = {
    suspect: shuffle(SUSPECTS)[0].id,
    weapon: shuffle(WEAPONS)[0].id,
    room: shuffle(ROOMS)[0].id
  };
  const rest = shuffle(ALL.map(c => c.id).filter(id => !Object.values(envelope).includes(id)));
  const firstIdx = Math.floor(Math.random() * ids.length);
  const hands = Object.fromEntries(ids.map(id => [id, []]));
  rest.forEach((card, i) => hands[ids[(firstIdx + i) % ids.length]].push(card));

  room.round = {
    game: 'clue',
    gameId: genId(),
    phase: 'reveal',
    order: ids,
    names: Object.fromEntries(room.players.map(p => [p.id, p.name])),
    turnIdx: firstIdx,
    envelope,
    hands,
    seen: Object.fromEntries(ids.map(id => [id, []])),   // cards shown TO each player: [{card, by}]
    shownByMe: {},                                        // last card each player showed: {to, card}
    eliminated: [],
    lastRoom: {},
    suggestion: null,
    log: [],
    result: null
  };
  room.phase = 'playing';
}

const current = (r) => r.order[r.turnIdx];

function privateState(room, id) {
  const r = room.round;
  const s = r.suggestion;
  const needToShow = r.phase === 'refute' && s && s.refuterId === id
    ? (r.hands[id] || []).filter(c => [s.suspect, s.weapon, s.room].includes(c))
    : [];
  return {
    hand: r.hands[id] || [],
    seen: (r.seen[id] || []).map(x => ({ card: x.card, by: r.names[x.by] })),
    needToShow,
    shownByMe: r.shownByMe[id] ? { to: r.names[r.shownByMe[id].to], card: r.shownByMe[id].card } : null,
    lastShown: s && s.by === id && s.shownCard ? { card: s.shownCard, by: r.names[s.shownBy] } : null,
    eliminated: r.eliminated.includes(id),
    answer: r.eliminated.includes(id) ? r.envelope : null,
    lastRoom: r.lastRoom[id] || null
  };
}

function syncPrivate(room) {
  const r = room.round;
  if (!r || r.game !== 'clue') return;
  room.players.forEach(p => { if (p.socketId && r.order.includes(p.id)) io.to(p.socketId).emit('clue_you', privateState(room, p.id)); });
}
function resendPrivate(room, id) {
  const r = room.round;
  const sid = socketOf(room, id);
  if (r && sid && r.order.includes(id)) io.to(sid).emit('clue_you', privateState(room, id));
}

function advance(room) {
  const r = room.round;
  if (r && r.phase === 'reveal') r.phase = 'turn';
}

function suggest(room, id, suspect, weapon, roomCard) {
  const r = room.round;
  if (!r || r.phase !== 'turn' || current(r) !== id || r.eliminated.includes(id)) return;
  if (!isS(suspect) || !isW(weapon) || !isR(roomCard) || r.lastRoom[id] === roomCard) return;
  r.lastRoom[id] = roomCard;
  const start = r.order.indexOf(id);
  const queue = [];
  for (let i = 1; i < r.order.length; i++) queue.push(r.order[(start + i) % r.order.length]);
  r.suggestion = { by: id, suspect, weapon, room: roomCard, queue, refuterId: null, shownBy: null, shownCard: null, nobody: false, passed: [] };
  processQueue(room);
}

function processQueue(room) {
  const r = room.round;
  const s = r.suggestion;
  const combo = [s.suspect, s.weapon, s.room];
  while (s.queue.length) {
    const pid = s.queue.shift();
    if (!r.order.includes(pid)) continue;
    const matches = (r.hands[pid] || []).filter(c => combo.includes(c));
    if (!matches.length) { s.passed.push(pid); continue; }
    if (matches.length === 1) return show(room, pid, matches[0]);
    s.refuterId = pid;
    r.phase = 'refute';
    return;
  }
  s.nobody = true;
  finishSuggestion(room);
}

function show(room, pid, card) {
  const r = room.round;
  const s = r.suggestion;
  s.refuterId = null;
  s.shownBy = pid;
  s.shownCard = card;
  r.seen[s.by].push({ card, by: pid });
  r.shownByMe[pid] = { to: s.by, card };
  finishSuggestion(room);
}

function refute(room, id, card) {
  const r = room.round;
  const s = r.suggestion;
  if (!r || r.phase !== 'refute' || !s || s.refuterId !== id) return;
  if (![s.suspect, s.weapon, s.room].includes(card) || !(r.hands[id] || []).includes(card)) return;
  show(room, id, card);
}

function finishSuggestion(room) {
  const r = room.round;
  const s = r.suggestion;
  r.log.unshift({
    by: r.names[s.by],
    suspect: NAME[s.suspect], weapon: NAME[s.weapon], room: NAME[s.room],
    passed: s.passed.map(x => r.names[x]),
    shownBy: s.shownBy ? r.names[s.shownBy] : null
  });
  if (r.log.length > 30) r.log.pop();
  r.phase = 'suggested';
}

function endTurn(room, id, force) {
  const r = room.round;
  if (!r || !['turn', 'suggested'].includes(r.phase)) return;
  if (!force && current(r) !== id) return;
  nextTurn(room);
}

function nextTurn(room) {
  const r = room.round;
  r.suggestion = null;
  const n = r.order.length;
  for (let i = 1; i <= n; i++) {
    const idx = (r.turnIdx + i) % n;
    if (!r.eliminated.includes(r.order[idx])) { r.turnIdx = idx; r.phase = 'turn'; return; }
  }
  finish(room, null, 'everyone_wrong');
}

function accuse(room, id, suspect, weapon, roomCard) {
  const r = room.round;
  if (!r || !['turn', 'suggested'].includes(r.phase) || current(r) !== id || r.eliminated.includes(id)) return;
  if (!isS(suspect) || !isW(weapon) || !isR(roomCard)) return;
  const e = r.envelope;
  const accusation = { by: r.names[id], suspect: NAME[suspect], weapon: NAME[weapon], room: NAME[roomCard] };
  if (suspect === e.suspect && weapon === e.weapon && roomCard === e.room) {
    return finish(room, id, 'solved', accusation);
  }
  r.eliminated.push(id);
  r.log.unshift({ wrongAccusation: true, ...accusation });
  const left = r.order.filter(x => !r.eliminated.includes(x));
  if (left.length === 1) return finish(room, left[0], 'last_standing');
  nextTurn(room);
}

function finish(room, winnerId, reason, accusation) {
  const r = room.round;
  r.result = { winnerId, winnerName: winnerId ? r.names[winnerId] : null, reason, accusation: accusation || null };
  r.phase = 'results';
}

function onPlayerRemoved(room, id) {
  const r = room.round;
  if (!r || r.game !== 'clue' || r.phase === 'results') return;
  const wasCurrent = current(r) === id;
  const idx = r.order.indexOf(id);
  if (idx < 0) return;
  r.order.splice(idx, 1);
  r.eliminated = r.eliminated.filter(x => x !== id);
  // Their cards go face-up to everyone so nothing becomes unsolvable
  const orphaned = r.hands[id] || [];
  delete r.hands[id];
  if (orphaned.length) {
    r.revealed = [...(r.revealed || []), ...orphaned];
    r.log.unshift({ left: r.names[id], cards: orphaned.map(c => NAME[c]) });
  }
  if (idx < r.turnIdx) r.turnIdx--;
  if (r.turnIdx >= r.order.length) r.turnIdx = 0;
  const active = r.order.filter(x => !r.eliminated.includes(x));
  if (active.length < 2) return finish(room, active[0] || null, active.length ? 'last_standing' : 'everyone_wrong');
  if (r.phase === 'refute' && r.suggestion && r.suggestion.refuterId === id) { r.suggestion.refuterId = null; processQueue(room); return; }
  if (wasCurrent || (r.suggestion && r.suggestion.by === id)) { r.turnIdx = (r.turnIdx - 1 + r.order.length) % r.order.length; nextTurn(room); }
}

function publicState(room) {
  const r = room.round;
  const s = r.suggestion;
  const out = {
    game: 'clue',
    gameId: r.gameId,
    phase: r.phase,
    cards: { suspects: SUSPECTS, weapons: WEAPONS, rooms: ROOMS },
    order: r.order.map(id => ({ id, name: r.names[id], out: r.eliminated.includes(id), cards: (r.hands[id] || []).length })),
    currentId: current(r),
    currentName: r.names[current(r)],
    suggestion: s ? {
      byId: s.by, byName: r.names[s.by],
      suspect: NAME[s.suspect], weapon: NAME[s.weapon], room: NAME[s.room],
      refuterName: s.refuterId ? r.names[s.refuterId] : null,
      shownByName: s.shownBy ? r.names[s.shownBy] : null,
      nobody: s.nobody,
      passed: s.passed.map(x => r.names[x])
    } : null,
    revealed: (r.revealed || []).map(c => ({ id: c, name: NAME[c] })),
    log: r.log.slice(0, 12),
    result: null
  };
  if (r.phase === 'results') {
    out.result = {
      ...r.result,
      envelope: { suspect: NAME[r.envelope.suspect], weapon: NAME[r.envelope.weapon], room: NAME[r.envelope.room] },
      hands: r.order.map(id => ({ name: r.names[id], cards: (r.hands[id] || []).map(c => NAME[c]) }))
    };
  }
  return out;
}

module.exports = {
  init, defaultSettings, sanitizeSettings, start, advance, suggest, refute, endTurn, accuse,
  resendPrivate, syncPrivate, onPlayerRemoved, publicState, MIN_PLAYERS, MAX_PLAYERS, NAME
};
