// Among Us (phone version) — Crewmates do tasks around a virtual ship; Impostors hide among them.
// Step 1: roles, ship map, movement, tasks, task bar, crew task win.
// Step 2 (next): kills, bodies, report/emergency meetings, voting. Step 3: sabotage.

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

let io = null;
function init(socketIo) { io = socketIo; }

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
  return {
    role: isImp(r, id) ? 'impostor' : 'crew',
    alive: r.alive.includes(id),
    room: here,
    adjacent: ADJ[here] || [],
    occupants: r.allIds.filter(x => x !== id && r.pos[x] === here && r.alive.includes(x)).map(x => r.names[x]),
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

function advance(room) {
  const r = room.round;
  if (r && r.phase === 'reveal') r.phase = 'play';
}

function move(room, id, to) {
  const r = room.round;
  if (!r || r.phase !== 'play' || !r.allIds.includes(id)) return;
  if (!(ADJ[r.pos[id]] || []).includes(to)) return;
  r.pos[id] = to;
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
  checkWin(room);
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
    result: null
  };
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
  resendPrivate, syncPrivate, onPlayerRemoved, publicState, MIN_PLAYERS, ROOMS
};
