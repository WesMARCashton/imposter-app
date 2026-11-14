// Among Us (phone version) — Crewmates do tasks around a virtual ship; Impostors hide among them.
// Roles, ship map, movement, tasks, kills, bodies, meetings + voting, sabotage (Lights, Reactor).

const { shuffle } = require('../util');

const MIN_PLAYERS = 4;

// 3x3 ship grid. Rooms connect to their up/down/left/right neighbours.
const ROOMS = [
  { id: 'storage', name: 'Storage', x: 0, y: 0 },
  { id: 'cafeteria', name: 'Cafeteria', x: 1, y: 0 },
  { id: 'bridge', name: 'Bridge', x: 2, y: 0 },
  { id: 'engine', name: 'Engine', x: 0, y: 1 },
  { id: 'hallway', name: 'Hallway', x: 1, y: 1 },
  { id: 'medbay', name: 'Medbay', x: 2, y: 1 },
  { id: 'reactor', name: 'Reactor', x: 0, y: 2 },
  { id: 'electrical', name: 'Electrical', x: 1, y: 2 },
  { id: 'admin', name: 'Admin', x: 2, y: 2 }
];
const ROOM_BY_ID = Object.fromEntries(ROOMS.map(r => [r.id, r]));
const ADJ = Object.fromEntries(ROOMS.map(r => [r.id, ROOMS.filter(o => Math.abs(o.x - r.x) + Math.abs(o.y - r.y) === 1).map(o => o.id)]));
const START_ROOM = 'cafeteria';

// type: hold | wires | sequence | slider | swipe | timing
const TASKS = [
  { id: 'garbage', name: 'Empty Garbage', room: 'cafeteria', type: 'hold', secs: 3 },
  { id: 'cafe-wires', name: 'Fix Wiring', room: 'cafeteria', type: 'wires' },
  { id: 'fuel', name: 'Fuel Engines', room: 'storage', type: 'hold', secs: 4 },
  { id: 'crates', name: 'Sort Crates', room: 'storage', type: 'sequence', n: 6 },
  { id: 'course', name: 'Chart Course', room: 'bridge', type: 'sequence', n: 5 },
  { id: 'steer', name: 'Steer Ship', room: 'bridge', type: 'slider' },
  { id: 'align', name: 'Align Engine', room: 'engine', type: 'slider' },
  { id: 'engine-wires', name: 'Fix Wiring', room: 'engine', type: 'wires' },
  { id: 'distributor', name: 'Calibrate Distributor', room: 'hallway', type: 'timing' },
  { id: 'scan', name: 'Submit Scan', room: 'medbay', type: 'hold', secs: 6 },
  { id: 'sample', name: 'Inspect Sample', room: 'medbay', type: 'sequence', n: 4 },
  { id: 'reactor-start', name: 'Start Reactor', room: 'reactor', type: 'sequence', n: 9 },
  { id: 'manifolds', name: 'Unlock Manifolds', room: 'reactor', type: 'timing' },
  { id: 'elec-wires', name: 'Fix Wiring', room: 'electrical', type: 'wires' },
  { id: 'divert', name: 'Divert Power', room: 'electrical', type: 'slider' },
  { id: 'swipe', name: 'Swipe Card', room: 'admin', type: 'swipe' },
  { id: 'upload', name: 'Upload Data', room: 'admin', type: 'hold', secs: 5 }
];
const TASK_BY_ID = Object.fromEntries(TASKS.map(t => [t.id, t]));

const MEETING_SECS = 120;
const EJECT_SECS = 8;
const REACTOR_SECS = 45;
const SABOTAGE_COOLDOWN = 30;

let io = null;
let broadcast = () => {};
function init(socketIo, broadcastFn) { io = socketIo; if (broadcastFn) broadcast = broadcastFn; }

function defaultSettings() { return { impostors: 0, tasks: 5, killCooldown: 30 }; }
function sanitizeSettings(s) {
  s = s || {};
  const imp = parseInt(s.impostors, 10);
  const tasks = parseInt(s.tasks, 10);
  const cd = parseInt(s.killCooldown, 10);
  return {
    impostors: [0, 1, 2, 3].includes(imp) ? imp : 0,
    tasks: Math.min(8, Math.max(3, tasks || 5)),
    killCooldown: [15, 30, 45, 60].includes(cd) ? cd : 30
  };
}
function impostorCount(setting, n) {
  const auto = n >= 7 ? 2 : 1;
  const want = setting || auto;
  return Math.max(1, Math.min(want, Math.floor((n - 1) / 2)));
}

const socketOf = (room, id) => { const p = room.players.find(x => x.id === id); return p && p.socketId; };
const isImp = (r, id) => r.impostorIds.includes(id);
const crewIds = (r) => r.allIds.filter(id => !isImp(r, id));

function start(room) {
  const ids = room.players.map(p => p.id);
  const s = sanitizeSettings(room.settings.amongus);
  const impostorIds = shuffle(ids).slice(0, impostorCount(s.impostors, ids.length));
  const tasks = {};
  ids.forEach(id => { tasks[id] = shuffle(TASKS).slice(0, s.tasks).map(t => ({ id: t.id, done: false })); });
  room.round = {
    game: 'amongus',
    phase: 'reveal',
    allIds: ids,
    names: Object.fromEntries(room.players.map(p => [p.id, p.name])),
    impostorIds,
    settings: s,
    pos: Object.fromEntries(ids.map(id => [id, START_ROOM])),
    alive: ids.slice(),
    tasks,
    killReadyAt: {},
    bodies: [],
    emergencyUsed: {},
    meeting: null,
    ejected: null,
    sabotage: null,
    sabotageReadyAt: 0,
    timer: null,
    reactorTimer: null,
    result: null
  };
  room.phase = 'playing';
  room.players.forEach(p => sendRole(room, p.id));
}

function sendRole(room, id) {
  const r = room.round;
  const sid = socketOf(room, id);
  if (!sid) return;
  const imp = isImp(r, id);
  io.to(sid).emit('your_role', {
    game: 'amongus',
    role: imp ? 'impostor' : 'crew',
    partners: imp ? r.impostorIds.filter(x => x !== id).map(x => r.names[x]) : []
  });
}

function progress(r) {
  let done = 0, total = 0;
  crewIds(r).forEach(id => (r.tasks[id] || []).forEach(t => { total++; if (t.done) done++; }));
  return { done, total };
}

function privateState(room, id) {
  const r = room.round;
  const here = r.pos[id];
  const imp = isImp(r, id);
  const alive = r.alive.includes(id);
  const dark = r.sabotage && r.sabotage.type === 'lights' && !imp && alive;
  const others = r.allIds.filter(x => x !== id && r.pos[x] === here && r.alive.includes(x));
  const now = Date.now();
  return {
    role: imp ? 'impostor' : 'crew',
    alive,
    room: here,
    adjacent: ADJ[here] || [],
    dark: !!dark,
    occupants: dark ? [] : others.map(x => r.names[x]),
    targets: imp && alive ? others.filter(x => !isImp(r, x)).map(x => ({ id: x, name: r.names[x] })) : [],
    killReadyIn: imp ? Math.max(0, (r.killReadyAt[id] || 0) - now) : null,
    sabotageReadyIn: imp ? Math.max(0, r.sabotageReadyAt - now) : null,
    bodiesHere: r.bodies.filter(b => b.room === here).map(b => r.names[b.victimId]),
    emergencyLeft: alive && !r.emergencyUsed[id],
    reactorPressed: !!(r.sabotage && r.sabotage.type === 'reactor' && r.sabotage.pressed.includes(id)),
    tasks: (r.tasks[id] || []).map(t => {
      const def = TASK_BY_ID[t.id];
      return { id: t.id, name: def.name, room: def.room, roomName: ROOM_BY_ID[def.room].name, type: def.type, secs: def.secs, n: def.n, done: t.done };
    })
  };
}

function syncPrivate(room) {
  const r = room.round;
  if (!r || r.game !== 'amongus') return;
  room.players.forEach(p => {
    if (p.socketId && r.allIds.includes(p.id)) io.to(p.socketId).emit('au_you', privateState(room, p.id));
  });
}

function resendPrivate(room, id) {
  const r = room.round;
  if (!r) return;
  sendRole(room, id);
  const sid = socketOf(room, id);
  if (sid && r.allIds.includes(id)) io.to(sid).emit('au_you', privateState(room, id));
}

function resetCooldowns(r) {
  const now = Date.now();
  r.impostorIds.forEach(id => { r.killReadyAt[id] = now + r.settings.killCooldown * 1000; });
  r.sabotageReadyAt = now + SABOTAGE_COOLDOWN * 1000;
}

function clearTimers(r) {
  if (r.timer) { clearTimeout(r.timer); r.timer = null; }
  if (r.reactorTimer) { clearTimeout(r.reactorTimer); r.reactorTimer = null; }
}
function cleanup(room) { if (room.round && room.round.game === 'amongus') clearTimers(room.round); }

function advance(room) {
  const r = room.round;
  if (!r) return;
  if (r.phase === 'reveal') { r.phase = 'play'; resetCooldowns(r); }
  else if (r.phase === 'meeting') tally(room);
  else if (r.phase === 'ejected') afterEject(room);
}

// ---------- kills & bodies ----------
function kill(room, id, targetId) {
  const r = room.round;
  if (!r || r.phase !== 'play' || !isImp(r, id) || !r.alive.includes(id)) return;
  if (!r.alive.includes(targetId) || isImp(r, targetId) || r.pos[targetId] !== r.pos[id]) return;
  if (Date.now() < (r.killReadyAt[id] || 0)) return;
  r.alive = r.alive.filter(x => x !== targetId);
  r.bodies.push({ victimId: targetId, room: r.pos[id] });
  r.killReadyAt[id] = Date.now() + r.settings.killCooldown * 1000;
  if (r.sabotage && r.sabotage.type === 'reactor') r.sabotage.pressed = r.sabotage.pressed.filter(x => x !== targetId);
  checkWin(room);
}

function report(room, id) {
  const r = room.round;
  if (!r || r.phase !== 'play' || !r.alive.includes(id)) return;
  const body = r.bodies.find(b => b.room === r.pos[id]);
  if (!body) return;
  startMeeting(room, { type: 'body', callerId: id, victimId: body.victimId });
}

function emergency(room, id) {
  const r = room.round;
  if (!r || r.phase !== 'play' || !r.alive.includes(id) || r.emergencyUsed[id]) return;
  if (r.sabotage && r.sabotage.type === 'reactor') return; // can't call during a meltdown
  r.emergencyUsed[id] = true;
  startMeeting(room, { type: 'emergency', callerId: id });
}

// ---------- meetings ----------
function startMeeting(room, info) {
  const r = room.round;
  clearTimers(r);
  r.sabotage = null;
  r.bodies = [];
  r.meeting = Object.assign(info, { votes: {}, endsAt: Date.now() + MEETING_SECS * 1000 });
  r.phase = 'meeting';
  r.timer = setTimeout(() => {
    if (room.round === r && r.phase === 'meeting') { tally(room); broadcast(room.code); }
  }, MEETING_SECS * 1000);
}

function vote(room, id, target) {
  const r = room.round;
  if (!r || r.phase !== 'meeting' || !r.alive.includes(id) || r.meeting.votes[id]) return;
  if (target !== 'skip' && !r.alive.includes(target)) return;
  r.meeting.votes[id] = target;
  if (r.alive.every(x => r.meeting.votes[x])) tally(room);
}

function tally(room) {
  const r = room.round;
  clearTimers(r);
  const counts = {};
  Object.values(r.meeting.votes).forEach(t => { counts[t] = (counts[t] || 0) + 1; });
  let max = 0, top = [];
  for (const k in counts) {
    if (counts[k] > max) { max = counts[k]; top = [k]; } else if (counts[k] === max) top.push(k);
  }
  let ejectedId = null;
  if (top.length === 1 && top[0] !== 'skip') ejectedId = top[0];
  if (ejectedId) r.alive = r.alive.filter(x => x !== ejectedId);
  r.ejected = {
    id: ejectedId,
    name: ejectedId ? r.names[ejectedId] : null,
    wasImpostor: ejectedId ? isImp(r, ejectedId) : null,
    reason: ejectedId ? null : (top.length > 1 ? 'tie' : 'skip'),
    impostorsLeft: r.alive.filter(x => isImp(r, x)).length,
    counts: Object.entries(counts).map(([k, n]) => ({ name: k === 'skip' ? 'Skipped' : r.names[k], n })).sort((a, b) => b.n - a.n)
  };
  r.meeting = null;
  r.phase = 'ejected';
  r.timer = setTimeout(() => {
    if (room.round === r && r.phase === 'ejected') { afterEject(room); broadcast(room.code); }
  }, EJECT_SECS * 1000);
}

function afterEject(room) {
  const r = room.round;
  clearTimers(r);
  r.ejected = null;
  r.phase = 'play';
  r.allIds.forEach(id => { r.pos[id] = START_ROOM; });
  resetCooldowns(r);
  checkWin(room);
}

// ---------- sabotage ----------
function sabotage(room, id, type) {
  const r = room.round;
  if (!r || r.phase !== 'play' || !isImp(r, id) || !r.alive.includes(id)) return;
  if (r.sabotage || Date.now() < r.sabotageReadyAt) return;
  if (type === 'lights') r.sabotage = { type: 'lights' };
  else if (type === 'reactor') {
    r.sabotage = { type: 'reactor', endsAt: Date.now() + REACTOR_SECS * 1000, pressed: [] };
    r.reactorTimer = setTimeout(() => {
      if (room.round === r && r.phase === 'play' && r.sabotage && r.sabotage.type === 'reactor') {
        finish(room, 'impostors', 'meltdown');
        broadcast(room.code);
      }
    }, REACTOR_SECS * 1000);
  }
}

function fixSabotage(room, id) {
  const r = room.round;
  if (!r || r.phase !== 'play' || !r.alive.includes(id) || !r.sabotage) return;
  const s = r.sabotage;
  if (s.type === 'lights' && r.pos[id] === 'electrical') endSabotage(r);
  else if (s.type === 'reactor' && r.pos[id] === 'reactor') {
    if (!s.pressed.includes(id)) s.pressed.push(id);
    s.pressed = s.pressed.filter(x => r.pos[x] === 'reactor' && r.alive.includes(x));
    if (s.pressed.length >= 2) endSabotage(r);
  }
}

function endSabotage(r) {
  if (r.reactorTimer) { clearTimeout(r.reactorTimer); r.reactorTimer = null; }
  r.sabotage = null;
  r.sabotageReadyAt = Date.now() + SABOTAGE_COOLDOWN * 1000;
}

function move(room, id, to) {
  const r = room.round;
  if (!r || r.phase !== 'play' || !r.allIds.includes(id)) return;
  if (!(ADJ[r.pos[id]] || []).includes(to)) return;
  r.pos[id] = to;
  if (r.sabotage && r.sabotage.type === 'reactor') r.sabotage.pressed = r.sabotage.pressed.filter(x => x !== id);
}

function completeTask(room, id, taskId) {
  const r = room.round;
  if (!r || r.phase !== 'play' || !r.allIds.includes(id)) return;
  const t = (r.tasks[id] || []).find(x => x.id === taskId);
  if (!t || t.done || TASK_BY_ID[taskId].room !== r.pos[id]) return;
  t.done = true;
  if (isImp(r, id)) return; // fake tasks don't count
  checkWin(room);
}

function checkWin(room) {
  const r = room.round;
  if (r.phase === 'results') return;
  const p = progress(r);
  if (p.total > 0 && p.done >= p.total) return finish(room, 'crew', 'tasks');
  const aliveImp = r.alive.filter(id => isImp(r, id)).length;
  const aliveCrew = r.alive.filter(id => !isImp(r, id)).length;
  if (aliveImp === 0) return finish(room, 'crew', 'impostors_out');
  if (aliveImp >= aliveCrew) return finish(room, 'impostors', 'outnumbered');
}

function finish(room, winner, reason) {
  const r = room.round;
  clearTimers(r);
  r.result = { winner, reason };
  r.phase = 'results';
}

function onPlayerRemoved(room, id) {
  const r = room.round;
  if (!r || r.game !== 'amongus' || r.phase === 'results') return;
  r.allIds = r.allIds.filter(x => x !== id);
  r.alive = r.alive.filter(x => x !== id);
  r.impostorIds = r.impostorIds.filter(x => x !== id);
  delete r.tasks[id];
  delete r.pos[id];
  if (r.meeting) {
    delete r.meeting.votes[id];
    Object.keys(r.meeting.votes).forEach(v => { if (r.meeting.votes[v] === id) delete r.meeting.votes[v]; });
  }
  r.bodies = r.bodies.filter(b => b.victimId !== id);
  checkWin(room);
  if (r.phase === 'meeting' && r.alive.length && r.alive.every(x => r.meeting.votes[x])) tally(room);
}

function publicState(room) {
  const r = room.round;
  const p = progress(r);
  const s = {
    game: 'amongus',
    phase: r.phase,
    rooms: ROOMS,
    taskDone: p.done,
    taskTotal: p.total,
    playerCount: r.allIds.length,
    serverNow: Date.now(),
    sabotage: r.sabotage ? { type: r.sabotage.type, endsAt: r.sabotage.endsAt || null, pressedCount: r.sabotage.pressed ? r.sabotage.pressed.length : 0 } : null,
    meeting: null,
    ejected: r.phase === 'ejected' ? r.ejected : null,
    result: null
  };
  if (r.phase === 'meeting') {
    const m = r.meeting;
    s.meeting = {
      type: m.type,
      callerName: r.names[m.callerId],
      victimName: m.victimId ? r.names[m.victimId] : null,
      endsAt: m.endsAt,
      votedIds: Object.keys(m.votes),
      players: r.allIds.map(id => ({ id, name: r.names[id], alive: r.alive.includes(id) }))
    };
  }
  if (r.phase === 'results') {
    s.result = {
      ...r.result,
      impostors: r.impostorIds.map(id => r.names[id]),
      players: r.allIds.map(id => ({
        name: r.names[id],
        role: isImp(r, id) ? 'impostor' : 'crew',
        alive: r.alive.includes(id),
        tasksDone: (r.tasks[id] || []).filter(t => t.done).length,
        tasksTotal: (r.tasks[id] || []).length
      }))
    };
  }
  return s;
}

module.exports = {
  init, defaultSettings, sanitizeSettings, start, advance, move, completeTask,
  kill, report, emergency, vote, sabotage, fixSabotage, cleanup,
  resendPrivate, syncPrivate, onPlayerRemoved, publicState, MIN_PLAYERS, ROOMS
};
