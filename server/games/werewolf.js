// Werewolf — the app is the narrator. Night: Werewolves pick a victim, the Seer checks
// someone, the Doctor protects someone, Villagers mark a suspect (so everyone is tapping).
// Day: discuss and vote someone out. Roles are revealed when a player dies.

const { shuffle } = require('../util');

const MIN_PLAYERS = 5;
const ROLE_NAMES = { wolf: 'Werewolf', seer: 'Seer', doctor: 'Doctor', villager: 'Villager' };

const HUNT_OPTIONS = [0, 30, 45, 60];
// Pack chat: tap-only messages (no typing) so it's fast and quiet at the table
const QUICK = ['Agreed 👍', 'No, too obvious', 'They suspect me', 'Lay low tonight', 'Trust me', 'Hurry up! ⏳', 'Your call'];
const BUILD = {
  go: (n) => `Go for ${n}`,
  seer: (n) => `${n} is the Seer?`,
  doctor: (n) => `${n} is the Doctor?`,
  villager: (n) => `${n} is just a Villager`,
  suspects: (n) => `${n} suspects us`,
  spare: (n) => `Leave ${n} alone`
};

let io = null;
let broadcast = () => {};
function init(socketIo, broadcastFn) { io = socketIo; if (broadcastFn) broadcast = broadcastFn; }

function defaultSettings() { return { wolves: 0, seer: true, doctor: true, hunt: 45 }; }
function sanitizeSettings(s) {
  s = s || {};
  const w = parseInt(s.wolves, 10);
  const h = parseInt(s.hunt, 10);
  return { wolves: [0, 1, 2, 3].includes(w) ? w : 0, seer: s.seer !== false, doctor: s.doctor !== false, hunt: HUNT_OPTIONS.includes(h) ? h : 45 };
}
const autoWolves = (n) => (n >= 10 ? 3 : n >= 7 ? 2 : 1);

const socketOf = (room, id) => { const p = room.players.find(x => x.id === id); return p && p.socketId; };
const isWolf = (r, id) => r.roles[id] === 'wolf';
const aliveWolves = (r) => r.alive.filter(id => isWolf(r, id));
const aliveVillage = (r) => r.alive.filter(id => !isWolf(r, id));

function start(room) {
  const ids = shuffle(room.players.map(p => p.id));
  const s = sanitizeSettings(room.settings.werewolf);
  const nWolves = Math.min(s.wolves || autoWolves(ids.length), Math.floor((ids.length - 1) / 2));
  const roles = {};
  let i = 0;
  for (; i < nWolves; i++) roles[ids[i]] = 'wolf';
  if (s.seer) roles[ids[i++]] = 'seer';
  if (s.doctor) roles[ids[i++]] = 'doctor';
  for (; i < ids.length; i++) roles[ids[i]] = 'villager';

  room.round = {
    game: 'werewolf',
    phase: 'reveal',
    huntSecs: s.hunt,
    timer: null,
    roles,
    names: Object.fromEntries(room.players.map(p => [p.id, p.name])),
    alive: room.players.map(p => p.id),
    dayNum: 0,
    night: null,
    lastProtected: null,
    seerResults: [],
    dawn: null,
    votes: {},
    lynch: null,
    result: null
  };
  room.phase = 'playing';
}

function privateState(room, id) {
  const r = room.round;
  const role = r.roles[id];
  const n = r.night;
  const out = {
    role,
    roleName: ROLE_NAMES[role],
    alive: r.alive.includes(id),
    wolves: role === 'wolf' ? Object.keys(r.roles).filter(x => isWolf(r, x) && x !== id).map(x => r.names[x]) : [],
    nightPick: null,
    nightDone: false,
    wolfVotes: [],
    seerResults: role === 'seer' ? r.seerResults : [],
    lastProtectedId: role === 'doctor' ? r.lastProtected : null
  };
  if (n) {
    out.nightDone = n.done.includes(id);
    out.nightPick = n.picks[id] || null;
    if (role === 'wolf') {
      out.chat = n.chat.slice(-30);
      out.quick = QUICK;
      out.wolfVotes = aliveWolves(r).map(w => ({ wolf: r.names[w], wolfId: w, target: n.picks[w] ? r.names[n.picks[w]] : null, targetId: n.picks[w] || null }));
      out.packAgreed = packAgreed(r);
      out.packSize = aliveWolves(r).length;
    }
  }
  return out;
}

function syncPrivate(room) {
  const r = room.round;
  if (!r || r.game !== 'werewolf') return;
  room.players.forEach(p => { if (p.socketId && r.roles[p.id]) io.to(p.socketId).emit('ww_you', privateState(room, p.id)); });
}
function resendPrivate(room, id) {
  const r = room.round; const sid = socketOf(room, id);
  if (r && sid && r.roles[id]) io.to(sid).emit('ww_you', privateState(room, id));
}

// ---------- night ----------
function clearTimer(r) { if (r.timer) { clearTimeout(r.timer); r.timer = null; } }
function cleanup(room) { if (room.round && room.round.game === 'werewolf') clearTimer(room.round); }

function startNight(room) {
  const r = room.round;
  clearTimer(r);
  r.night = { picks: {}, done: [], chat: [], endsAt: r.huntSecs ? Date.now() + r.huntSecs * 1000 : null };
  r.dawn = null; r.lynch = null; r.votes = {};
  r.phase = 'night';
  if (r.huntSecs) {
    const night = r.night;
    r.timer = setTimeout(() => {
      if (room.round === r && r.phase === 'night' && r.night === night) { resolveNight(room); broadcast(room.code); }
    }, r.huntSecs * 1000);
  }
}

function packChat(room, id, msg) {
  const r = room.round;
  if (!r || r.phase !== 'night' || !isWolf(r, id) || !r.alive.includes(id) || !msg) return;
  let text = null;
  if (msg.kind === 'quick' && QUICK.includes(msg.text)) text = msg.text;
  if (msg.kind === 'build' && BUILD[msg.action] && r.alive.includes(msg.targetId)) text = BUILD[msg.action](r.names[msg.targetId]);
  if (!text) return;
  r.night.chat.push({ from: r.names[id], fromId: id, text, t: Date.now() });
  if (r.night.chat.length > 50) r.night.chat.shift();
}

function nightPick(room, id, target) {
  const r = room.round;
  if (!r || r.phase !== 'night' || !r.alive.includes(id) || !r.alive.includes(target)) return;
  const role = r.roles[id];
  if (role === 'wolf' && isWolf(r, target)) return;
  if (role !== 'doctor' && target === id) return;
  if (role === 'doctor' && target === r.lastProtected) return;
  if (role === 'seer' && r.night.done.includes(id)) return; // one look per night
  r.night.picks[id] = target;
  if (role === 'wolf') updatePack(r);
  else if (!r.night.done.includes(id)) r.night.done.push(id);
  if (role === 'seer') r.seerResults.push({ night: r.dayNum + 1, name: r.names[target], isWolf: isWolf(r, target) });
  if (r.alive.every(x => r.night.done.includes(x))) resolveNight(room);
}

// The pack only counts as done once every living Werewolf has picked the SAME player.
function packAgreed(r) {
  const wolves = aliveWolves(r);
  if (!wolves.length) return true;
  const picks = wolves.map(w => r.night.picks[w]);
  return picks.every(Boolean) && new Set(picks).size === 1;
}
function updatePack(r) {
  const wolves = aliveWolves(r);
  r.night.done = r.night.done.filter(x => !wolves.includes(x));
  if (packAgreed(r)) r.night.done.push(...wolves);
}

function plurality(map) {
  const counts = {};
  Object.values(map).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
  let max = 0, top = [];
  for (const k in counts) { if (counts[k] > max) { max = counts[k]; top = [k]; } else if (counts[k] === max) top.push(k); }
  return { counts, top };
}

function resolveNight(room) {
  const r = room.round;
  const n = r.night;
  const wolfPicks = {}; const villagerPicks = {};
  let doctorPick = null;
  Object.entries(n.picks).forEach(([k, v]) => {
    if (isWolf(r, k)) wolfPicks[k] = v;
    else if (r.roles[k] === 'doctor') doctorPick = v;
    else if (r.roles[k] === 'villager') villagerPicks[k] = v;
  });
  // The pack must agree. If they're still split (timer ran out / host ended the night), the hunt fails.
  const agreed = packAgreed(r) && aliveWolves(r).length > 0;
  const victim = agreed ? r.night.picks[aliveWolves(r)[0]] : null;
  r.lastProtected = doctorPick;
  r.dayNum++;
  const sus = plurality(villagerPicks).top;
  r.dawn = {
    victimId: null, victimName: null, victimRole: null,
    saved: !!(victim && victim === doctorPick),
    noKill: !victim,
    suspect: sus.length === 1 ? r.names[sus[0]] : null
  };
  if (victim && victim !== doctorPick) {
    r.alive = r.alive.filter(x => x !== victim);
    Object.assign(r.dawn, { victimId: victim, victimName: r.names[victim], victimRole: ROLE_NAMES[r.roles[victim]] });
  }
  r.huntFailed = !agreed;   // kept server-side only; the village just sees a quiet night
  r.night = null;
  clearTimer(r);
  r.phase = 'dawn';
  checkWin(room);
}

// ---------- day ----------
function dayVote(room, id, target) {
  const r = room.round;
  if (!r || r.phase !== 'day' || !r.alive.includes(id)) return;
  if (target !== 'skip' && (!r.alive.includes(target) || target === id)) return;
  r.votes[id] = target;
  if (r.alive.every(x => r.votes[x])) tallyDay(room);
}

function tallyDay(room) {
  const r = room.round;
  const { counts, top } = plurality(r.votes);
  let out = null;
  if (top.length === 1 && top[0] !== 'skip') out = top[0];
  r.lynch = {
    id: out, name: out ? r.names[out] : null, role: out ? ROLE_NAMES[r.roles[out]] : null,
    reason: out ? null : (top.length > 1 ? 'tie' : 'skip'),
    counts: Object.entries(counts).map(([k, v]) => ({ name: k === 'skip' ? 'Skip' : r.names[k], n: v })).sort((a, b) => b.n - a.n)
  };
  if (out) r.alive = r.alive.filter(x => x !== out);
  r.phase = 'lynch';
  checkWin(room);
}

function checkWin(room) {
  const r = room.round;
  if (!aliveWolves(r).length) return finish(room, 'village');
  if (aliveWolves(r).length >= aliveVillage(r).length) return finish(room, 'wolves');
}

function finish(room, winner) {
  const r = room.round;
  clearTimer(r);
  r.result = { winner };
  // keep dawn/lynch info so the final screen can show what just happened
  r.phase = 'results';
}

function advance(room) {
  const r = room.round;
  if (!r) return;
  if (r.phase === 'reveal') startNight(room);
  else if (r.phase === 'night') resolveNight(room);
  else if (r.phase === 'dawn') { r.votes = {}; r.phase = 'day'; }
  else if (r.phase === 'day') tallyDay(room);
  else if (r.phase === 'lynch') startNight(room);
}

function onPlayerRemoved(room, id) {
  const r = room.round;
  if (!r || r.game !== 'werewolf' || r.phase === 'results') return;
  r.alive = r.alive.filter(x => x !== id);
  delete r.votes[id];
  Object.keys(r.votes).forEach(v => { if (r.votes[v] === id) delete r.votes[v]; });
  if (r.night) { delete r.night.picks[id]; r.night.done = r.night.done.filter(x => x !== id); updatePack(r); }
  checkWin(room);
  if (r.phase === 'night' && r.alive.length && r.alive.every(x => r.night.done.includes(x))) resolveNight(room);
  if (r.phase === 'day' && r.alive.length && r.alive.every(x => r.votes[x])) tallyDay(room);
}

function publicState(room) {
  const r = room.round;
  const s = {
    game: 'werewolf',
    phase: r.phase,
    dayNum: r.dayNum,
    players: Object.keys(r.names).filter(id => room.players.some(p => p.id === id) || r.roles[id]).map(id => ({
      id, name: r.names[id], alive: r.alive.includes(id),
      role: r.phase === 'results' ? ROLE_NAMES[r.roles[id]] : null   // roles stay secret until the game ends
    })),
    nightDoneCount: r.night ? r.night.done.length : 0,
    nightEndsAt: r.night ? r.night.endsAt : null,
    serverNow: Date.now(),
    aliveCount: r.alive.length,
    dawn: r.dawn ? { victimName: r.dawn.victimName, saved: r.dawn.saved, noKill: r.dawn.noKill, suspect: r.dawn.suspect } : null,
    votedIds: r.phase === 'day' ? Object.keys(r.votes) : [],
    lynch: r.lynch ? { id: r.lynch.id, name: r.lynch.name, reason: r.lynch.reason, counts: r.lynch.counts } : null,
    result: r.result
  };
  return s;
}

module.exports = {
  init, defaultSettings, sanitizeSettings, start, advance, nightPick, dayVote, packChat, cleanup,
  resendPrivate, syncPrivate, onPlayerRemoved, publicState, MIN_PLAYERS
};
