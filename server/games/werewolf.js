// Werewolf — the app is the narrator. Night: Werewolves pick a victim, the Seer checks
// someone, the Doctor protects someone, Villagers mark a suspect (so everyone is tapping).
// Day: discuss and vote someone out. Roles are revealed when a player dies.

const { shuffle } = require('../util');

const MIN_PLAYERS = 5;
const ROLE_NAMES = { wolf: 'Werewolf', seer: 'Seer', doctor: 'Doctor', villager: 'Villager' };

let io = null;
function init(socketIo) { io = socketIo; }

function defaultSettings() { return { wolves: 0, seer: true, doctor: true }; }
function sanitizeSettings(s) {
  s = s || {};
  const w = parseInt(s.wolves, 10);
  return { wolves: [0, 1, 2, 3].includes(w) ? w : 0, seer: s.seer !== false, doctor: s.doctor !== false };
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
    if (role === 'wolf') out.wolfVotes = Object.entries(n.picks).filter(([k]) => isWolf(r, k)).map(([k, v]) => ({ wolf: r.names[k], target: r.names[v] }));
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
function startNight(room) {
  const r = room.round;
  r.night = { picks: {}, done: [] };
  r.dawn = null; r.lynch = null; r.votes = {};
  r.phase = 'night';
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
  if (!r.night.done.includes(id)) r.night.done.push(id);
  if (role === 'seer') r.seerResults.push({ night: r.dayNum + 1, name: r.names[target], isWolf: isWolf(r, target) });
  if (r.alive.every(x => r.night.done.includes(x))) resolveNight(room);
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
  const { top } = plurality(wolfPicks);
  const victim = top.length ? shuffle(top)[0] : null;   // wolves split = random pick among their top choices
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
  r.night = null;
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
  if (r.night) { delete r.night.picks[id]; r.night.done = r.night.done.filter(x => x !== id); }
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
    aliveCount: r.alive.length,
    dawn: r.dawn ? { victimName: r.dawn.victimName, saved: r.dawn.saved, noKill: r.dawn.noKill, suspect: r.dawn.suspect } : null,
    votedIds: r.phase === 'day' ? Object.keys(r.votes) : [],
    lynch: r.lynch ? { id: r.lynch.id, name: r.lynch.name, reason: r.lynch.reason, counts: r.lynch.counts } : null,
    result: r.result
  };
  return s;
}

module.exports = {
  init, defaultSettings, sanitizeSettings, start, advance, nightPick, dayVote,
  resendPrivate, syncPrivate, onPlayerRemoved, publicState, MIN_PLAYERS
};
