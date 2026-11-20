const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { CATEGORY_LABELS, pickWordPair } = require('./words');
const { shuffle: fisherYatesShuffle, genId } = require('./util');
const weasel = require('./games/weasel');
const offmap = require('./games/offmap');
const amongus = require('./games/amongus');
const clue = require('./games/clue');
const target = require('./games/target');
const werewolf = require('./games/werewolf');
const calledshot = require('./games/calledshot');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
weasel.init(io);
offmap.init(io, (code) => broadcastRoom(code));
amongus.init(io, (code) => broadcastRoom(code));
clue.init(io);
target.init(io);
werewolf.init(io);
calledshot.init(io);
const MODULES = { weasel, offmap, amongus, clue, target, werewolf, calledshot };
const GAMES = ['undercover', ...Object.keys(MODULES)];
const moduleOf = (room) => room && room.round && MODULES[room.round.game];

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

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    settings: room.settings,
    players: room.players.map(p => ({ id: p.id, name: p.name, connected: p.connected })),
    round: moduleOf(room) ? moduleOf(room).publicState(room) : room.round ? {
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
  const mod = moduleOf(room);
  if (mod && mod.syncPrivate) mod.syncPrivate(room);
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
      settings: { game: 'undercover', imposterCount: 1, mrWhite: false, difficulty: 'medium', weasel: weasel.defaultSettings(), offmap: offmap.defaultSettings(), amongus: amongus.defaultSettings(), clue: clue.defaultSettings(), target: target.defaultSettings(), werewolf: werewolf.defaultSettings(), calledshot: calledshot.defaultSettings() },
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
    if (moduleOf(room)) {
      moduleOf(room).resendPrivate(room, playerId);
    } else if (room.round && room.round.assignments && room.round.assignments[playerId]) {
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
    if (GAMES.includes(settings.game)) room.settings.game = settings.game;
    if (settings.weasel) room.settings.weasel = weasel.sanitizeSettings(settings.weasel);
    if (settings.offmap) room.settings.offmap = offmap.sanitizeSettings(settings.offmap);
    if (settings.amongus) room.settings.amongus = amongus.sanitizeSettings(settings.amongus);
    if (settings.target) room.settings.target = target.sanitizeSettings(settings.target);
    if (settings.werewolf) room.settings.werewolf = werewolf.sanitizeSettings(settings.werewolf);
    if (settings.calledshot) room.settings.calledshot = calledshot.sanitizeSettings(settings.calledshot);
    const maxImposters = Math.max(1, Math.floor(room.players.length / 3));
    room.settings.imposterCount = Math.min(Math.max(1, settings.imposterCount || 1), maxImposters);
    room.settings.mrWhite = !!settings.mrWhite;
    room.settings.difficulty = ['easy', 'medium', 'hard', 'all'].includes(settings.difficulty) ? settings.difficulty : 'medium';
    broadcastRoom(code);
  });

  socket.on('start_game', ({ code, playerId }, cb) => {
    const room = rooms[code];
    if (!room || room.hostId !== playerId) return cb && cb({ ok: false, error: 'Not host' });
    if (room.round) return cb && cb({ ok: false, error: 'Game already running' });
    const mod = MODULES[room.settings.game];
    if (mod) {
      if (room.players.length < mod.MIN_PLAYERS) return cb && cb({ ok: false, error: `Need at least ${mod.MIN_PLAYERS} players` });
      if (mod.MAX_PLAYERS && room.players.length > mod.MAX_PLAYERS) return cb && cb({ ok: false, error: `Max ${mod.MAX_PLAYERS} players for this game` });
      mod.start(room);
      cb && cb({ ok: true });
      broadcastRoom(code);
      return;
    }
    if (room.players.length < 3) return cb && cb({ ok: false, error: 'Need at least 3 players' });

    const ids = room.players.map(p => p.id);
    const rolePool = fisherYatesShuffle(ids);

    let mrWhiteId = null;
    let pool = rolePool;
    if (room.settings.mrWhite) {
      mrWhiteId = pool[0];
      pool = pool.slice(1);
    }
    const impCount = Math.min(room.settings.imposterCount, Math.max(1, Math.floor(pool.length / 2)));
    const imposterIds = pool.slice(0, impCount);
    const civilianIds = pool.slice(impCount);

    const speakingOrderIds = fisherYatesShuffle(ids);

    const [civWord, impWord] = pickWordPair(room.settings.difficulty);
    const assignments = {};
    civilianIds.forEach(id => { assignments[id] = { role: 'civilian', word: civWord }; });
    imposterIds.forEach(id => { assignments[id] = { role: 'imposter', word: impWord }; });
    if (mrWhiteId) assignments[mrWhiteId] = { role: 'mrwhite', word: null };

    room.round = {
      assignments,
      order: speakingOrderIds.map(id => room.players.find(p => p.id === id).name),
      orderIds: speakingOrderIds,
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
    if (moduleOf(room)) return;
    if (!room || room.hostId !== playerId || !room.round) return;
    const allowed = { reveal: 'order', order: 'discuss', discuss: 'vote' };
    if (allowed[room.round.phase] === to) {
      room.round.phase = to;
      broadcastRoom(code);
    }
  });

  socket.on('cast_vote', ({ code, playerId, targetId }) => {
    const room = rooms[code];
    if (moduleOf(room)) return;
    if (!room || !room.round || room.round.phase !== 'vote') return;
    room.round.votes[playerId] = targetId;
    if (Object.keys(room.round.votes).length >= room.players.length) {
      resolveVote(room);
    }
    broadcastRoom(code);
  });

  socket.on('force_tally', ({ code, playerId }) => {
    const room = rooms[code];
    if (moduleOf(room)) return;
    if (!room || room.hostId !== playerId || !room.round || room.round.phase !== 'vote') return;
    resolveVote(room);
    broadcastRoom(code);
  });

  socket.on('mrwhite_guess', ({ code, playerId, guess }) => {
    const room = rooms[code];
    if (moduleOf(room)) return;
    if (!room || !room.round || room.round.mrWhiteId !== playerId) return;
    room.round.awaitingMrWhiteGuess = false;
    const correct = guess && guess.trim().toLowerCase() === room.round.civWord.toLowerCase();
    room.round.winner = correct ? 'mrwhite' : computeWinnerAfterElimination(room);
    finalizeResults(room);
    broadcastRoom(code);
  });

  // ---- The Weasel ----
  socket.on('w_advance', ({ code, playerId }) => {
    const room = rooms[code];
    if (!room || room.hostId !== playerId || !room.round || room.round.game !== 'weasel') return;
    weasel.advance(room);
    broadcastRoom(code);
  });

  socket.on('w_submit', ({ code, playerId, value }) => {
    const room = rooms[code];
    if (!room || !room.round || room.round.game !== 'weasel') return;
    weasel.submit(room, playerId, value);
    broadcastRoom(code);
  });

  socket.on('w_quiz_submit', ({ code, playerId, answers }) => {
    const room = rooms[code];
    if (!room || !room.round || room.round.game !== 'weasel') return;
    weasel.submitQuiz(room, playerId, answers);
    broadcastRoom(code);
  });

  socket.on('client_error', (info) => {
    try { console.error('[client_error]', JSON.stringify(info).slice(0, 1500)); } catch (e) { /* ignore */ }
  });

  // ---- Werewolf / Called Shot ----
  const modAction = (game, ev, fn, hostOnly) => socket.on(ev, (d) => {
    const room = d && rooms[d.code];
    if (!room || !room.round || room.round.game !== game) return;
    if (hostOnly && room.hostId !== d.playerId) return;
    fn(room, d, room.hostId === d.playerId);
    broadcastRoom(d.code);
  });
  modAction('werewolf', 'ww_advance', (room) => werewolf.advance(room), true);
  modAction('werewolf', 'ww_night', (room, d) => werewolf.nightPick(room, d.playerId, d.target));
  modAction('werewolf', 'ww_vote', (room, d) => werewolf.dayVote(room, d.playerId, d.target));
  modAction('calledshot', 'cs_call', (room, d) => calledshot.callShot(room, d.playerId, d.option));
  modAction('calledshot', 'cs_bet', (room, d) => calledshot.bet(room, d.playerId, d.choice));
  modAction('calledshot', 'cs_report', (room, d, isHost) => calledshot.report(room, d.playerId, !!d.hit, isHost));
  modAction('calledshot', 'cs_next', (room, d, isHost) => calledshot.next(room, d.playerId, isHost));
  modAction('calledshot', 'cs_force_throw', (room) => calledshot.forceThrow(room), true);
  modAction('calledshot', 'cs_end', (room) => calledshot.endEarly(room), true);

  // ---- Hit the Number ----
  const tgAction = (ev, fn, hostOnly) => socket.on(ev, (d) => {
    const room = d && rooms[d.code];
    if (!room || !room.round || room.round.game !== 'target') return;
    if (hostOnly && room.hostId !== d.playerId) return;
    fn(room, d);
    broadcastRoom(d.code);
  });
  tgAction('tg_advance', (room) => target.advance(room), true);
  tgAction('tg_back', (room) => target.backToPlay(room), true);
  tgAction('tg_vote', (room, d) => target.vote(room, d.playerId, d.targetId));
  tgAction('tg_guess', (room, d) => target.guess(room, d.playerId, d.value));

  // ---- Clue ----
  const clueAction = (ev, fn, hostOnly) => socket.on(ev, (d) => {
    const room = d && rooms[d.code];
    if (!room || !room.round || room.round.game !== 'clue') return;
    if (hostOnly && room.hostId !== d.playerId) return;
    fn(room, d);
    broadcastRoom(d.code);
  });
  clueAction('clue_advance', (room) => clue.advance(room), true);
  clueAction('clue_suggest', (room, d) => clue.suggest(room, d.playerId, d.suspect, d.weapon, d.room));
  clueAction('clue_refute', (room, d) => clue.refute(room, d.playerId, d.card));
  clueAction('clue_end_turn', (room, d) => clue.endTurn(room, d.playerId, false));
  clueAction('clue_skip_turn', (room, d) => clue.endTurn(room, d.playerId, true), true);
  clueAction('clue_accuse', (room, d) => clue.accuse(room, d.playerId, d.suspect, d.weapon, d.room));

  // ---- Among Us ----
  const auRoom = (code) => { const room = rooms[code]; return room && room.round && room.round.game === 'amongus' ? room : null; };
  socket.on('au_advance', ({ code, playerId }) => {
    const room = auRoom(code);
    if (!room || room.hostId !== playerId) return;
    amongus.advance(room);
    broadcastRoom(code);
  });
  socket.on('au_move', ({ code, playerId, to }) => {
    const room = auRoom(code);
    if (!room) return;
    amongus.move(room, playerId, to);
    broadcastRoom(code);
  });
  socket.on('au_task', ({ code, playerId, taskId }) => {
    const room = auRoom(code);
    if (!room) return;
    amongus.completeTask(room, playerId, taskId);
    broadcastRoom(code);
  });
  const auAction = (ev, fn) => socket.on(ev, (data) => {
    const room = auRoom(data && data.code);
    if (!room) return;
    fn(room, data);
    broadcastRoom(data.code);
  });
  auAction('au_kill', (room, d) => amongus.kill(room, d.playerId, d.targetId));
  auAction('au_report', (room, d) => amongus.report(room, d.playerId));
  auAction('au_emergency', (room, d) => amongus.emergency(room, d.playerId));
  auAction('au_vote', (room, d) => amongus.vote(room, d.playerId, d.target));
  auAction('au_sabotage', (room, d) => amongus.sabotage(room, d.playerId, d.type));
  auAction('au_fix', (room, d) => amongus.fixSabotage(room, d.playerId));

  // ---- Off the Map ----
  socket.on('om_advance', ({ code, playerId }) => {
    const room = rooms[code];
    if (!room || room.hostId !== playerId || !room.round || room.round.game !== 'offmap') return;
    offmap.advance(room);
    broadcastRoom(code);
  });

  socket.on('om_request_vote', ({ code, playerId, on }) => {
    const room = rooms[code];
    if (!room || !room.round || room.round.game !== 'offmap') return;
    offmap.requestVote(room, playerId, !!on);
    broadcastRoom(code);
  });

  socket.on('om_cancel_vote', ({ code, playerId }) => {
    const room = rooms[code];
    if (!room || room.hostId !== playerId || !room.round || room.round.game !== 'offmap') return;
    offmap.cancelVote(room);
    broadcastRoom(code);
  });

  socket.on('om_vote', ({ code, playerId, targetId }) => {
    const room = rooms[code];
    if (!room || !room.round || room.round.game !== 'offmap') return;
    offmap.vote(room, playerId, targetId);
    broadcastRoom(code);
  });

  socket.on('om_guess', ({ code, playerId, location }) => {
    const room = rooms[code];
    if (!room || !room.round || room.round.game !== 'offmap') return;
    offmap.spyGuess(room, playerId, location);
    broadcastRoom(code);
  });

  socket.on('play_again', ({ code, playerId }) => {
    const room = rooms[code];
    if (!room || room.hostId !== playerId) return;
    if (room.round && room.round.timer) clearTimeout(room.round.timer);
    if (moduleOf(room) && moduleOf(room).cleanup) moduleOf(room).cleanup(room);
    room.phase = 'lobby';
    room.round = null;
    broadcastRoom(code);
  });

  socket.on('leave_room', ({ code, playerId }, cb) => {
    const room = rooms[code];
    if (!room) { cb && cb({ ok: true }); return; }
    removePlayer(room, playerId);
    socket.leave(code);
    socket.data.playerId = null;
    socket.data.roomCode = null;
    if (room.players.length === 0) {
      delete rooms[code];
    } else {
      broadcastRoom(code);
    }
    cb && cb({ ok: true });
  });

  socket.on('end_game', ({ code, playerId }) => {
    const room = rooms[code];
    if (!room || room.hostId !== playerId) return;
    io.to(code).emit('room_ended');
    const roomSockets = io.sockets.adapter.rooms.get(code);
    if (roomSockets) {
      roomSockets.forEach(sid => {
        const s = io.sockets.sockets.get(sid);
        if (s) { s.leave(code); s.data.playerId = null; s.data.roomCode = null; }
      });
    }
    if (room.round && room.round.timer) clearTimeout(room.round.timer);
    if (moduleOf(room) && moduleOf(room).cleanup) moduleOf(room).cleanup(room);
    delete rooms[code];
  });

  socket.on('disconnect', () => handleDisconnect(socket));
});

function removePlayer(room, playerId) {
  room.players = room.players.filter(p => p.id !== playerId);
  if (moduleOf(room)) moduleOf(room).onPlayerRemoved(room, playerId);
  if (room.hostId === playerId) {
    room.hostId = room.players.length ? room.players[0].id : null;
  }
}

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
