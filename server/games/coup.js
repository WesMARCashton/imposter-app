// Coup — bluffing card game. Everyone has 2 hidden character cards ("influence") and coins.
// On your turn take an action. Character actions can be claimed whether or not you have the card;
// anyone can challenge a claim. Some actions can be blocked by claiming a character.
// Lose both cards and you're out. Last player standing wins.

const { shuffle } = require('../util');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const ROLES = ['Duke', 'Assassin', 'Captain', 'Ambassador', 'Contessa'];

const ACTIONS = {
  income:      { label: 'Income',       cost: 0, claim: null },
  foreign_aid: { label: 'Foreign Aid',  cost: 0, claim: null, blockers: 'any', blockRoles: ['Duke'] },
  coup:        { label: 'Coup',         cost: 7, claim: null, target: true },
  tax:         { label: 'Tax',          cost: 0, claim: 'Duke' },
  assassinate: { label: 'Assassinate',  cost: 3, claim: 'Assassin', target: true, blockers: 'target', blockRoles: ['Contessa'] },
  steal:       { label: 'Steal',        cost: 0, claim: 'Captain', target: true, blockers: 'target', blockRoles: ['Captain', 'Ambassador'] },
  exchange:    { label: 'Exchange',     cost: 0, claim: 'Ambassador' }
};

let io = null;
function init(socketIo) { io = socketIo; }
function defaultSettings() { return {}; }
function sanitizeSettings() { return {}; }
const socketOf = (room, id) => { const p = room.players.find(x => x.id === id); return p && p.socketId; };

function start(room) {
  const order = room.players.map(p => p.id);
  let deck = shuffle(ROLES.flatMap(rl => [rl, rl, rl]));
  const cards = {};
  order.forEach(id => { cards[id] = [{ role: deck.pop(), dead: false }, { role: deck.pop(), dead: false }]; });
  room.round = {
    game: 'coup',
    phase: 'action',
    order,
    names: Object.fromEntries(room.players.map(p => [p.id, p.name])),
    coins: Object.fromEntries(order.map(id => [id, 2])),
    cards, deck,
    turnIdx: Math.floor(Math.random() * order.length),
    pending: null,
    losing: null,
    exchange: null,
    log: [],
    result: null
  };
  room.phase = 'playing';
}

const hidden = (r, id) => (r.cards[id] || []).filter(c => !c.dead);
const isAlive = (r, id) => hidden(r, id).length > 0;
const alivePlayers = (r) => r.order.filter(id => isAlive(r, id));
const current = (r) => r.order[r.turnIdx];
const N = (r, id) => r.names[id];
const log = (r, text) => { r.log.unshift(text); if (r.log.length > 40) r.log.pop(); };

// ---------- losing influence ----------
function loseInfluence(room, id, then) {
  const r = room.round;
  const h = hidden(r, id);
  if (!h.length) return then();
  if (h.length === 1) {
    h[0].dead = true;
    log(r, `${N(r, id)} lost their last card (${h[0].role}) and is out!`);
    if (checkWin(room)) return;
    return then();
  }
  r.losing = { id, then };
  r.phase = 'lose';
}

function chooseLoss(room, id, idx) {
  const r = room.round;
  if (!r || r.phase !== 'lose' || !r.losing || r.losing.id !== id) return;
  const c = (r.cards[id] || [])[parseInt(idx, 10)];
  if (!c || c.dead) return;
  c.dead = true;
  log(r, `${N(r, id)} revealed a ${c.role}.`);
  const then = r.losing.then;
  r.losing = null;
  if (checkWin(room)) return;
  then();
}

function checkWin(room) {
  const r = room.round;
  const a = alivePlayers(r);
  if (a.length <= 1) { r.result = { winnerId: a[0] || null, winner: a[0] ? N(r, a[0]) : null }; r.phase = 'results'; r.pending = null; r.losing = null; return true; }
  return false;
}

// ---------- turn ----------
function endTurn(room) {
  const r = room.round;
  r.pending = null; r.exchange = null;
  if (checkWin(room)) return;
  const n = r.order.length;
  for (let i = 1; i <= n; i++) {
    const idx = (r.turnIdx + i) % n;
    if (isAlive(r, r.order[idx])) { r.turnIdx = idx; break; }
  }
  r.phase = 'action';
}

function declare(room, id, action, target) {
  const r = room.round;
  const a = ACTIONS[action];
  if (!r || r.phase !== 'action' || current(r) !== id || !a) return { error: 'Not your turn' };
  if (r.coins[id] >= 10 && action !== 'coup') return { error: 'You have 10+ coins — you must Coup.' };
  if (r.coins[id] < a.cost) return { error: `Needs ${a.cost} coins.` };
  if (a.target && (!isAlive(r, target) || target === id)) return { error: 'Pick a player.' };
  r.coins[id] -= a.cost;
  const tName = a.target ? ` on ${N(r, target)}` : '';

  if (action === 'income') { r.coins[id] += 1; log(r, `${N(r, id)} took Income (+1).`); endTurn(room); return { ok: true }; }
  if (action === 'coup') { log(r, `${N(r, id)} launched a Coup on ${N(r, target)}!`); loseInfluence(room, target, () => endTurn(room)); return { ok: true }; }

  log(r, `${N(r, id)} claims ${a.claim || 'nothing'}: ${a.label}${tName}.`);
  r.pending = { action, actor: id, target: a.target ? target : null, claim: a.claim, canChallenge: !!a.claim, blockOnly: false, block: null, passed: [] };
  r.phase = 'respond';
  return { ok: true };
}

function eligibleBlockers(r) {
  const p = r.pending; const a = ACTIONS[p.action];
  if (!a.blockers) return [];
  if (a.blockers === 'target') return isAlive(r, p.target) ? [p.target] : [];
  return alivePlayers(r).filter(x => x !== p.actor);
}

function responders(r) {
  const p = r.pending;
  if (!p) return [];
  if (r.phase === 'respond') return p.blockOnly ? eligibleBlockers(r) : alivePlayers(r).filter(x => x !== p.actor);
  if (r.phase === 'block_respond') return alivePlayers(r).filter(x => x !== p.block.by);
  return [];
}

function respond(room, id, type, role) {
  const r = room.round;
  if (!r || !['respond', 'block_respond'].includes(r.phase)) return;
  const p = r.pending;
  if (!responders(r).includes(id) || p.passed.includes(id)) return;

  if (r.phase === 'respond') {
    if (type === 'pass') {
      p.passed.push(id);
      if (responders(r).every(x => p.passed.includes(x))) resolveAction(room);
      return;
    }
    if (type === 'challenge' && p.canChallenge && !p.blockOnly) {
      log(r, `${N(r, id)} challenges ${N(r, p.actor)}'s ${p.claim}!`);
      return challenge(room, p.actor, p.claim, id,
        () => { // actor really had it -> action continues, target may still block
          p.canChallenge = false;
          if (!isAlive(r, p.actor)) return endTurn(room);
          const blockers = eligibleBlockers(r);
          if (blockers.length) { p.blockOnly = true; p.passed = []; r.phase = 'respond'; }
          else resolveAction(room);
        },
        () => { log(r, `${ACTIONS[p.action].label} fails.`); endTurn(room); });
    }
    if (type === 'block') {
      const a = ACTIONS[p.action];
      if (!eligibleBlockers(r).includes(id) || !a.blockRoles.includes(role)) return;
      log(r, `${N(r, id)} blocks with ${role}!`);
      p.block = { by: id, role };
      p.passed = [];
      r.phase = 'block_respond';
    }
    return;
  }

  // block_respond
  if (type === 'pass') {
    p.passed.push(id);
    if (responders(r).every(x => p.passed.includes(x))) { log(r, `${ACTIONS[p.action].label} was blocked.`); endTurn(room); }
    return;
  }
  if (type === 'challenge') {
    log(r, `${N(r, id)} challenges ${N(r, p.block.by)}'s ${p.block.role}!`);
    challenge(room, p.block.by, p.block.role, id,
      () => { log(r, `${ACTIONS[p.action].label} was blocked.`); endTurn(room); },
      () => resolveAction(room));
  }
}

function challenge(room, claimant, role, challenger, onTruth, onLie) {
  const r = room.round;
  const card = hidden(r, claimant).find(c => c.role === role);
  if (card) {
    log(r, `${N(r, claimant)} shows a ${role}! ${N(r, challenger)} loses a card.`);
    // swap the revealed card back into the deck for a fresh one
    r.deck.push(card.role); r.deck = shuffle(r.deck); card.role = r.deck.pop();
    loseInfluence(room, challenger, onTruth);
  } else {
    log(r, `${N(r, claimant)} was bluffing! They lose a card.`);
    loseInfluence(room, claimant, onLie);
  }
}

function resolveAction(room) {
  const r = room.round;
  const p = r.pending;
  if (!p || !isAlive(r, p.actor)) return endTurn(room);
  const id = p.actor, t = p.target;
  switch (p.action) {
    case 'foreign_aid': r.coins[id] += 2; log(r, `${N(r, id)} takes Foreign Aid (+2).`); break;
    case 'tax': r.coins[id] += 3; log(r, `${N(r, id)} collects Tax (+3).`); break;
    case 'steal': { const amt = Math.min(2, r.coins[t]); r.coins[t] -= amt; r.coins[id] += amt; log(r, `${N(r, id)} steals ${amt} from ${N(r, t)}.`); break; }
    case 'assassinate':
      if (isAlive(r, t)) { log(r, `${N(r, id)} assassinates ${N(r, t)}.`); return loseInfluence(room, t, () => endTurn(room)); }
      break;
    case 'exchange': {
      const draw = [r.deck.pop(), r.deck.pop()].filter(Boolean);
      r.exchange = { id, options: [...hidden(r, id).map(c => c.role), ...draw], keep: hidden(r, id).length };
      r.phase = 'exchange';
      return;
    }
  }
  endTurn(room);
}

function chooseExchange(room, id, keepIdxs) {
  const r = room.round;
  const ex = r.exchange;
  if (!r || r.phase !== 'exchange' || !ex || ex.id !== id || !Array.isArray(keepIdxs)) return;
  const idxs = [...new Set(keepIdxs.map(n => parseInt(n, 10)))].filter(n => n >= 0 && n < ex.options.length);
  if (idxs.length !== ex.keep) return;
  const keep = idxs.map(i => ex.options[i]);
  const back = ex.options.filter((_, i) => !idxs.includes(i));
  hidden(r, id).forEach((c, i) => { c.role = keep[i]; });
  r.deck = shuffle([...r.deck, ...back]);
  log(r, `${N(r, id)} exchanged cards with the deck.`);
  endTurn(room);
}

function privateState(room, id) {
  const r = room.round;
  return {
    hand: (r.cards[id] || []).map(c => ({ role: c.role, dead: c.dead })),
    mustLose: r.phase === 'lose' && r.losing && r.losing.id === id,
    exchange: r.phase === 'exchange' && r.exchange && r.exchange.id === id ? { options: r.exchange.options, keep: r.exchange.keep } : null
  };
}
function syncPrivate(room) {
  const r = room.round;
  if (!r || r.game !== 'coup') return;
  room.players.forEach(p => { if (p.socketId) io.to(p.socketId).emit('coup_you', privateState(room, p.id)); });
}
function resendPrivate(room, id) { const sid = socketOf(room, id); if (room.round && sid) io.to(sid).emit('coup_you', privateState(room, id)); }

function onPlayerRemoved(room, id) {
  const r = room.round;
  if (!r || r.game !== 'coup' || r.phase === 'results') return;
  (r.cards[id] || []).forEach(c => { c.dead = true; });
  log(r, `${N(r, id)} left the game.`);
  if (checkWin(room)) return;
  const p = r.pending;
  if (r.phase === 'lose' && r.losing && r.losing.id === id) { const then = r.losing.then; r.losing = null; return then(); }
  if (r.phase === 'exchange' && r.exchange && r.exchange.id === id) return endTurn(room);
  if (current(r) === id || (p && (p.actor === id))) return endTurn(room);
  if (p && p.block && p.block.by === id) return resolveAction(room);
  if (p && ['respond', 'block_respond'].includes(r.phase) && responders(r).every(x => p.passed.includes(x))) {
    if (r.phase === 'respond') resolveAction(room); else { log(r, `${ACTIONS[p.action].label} was blocked.`); endTurn(room); }
  }
}

function publicState(room) {
  const r = room.round;
  const p = r.pending;
  return {
    game: 'coup',
    phase: r.phase,
    players: r.order.map(id => ({ id, name: N(r, id), coins: r.coins[id], influence: hidden(r, id).length, revealed: (r.cards[id] || []).filter(c => c.dead).map(c => c.role) })),
    currentId: current(r),
    currentName: N(r, current(r)),
    pending: p ? {
      action: p.action, label: ACTIONS[p.action].label, actorId: p.actor, actorName: N(r, p.actor),
      targetId: p.target, targetName: p.target ? N(r, p.target) : null, claim: p.claim,
      canChallenge: p.canChallenge && !p.blockOnly, blockOnly: p.blockOnly,
      blockRoles: ACTIONS[p.action].blockRoles || [], blockers: r.phase === 'respond' ? eligibleBlockers(r) : [],
      block: p.block ? { byId: p.block.by, byName: N(r, p.block.by), role: p.block.role } : null,
      waitingOn: responders(r).filter(x => !p.passed.includes(x)).map(x => N(r, x)),
      responderIds: responders(r), passedIds: p.passed
    } : null,
    losingName: r.losing ? N(r, r.losing.id) : null,
    exchangingName: r.exchange ? N(r, r.exchange.id) : null,
    deckCount: r.deck.length,
    log: r.log.slice(0, 12),
    result: r.result
  };
}

module.exports = {
  init, defaultSettings, sanitizeSettings, start, declare, respond, chooseLoss, chooseExchange,
  resendPrivate, syncPrivate, onPlayerRemoved, publicState, MIN_PLAYERS, MAX_PLAYERS, ACTIONS, ROLES
};
