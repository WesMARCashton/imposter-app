const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { CATEGORY_LABELS, pickWordPair } = require('./words');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ---- Room store (in-memory) ----
// rooms[code] = {
//   code, hostId, phase, settings,
//   players: [{id, name, connected, socketId}],
//   round: { assignments, order, readyIds, votes, eliminatedId, mrWhiteId, mrWhiteGuess, winner }
// }
const rooms = {};

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function genId() {
  return crypto.randomBytes(8).toString('hex');
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    settings: room.settings,
    players: room.players.map(p => ({ id: p.id, name: p.name, connected: p.connected })),
    round: room.round ? {
      phase: room.round.phase,
      order: room.round.order,
      totalCount: room.players.length,
      votesCount: room.round.votes ? Object.keys(room.round.votes).length : 0,
      eliminatedId: room.round.eliminatedId || null,
      mrWhiteId: room.round.phase === 'results' ? room.round.mrWhiteId : undefined,
      winner: room.round.winner || null,
      revealedRoles: room.round.phase === 'results' ? room.round.publicRoles : undefined,
      awaitingMrWhiteGuess: room.round.awaitingMrWhiteGuess || false,
      category: room.round.category
    } : null
  };
}

function broadcastRoom(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('room_update', publicRoom(room));
}

function findRoomByPlayer(playerId) {
  for (const code in rooms) {
    if (rooms[code].players.some(p => p.id === playerId)) return rooms[code];
  }
  return null;
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ name }, cb) => {
    if (!name || !name.trim()) return cb({ ok: false, error: 'Name required' });
    const code = genCode();
    const playerId = genId();
    rooms[code] = {
      code,
      hostId: playerId,
      phase: 'lobby',
      settings: { imposterCount: 1, mrWhite: false, difficulty: 'medium' },
      players: [{ id: playerId, name: name.trim().slice(0, 20), connected: true, socketId: socket.id }],
      round: null
    };
    socket.join(code);
    socket.data.playerId = playerId;
    socket.data.roomCode = code;
    cb({ ok: true, code, playerId });
    broadcastRoom(code);
  });

  socket.on('join_room', ({ code, name }, cb) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) return cb({ ok: false, error: 'Room not found' });
    if (room.phase !== 'lobby') return cb({ ok: false, error: 'Game already in progress' });
    if (!name || !name.trim()) return cb({ ok: false, error: 'Name required' });
    const playerId = genId();
    room.players.push({ id: playerId, name: name.trim().slice(0, 20), connected: true, socketId: socket.id });
    socket.join(code);
    socket.data.playerId = playerId;
    socket.data.roomCode = code;
    cb({ ok: true, code, playerId });
    broadcastRoom(code);
  });

  socket.on('rejoin_room', ({ code, playerId }, cb) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) return cb({ ok: false, error: 'Room not found' });
    const player = room.players.find(p => p.id === playerId);
    if (!player) return cb({ ok: false, error: 'Player not found' });
    player.connected = true;
    player.socketId = socket.id;
    socket.join(code);
    socket.data.playerId = playerId;
    socket.data.roomCode = code;
    cb({ ok: true, code, playerId, room: publicRoom(room) });
    // If mid-round, resend private role info
    if (room.round && room.round.assignments && room.round.assignments[playerId]) {
      socket.emit('your_role', room.round.assignments[playerId]);
    }
    broadcastRoom(code);
  });

  socket.on('kick_player', ({ code, playerId, targetId }) => {
    const room = rooms[code];
    if (!room || room.hostId !== playerId || room.phase !== 'lobby') return;
    room.players = room.players.filter(p => p.id !== targetId);
    broadcastRoom(code);
  });

  socket.on('update_settings', ({ code, playerId, settings }) => {
    const room = rooms[code];
    if (!room || room.hostId !== playerId || room.phase !== 'lobby') return;
    const maxImposters = Math.max(1, Math.floor(room.players.length / 3));
    room.settings.imposterCount = Math.min(Math.max(1, settings.imposterCount || 1), maxImposters);
    room.settings.mrWhite = !!settings.mrWhite;
    room.settings.difficulty = ['easy', 'medium', 'hard', 'all'].includes(settings.difficulty) ? settings.difficulty : 'medium';
    broadcastRoom(code);
  });

  socket.on('start_game', ({ code, playerId }, cb) => {
    const room = rooms[code];
    if (!room || room.hostId !== playerId) return cb && cb({ ok: false, error: 'Not host' });
    if (room.players.length < 3) return cb && cb({ ok: false, error: 'Need at least 3 players' });

    const ids = room.players.map(p => p.id);
    const shuffled = [...ids].sort(() => Math.random() - 0.5);

    let mrWhiteId = null;
    let pool = shuffled;
    if (room.settings.mrWhite) {
      mrWhiteId = pool[0];
      pool = pool.slice(1);
    }
    const impCount = Math.min(room.settings.imposterCount, Math.max(1, Math.floor(pool.length / 2)));
    const imposterIds = pool.slice(0, impCount);
    const civilianIds = pool.slice(impCount);

    const [civWord, impWord] = pickWordPair(room.settings.difficulty);
    const assignments = {};
    civilianIds.forEach(id => { assignments[id] = { role: 'civilian', word: civWord }; });
    imposterIds.forEach(id => { assignments[id] = { role: 'imposter', word: impWord }; });
    if (mrWhiteId) assignments[mrWhiteId] = { role: 'mrwhite', word: null };

    room.round = {
      assignments,
      order: shuffled.map(id => room.players.find(p => p.id === id).name),
      orderIds: shuffled,
      votes: {},
      eliminatedId: null,
      mrWhiteId,
      civilianIds, imposterIds,
      civWord, impWord,
      phase: 'reveal',
      category: CATEGORY_LABELS[room.settings.difficulty],
      awaitingMrWhiteGuess: false,
      winner: null,
      publicRoles: null
    };
    room.phase = 'reveal';

    // Send each player their private role
    room.players.forEach(p => {
      const info = assignments[p.id];
      io.to(p.socketId).emit('your_role', {
        role: info.role,
        word: info.word,
        category: CATEGORY_LABELS[room.settings.difficulty]
      });
    });

    cb && cb({ ok: true });
    broadcastRoom(code);
  });

  socket.on('advance_phase', ({ code, playerId, to }) => {
    const room = rooms[code];
    if (!room || room.hostId !== playerId || !room.round) return;
    const allowed = { reveal: 'order', order: 'discuss', discuss: 'vote' };
    if (allowed[room.round.phase] === to) {
      room.round.phase = to;
      broadcastRoom(code);
    }
  });

  socket.on('cast_vote', ({ code, playerId, targetId }) => {
    const room = rooms[code];
    if (!room || !room.round || room.round.phase !== 'vote') return;
    room.round.votes[playerId] = targetId;
    if (Object.keys(room.round.votes).length >= room.players.length) {
      resolveVote(room);
    }
    broadcastRoom(code);
  });

  socket.on('force_tally', ({ code, playerId }) => {
    const room = rooms[code];
    if (!room || room.hostId !== playerId || !room.round || room.round.phase !== 'vote') return;
    resolveVote(room);
    broadcastRoom(code);
  });

  socket.on('mrwhite_guess', ({ code, playerId, guess }) => {
    const room = rooms[code];
    if (!room || !room.round || room.round.mrWhiteId !== playerId) return;
    room.round.awaitingMrWhiteGuess = false;
    const correct = guess && guess.trim().toLowerCase() === room.round.civWord.toLowerCase();
    room.round.winner = correct ? 'mrwhite' : computeWinnerAfterElimination(room);
    finalizeResults(room);
    broadcastRoom(code);
  });

  socket.on('play_again', ({ code, playerId }) => {
    const room = rooms[code];
    if (!room || room.hostId !== playerId) return;
    room.phase = 'lobby';
    room.round = null;
    broadcastRoom(code);
  });

  socket.on('leave_room', () => handleDisconnect(socket));
  socket.on('disconnect', () => handleDisconnect(socket));
});

function handleDisconnect(socket) {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code || !rooms[code]) return;
  const room = rooms[code];
  const player = room.players.find(p => p.id === playerId);
  if (player) player.connected = false;
  broadcastRoom(code);
}

function resolveVote(room) {
  const tally = {};
  Object.values(room.round.votes).forEach(t => { if (t) tally[t] = (tally[t] || 0) + 1; });
  let max = 0, winners = [];
  for (const id in tally) {
    if (tally[id] > max) { max = tally[id]; winners = [id]; }
    else if (tally[id] === max) { winners.push(id); }
  }
  if (winners.length !== 1) {
    // tie or no votes -> no elimination
    room.round.eliminatedId = null;
    room.round.winner = computeWinnerAfterElimination(room);
    finalizeResults(room);
    return;
  }
  room.round.eliminatedId = winners[0];
  if (room.round.mrWhiteId === winners[0]) {
    room.round.awaitingMrWhiteGuess = true;
    room.round.phase = 'results';
    return; // wait for mrwhite_guess event
  }
  room.round.winner = computeWinnerAfterElimination(room);
  finalizeResults(room);
}

function computeWinnerAfterElimination(room) {
  const remainingIds = room.orderIdsRemaining || room.round.orderIds.filter(id => id !== room.round.eliminatedId);
  const remainingImposters = room.round.imposterIds.filter(id => remainingIds.includes(id)).length;
  const remainingCivilians = room.round.civilianIds.filter(id => remainingIds.includes(id)).length;
  if (remainingImposters === 0) return 'civilians';
  if (remainingImposters >= remainingCivilians) return 'imposters';
  return null; // game would continue in a multi-round version; v1 ends after one elimination
}

function finalizeResults(room) {
  room.round.phase = 'results';
  const roomPlayers = room.players;
  room.round.publicRoles = roomPlayers.map(p => ({
    id: p.id,
    name: p.name,
    role: room.round.assignments[p.id].role,
    word: room.round.assignments[p.id].role === 'civilian' ? room.round.civWord
        : room.round.assignments[p.id].role === 'imposter' ? room.round.impWord
        : null
  }));
  if (!room.round.winner) room.round.winner = 'undecided';
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
