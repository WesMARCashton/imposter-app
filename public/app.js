(function () {
  const socket = io();
  const root = document.getElementById('app');

  let state = {
    view: 'home', // home | host-name | join-name | lobby | reveal | order | discuss | vote | results
    code: null,
    playerId: null,
    isHost: false,
    room: null, // last room_update payload
    myRole: null, // {role, word, category}
    peeking: false,
    error: '',
    voteTarget: null,
    timerSeconds: 0,
    timerHandle: null
  };

  // ---- persistence for reconnect ----
  function saveSession() {
    if (state.code && state.playerId) {
      localStorage.setItem('undercover_session', JSON.stringify({ code: state.code, playerId: state.playerId }));
    }
  }
  function clearSession() { localStorage.removeItem('undercover_session'); }

  function render() { root.innerHTML = ''; VIEWS[state.view](); }

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (v === null || v === undefined) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function brand() {
    return el('div', { class: 'brand' }, [el('div', { class: 'dot' }), el('span', { text: 'UNDERCOVER' })]);
  }

  function screen(children, opts = {}) {
    const s = el('div', { class: 'screen' }, children);
    root.appendChild(s);
  }

  // ---------------- VIEWS ----------------

  const VIEWS = {};

  VIEWS.home = function () {
    screen([
      brand(),
      el('h1', { text: 'Trust no one.' }),
      el('p', { text: 'A local party game of hidden words and social deduction. Everyone plays from their own phone.' }),
      el('div', { class: 'stack top' }, [
        el('button', { class: 'primary', text: 'Host a Game', onclick: () => { state.view = 'host-name'; render(); } }),
        el('button', { class: 'secondary', text: 'Join a Game', onclick: () => { state.view = 'join-name'; render(); } })
      ])
    ]);
  };

  VIEWS['host-name'] = function () {
    const input = el('input', { type: 'text', placeholder: 'Your name', maxlength: '20' });
    screen([
      brand(),
      el('h2', { text: 'Host a game' }),
      el('p', { text: 'Pick a name. You will control the game from this device.' }),
      input,
      el('div', { class: 'error-text', text: state.error }),
      el('div', { class: 'stack top' }, [
        el('button', {
          class: 'primary', text: 'Create Room', onclick: () => {
            const name = input.value.trim();
            if (!name) { state.error = 'Enter a name'; render(); return; }
            socket.emit('create_room', { name }, (res) => {
              if (!res.ok) { state.error = res.error; render(); return; }
              state.code = res.code; state.playerId = res.playerId; state.isHost = true;
              saveSession(); state.view = 'lobby'; state.error = ''; render();
            });
          }
        }),
        el('button', { class: 'ghost', text: 'Back', onclick: () => { state.view = 'home'; render(); } })
      ])
    ]);
  };

  VIEWS['join-name'] = function () {
    const codeInput = el('input', { type: 'text', class: 'code', placeholder: 'CODE', maxlength: '5' });
    const nameInput = el('input', { type: 'text', placeholder: 'Your name', maxlength: '20' });
    screen([
      brand(),
      el('h2', { text: 'Join a game' }),
      el('p', { text: 'Enter the room code shown on the host\u2019s screen.' }),
      codeInput, nameInput,
      el('div', { class: 'error-text', text: state.error }),
      el('div', { class: 'stack top' }, [
        el('button', {
          class: 'primary', text: 'Join Room', onclick: () => {
            const code = codeInput.value.trim();
            const name = nameInput.value.trim();
            if (!code || !name) { state.error = 'Enter code and name'; render(); return; }
            socket.emit('join_room', { code, name }, (res) => {
              if (!res.ok) { state.error = res.error; render(); return; }
              state.code = res.code; state.playerId = res.playerId; state.isHost = false;
              saveSession(); state.view = 'lobby'; state.error = ''; render();
            });
          }
        }),
        el('button', { class: 'ghost', text: 'Back', onclick: () => { state.view = 'home'; render(); } })
      ])
    ]);
  };

  VIEWS.lobby = function () {
    const room = state.room;
    if (!room) { screen([brand(), el('p', { text: 'Connecting\u2026' })]); return; }
    const isHost = room.hostId === state.playerId;
    const maxImposters = Math.max(1, Math.floor(room.players.length / 3));

    const children = [
      brand(),
      el('h2', { text: 'Lobby' }),
      el('div', { class: 'room-code', text: room.code }),
      el('p', { text: isHost ? 'Share this code. Everyone joins on their own phone.' : 'Waiting for the host to start the game.' })
    ];

    const list = el('div', { class: 'player-list' });
    room.players.forEach(p => {
      const row = el('div', { class: 'player-row' + (p.connected ? '' : ' offline') }, [
        el('div', { class: 'name' }, [
          el('span', { class: 'status-dot' }),
          p.name + (p.id === state.playerId ? ' (you)' : '')
        ]),
        p.id === room.hostId ? el('span', { class: 'badge', text: 'HOST' }) : null
      ]);
      list.appendChild(row);
    });
    children.push(list);

    if (isHost) {
      const s = room.settings;
      const settingsBox = el('div', {});
      const impRow = el('div', { class: 'settings-row' }, [
        el('div', {}, [el('div', { class: 'label', text: 'Imposters' }), el('div', { class: 'sub', text: 'How many players get the different word' })]),
        el('div', { class: 'stepper' }, [
          el('button', { class: 'secondary small', text: '\u2212', onclick: () => updateSettings({ imposterCount: Math.max(1, s.imposterCount - 1) }) }),
          el('span', { class: 'val', text: s.imposterCount }),
          el('button', { class: 'secondary small', text: '+', onclick: () => updateSettings({ imposterCount: Math.min(maxImposters, s.imposterCount + 1) }) })
        ])
      ]);
      const mrwRow = el('div', { class: 'settings-row' }, [
        el('div', {}, [el('div', { class: 'label', text: 'Mr. White' }), el('div', { class: 'sub', text: 'One player gets no word at all' })]),
        (() => {
          const sw = el('label', { class: 'switch' });
          const cb = el('input', { type: 'checkbox' });
          cb.checked = s.mrWhite;
          cb.addEventListener('change', () => updateSettings({ mrWhite: cb.checked }));
          sw.appendChild(cb);
          sw.appendChild(el('span', { class: 'track' }));
          return sw;
        })()
      ]);
      const diffRow = el('div', { class: 'settings-row' }, [
        el('div', {}, [el('div', { class: 'label', text: 'Word difficulty' })]),
      ]);
      const diffTabs = el('div', { class: 'diff-tabs' });
      [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['all', 'All']].forEach(([d, label]) => {
        diffTabs.appendChild(el('button', {
          class: d === s.difficulty ? 'active' : '', text: label,
          onclick: () => updateSettings({ difficulty: d })
        }));
      });
      settingsBox.appendChild(impRow);
      settingsBox.appendChild(mrwRow);
      settingsBox.appendChild(diffRow);
      settingsBox.appendChild(diffTabs);
      children.push(settingsBox);

      const canStart = room.players.length >= 3;
      children.push(el('div', { class: 'stack top' }, [
        !canStart ? el('p', { text: 'Need at least 3 players to start.' }) : null,
        el('button', {
          class: 'primary', text: 'Start Game', disabled: !canStart ? 'true' : null,
          onclick: () => {
            socket.emit('start_game', { code: state.code, playerId: state.playerId }, (res) => {
              if (res && !res.ok) { state.error = res.error; render(); }
            });
          }
        })
      ]));
      if (!canStart) settingsBox.querySelector('button.primary') && null;
    } else {
      children.push(el('div', { class: 'spacer' }));
      children.push(el('p', { class: 'center-note', text: 'Sit tight \u2014 the host will start the round.' }));
    }

    screen(children);
    if (isHost) {
      const startBtn = root.querySelector('button.primary');
      if (startBtn && room.players.length < 3) startBtn.disabled = true;
    }
  };

  function updateSettings(patch) {
    const s = { ...state.room.settings, ...patch };
    socket.emit('update_settings', { code: state.code, playerId: state.playerId, settings: s });
  }

  VIEWS.reveal = function () {
    const role = state.myRole;
    const room = state.room;
    if (!role) { screen([brand(), el('p', { text: 'Dealing words\u2026' })]); return; }

    const card = el('div', { class: 'card' });
    const lamp = el('div', { class: 'lamp' });
    const hint = el('div', { class: 'hint', text: state.peeking ? 'Release to hide' : 'Press and hold to peek' });

    const blank = el('div', { class: 'content blank' }, [
      el('div', { class: 'role-word', text: '?' })
    ]);

    let roleLabel = 'CIVILIAN';
    let wordDisplay = role.word || '';
    if (role.role === 'imposter') roleLabel = 'IMPOSTER';
    if (role.role === 'mrwhite') { roleLabel = 'MR. WHITE'; wordDisplay = 'No word \u2014 bluff your way through'; }

    const secret = el('div', { class: 'content secret' }, [
      el('div', { class: 'role-label', text: roleLabel }),
      el('div', { class: 'role-word', text: wordDisplay }),
      el('div', { class: 'category-tag', text: 'Category: ' + role.category })
    ]);

    card.appendChild(lamp);
    card.appendChild(hint);
    card.appendChild(blank);
    card.appendChild(secret);

    const startPeek = (e) => { e.preventDefault(); state.peeking = true; card.classList.add('peeking'); hint.textContent = 'Release to hide'; };
    const endPeek = () => { state.peeking = false; card.classList.remove('peeking'); hint.textContent = 'Press and hold to peek'; };
    card.addEventListener('touchstart', startPeek, { passive: false });
    card.addEventListener('touchend', endPeek);
    card.addEventListener('mousedown', startPeek);
    card.addEventListener('mouseup', endPeek);
    card.addEventListener('mouseleave', endPeek);

    const ready = room && room.round && room.round.readyCount != null;
    const alreadyReady = state.readySent;

    screen([
      brand(),
      el('div', { class: 'card-reveal' }, [
        card,
        el('p', { text: 'Memorize it. Do not show anyone else\u2019s screen.' }),
        el('button', {
          class: 'primary', text: alreadyReady ? 'Waiting for others\u2026' : 'I\u2019ve Seen It',
          disabled: alreadyReady ? 'true' : null,
          onclick: () => {
            state.readySent = true;
            socket.emit('mark_ready', { code: state.code, playerId: state.playerId });
            render();
          }
        }),
        room ? el('div', { class: 'progress-pill', text: `${room.round.readyCount}/${room.round.totalCount} ready` }) : null
      ])
    ]);
  };

  VIEWS.order = function () {
    const room = state.room;
    const isHost = room.hostId === state.playerId;
    const list = el('div', { class: 'order-list' });
    room.round.order.forEach((name, i) => {
      list.appendChild(el('div', { class: 'order-item' }, [
        el('span', { class: 'num', text: i + 1 }),
        el('span', { text: name })
      ]));
    });
    screen([
      brand(),
      el('h2', { text: 'Speaking order' }),
      el('p', { text: 'Going in this order, each player says one short clue about their word out loud.' }),
      list,
      el('div', { class: 'spacer' }),
      isHost
        ? el('button', { class: 'primary', text: 'Start Discussion', onclick: () => socket.emit('advance_phase', { code: state.code, playerId: state.playerId, to: 'discuss' }) })
        : el('p', { class: 'center-note', text: 'Waiting for the host to start discussion.' })
    ]);
  };

  VIEWS.discuss = function () {
    const room = state.room;
    const isHost = room.hostId === state.playerId;
    if (!state.timerHandle && !state.timerStarted) {
      state.timerSeconds = room.settings.discussSeconds;
      state.timerStarted = true;
      state.timerHandle = setInterval(() => {
        state.timerSeconds -= 1;
        if (state.timerSeconds <= 0) { clearInterval(state.timerHandle); state.timerHandle = null; }
        if (state.view === 'discuss') updateTimerDisplay();
      }, 1000);
    }
    screen([
      brand(),
      el('h2', { text: 'Open discussion' }),
      el('p', { text: 'Talk it out. Who sounded unsure? Who gave a vague clue?' }),
      el('div', { class: 'timer', id: 'timerText', text: formatTime(state.timerSeconds) }),
      el('div', { class: 'spacer' }),
      isHost
        ? el('button', { class: 'primary', text: 'Start Voting', onclick: () => { clearInterval(state.timerHandle); state.timerHandle = null; state.timerStarted = false; socket.emit('advance_phase', { code: state.code, playerId: state.playerId, to: 'vote' }); } })
        : el('p', { class: 'center-note', text: 'Waiting for the host to open voting.' })
    ]);
  };

  function formatTime(sec) {
    sec = Math.max(0, sec);
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  function updateTimerDisplay() {
    const elm = document.getElementById('timerText');
    if (elm) elm.textContent = formatTime(state.timerSeconds);
  }

  VIEWS.vote = function () {
    const room = state.room;
    const isHost = room.hostId === state.playerId;
    const grid = el('div', { class: 'vote-grid' });
    room.players.forEach(p => {
      const selected = state.voteTarget === p.id;
      grid.appendChild(el('div', {
        class: 'vote-option' + (selected ? ' selected' : ''),
        onclick: () => {
          state.voteTarget = p.id;
          socket.emit('cast_vote', { code: state.code, playerId: state.playerId, targetId: p.id });
          render();
        }
      }, [el('span', { text: p.name + (p.id === state.playerId ? ' (you)' : '') }), selected ? el('span', { class: 'count', text: 'Selected' }) : null]));
    });
    screen([
      brand(),
      el('h2', { text: 'Who is the imposter?' }),
      el('p', { text: 'Tap a player to cast your vote.' }),
      grid,
      el('div', { class: 'progress-pill', text: `${room.round.votesCount}/${room.round.totalCount} voted` }),
      el('div', { class: 'spacer' }),
      isHost ? el('button', { class: 'secondary', text: 'Tally Now', onclick: () => socket.emit('force_tally', { code: state.code, playerId: state.playerId }) }) : null
    ]);
  };

  VIEWS.results = function () {
    const room = state.room;
    const r = room.round;
    const isHost = room.hostId === state.playerId;

    if (r.awaitingMrWhiteGuess) {
      const isMrWhite = state.myRole && state.myRole.role === 'mrwhite';
      if (isMrWhite) {
        const guessInput = el('input', { type: 'text', placeholder: 'Guess the civilian word' });
        screen([
          brand(),
          el('h2', { text: 'You were caught!' }),
          el('p', { text: 'Last chance: guess the civilians\u2019 secret word exactly to steal the win.' }),
          guessInput,
          el('button', {
            class: 'primary', text: 'Submit Guess', onclick: () => {
              socket.emit('mrwhite_guess', { code: state.code, playerId: state.playerId, guess: guessInput.value });
            }
          })
        ]);
      } else {
        screen([brand(), el('h2', { text: 'Mr. White was caught\u2026' }), el('p', { text: 'They are guessing the secret word. Hang tight.' })]);
      }
      return;
    }

    const eliminated = room.players.find(p => p.id === r.eliminatedId);
    let bannerClass = 'civ', headline = 'Civilians win';
    if (r.winner === 'imposters') { bannerClass = 'imp'; headline = 'Imposters win'; }
    if (r.winner === 'mrwhite') { bannerClass = 'mrw'; headline = 'Mr. White wins'; }
    if (r.winner === 'undecided') { headline = 'Round over'; }

    const banner = el('div', { class: 'result-banner ' + bannerClass }, [
      el('h2', { text: headline }),
      el('p', { text: eliminated ? `${eliminated.name} was voted out.` : 'No one was voted out (tie).' , style: 'margin-bottom:0' })
    ]);

    const list = el('div', { class: 'role-reveal-list' });
    (r.revealedRoles || []).forEach(pr => {
      const isElim = pr.id === r.eliminatedId;
      list.appendChild(el('div', { class: 'role-reveal-row' + (isElim ? ' eliminated' : '') }, [
        el('span', { text: pr.name }),
        el('span', { class: 'tag ' + pr.role, text: pr.role === 'mrwhite' ? 'MR. WHITE' : pr.role.toUpperCase() + (pr.word ? ': ' + pr.word : '') })
      ]));
    });

    screen([
      brand(),
      banner,
      list,
      el('div', { class: 'spacer' }),
      isHost
        ? el('button', { class: 'primary', text: 'Play Again', onclick: () => socket.emit('play_again', { code: state.code, playerId: state.playerId }) })
        : el('p', { class: 'center-note', text: 'Waiting for the host to start a new round.' })
    ]);
  };

  // ---------------- SOCKET EVENTS ----------------

  socket.on('connect', () => {
    const saved = localStorage.getItem('undercover_session');
    if (saved) {
      const { code, playerId } = JSON.parse(saved);
      socket.emit('rejoin_room', { code, playerId }, (res) => {
        if (res.ok) {
          state.code = code; state.playerId = playerId; state.room = res.room;
          state.isHost = res.room.hostId === playerId;
          state.view = phaseToView(res.room);
          render();
        } else {
          clearSession();
        }
      });
    }
  });

  socket.on('room_update', (room) => {
    state.room = room;
    if (state.code) {
      const nextView = phaseToView(room);
      if (nextView !== state.view) {
        if (nextView === 'reveal') { state.readySent = false; state.peeking = false; }
        if (nextView === 'vote') { state.voteTarget = null; }
        if (nextView === 'lobby') { state.myRole = null; state.readySent = false; state.timerStarted = false; }
        state.view = nextView;
      }
      render();
    }
  });

  socket.on('your_role', (role) => {
    state.myRole = role;
    render();
  });

  function phaseToView(room) {
    if (!room.round) return 'lobby';
    return room.round.phase || 'reveal';
  }

  window.addEventListener('beforeunload', () => { /* keep session for reconnect */ });

  render();

  // Register service worker for installability
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
})();
