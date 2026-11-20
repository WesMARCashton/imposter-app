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
    peekModalOpen: false,
    error: '',
    voteTarget: null
  };

  // ---- persistence for reconnect ----
  function saveSession() {
    if (state.code && state.playerId) {
      localStorage.setItem('undercover_session', JSON.stringify({ code: state.code, playerId: state.playerId }));
    }
  }
  function clearSession() { localStorage.removeItem('undercover_session'); }

  function render() {
    const y = window.scrollY;
    const focusedId = document.activeElement && document.activeElement.id;
    root.innerHTML = '';
    try {
      if (!VIEWS[state.view]) {
        if (state.code) throw new Error('No screen for view "' + state.view + '" (app may be out of date)');
        VIEWS.home();
      } else VIEWS[state.view]();
    } catch (err) {
      reportError(err, 'render:' + state.view);
      root.innerHTML = '';
      root.appendChild(el('div', { class: 'screen' }, [
        el('h2', { text: 'Something went wrong on this screen.' }),
        el('p', { text: 'You\u2019re still in the game. Tap below to reload and rejoin.' }),
        el('button', { class: 'primary', text: 'Reload', onclick: () => location.reload() })
      ]));
      return;
    }
    window.scrollTo(0, y);
    if (focusedId) {
      const f = document.getElementById(focusedId);
      if (f) { f.focus(); if (f.value !== undefined && f.setSelectionRange && f.type === 'text') { const n = f.value.length; f.setSelectionRange(n, n); } }
    }
  }

  const GAME_LABELS = { undercover: 'UNDERCOVER', weasel: 'INSIDE JOB', offmap: 'THE WEASEL', amongus: 'AMONG US', clue: 'CLUE', target: 'HIT THE NUMBER', werewolf: 'WEREWOLF', calledshot: 'CALLED SHOT' };
  const GAME_NAMES = { undercover: 'Undercover', weasel: 'Inside Job', offmap: 'The Weasel', amongus: 'Among Us', clue: 'Clue', target: 'Hit the Number', werewolf: 'Werewolf', calledshot: 'Called Shot' };
  const currentGame = () => (state.room && state.room.settings && state.room.settings.game) || 'undercover';

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

  function buildPeekCard() {
    const role = state.myRole;
    if (role && role.game === 'weasel' && window.App.buildWeaselCard) return window.App.buildWeaselCard(role);
    if (role && role.game === 'offmap' && window.App.buildOffmapCard) return window.App.buildOffmapCard(role);
    if (role && role.game === 'amongus' && window.App.buildAmongUsCard) return window.App.buildAmongUsCard(role);
    if (role && role.game === 'target' && window.App.buildTargetCard) return window.App.buildTargetCard(role);
    if (role && role.game === 'werewolf' && window.App.buildWerewolfCard) return window.App.buildWerewolfCard(role);
    const card = el('div', { class: 'card' });
    const lamp = el('div', { class: 'lamp' });
    const hint = el('div', { class: 'hint', text: 'Press and hold to peek' });

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

    const startPeek = (e) => { e.preventDefault(); card.classList.add('peeking'); hint.textContent = 'Release to hide'; };
    const endPeek = () => { card.classList.remove('peeking'); hint.textContent = 'Press and hold to peek'; };
    card.addEventListener('touchstart', startPeek, { passive: false });
    card.addEventListener('touchend', endPeek);
    card.addEventListener('mousedown', startPeek);
    card.addEventListener('mouseup', endPeek);
    card.addEventListener('mouseleave', endPeek);
    return card;
  }

  function appendPeekFab(container) {
    if (!state.myRole) return;
    container.classList.add('has-fab');
    container.appendChild(el('button', {
      class: 'peek-fab', text: state.myRole.game ? 'My Role' : 'My Word',
      onclick: () => { state.peekModalOpen = true; render(); }
    }));
    if (state.peekModalOpen) {
      const overlay = el('div', { class: 'peek-overlay', onclick: (e) => { if (e.target === overlay) { state.peekModalOpen = false; render(); } } });
      const modal = el('div', { class: 'peek-modal' }, [
        buildPeekCard(),
        el('button', { class: 'secondary small', text: 'Close', onclick: () => { state.peekModalOpen = false; render(); } })
      ]);
      overlay.appendChild(modal);
      container.appendChild(overlay);
    }
  }

  function brand() {
    const dot = el('div', { class: 'dot' });
    const label = el('span', { text: state.code ? GAME_LABELS[currentGame()] : 'OFFICE SHENANIGANS' });
    if (state.code && currentGame() !== 'undercover') dot.classList.add(currentGame());
    if (!state.code) {
      return el('div', { class: 'brand' }, [dot, label]);
    }
    const isHost = state.room && state.room.hostId === state.playerId;
    const actionBtn = el('button', {
      class: 'leave-btn', text: isHost ? 'End Game' : 'Leave',
      onclick: () => leaveOrEndGame(isHost)
    });
    const helpBtn = el('button', { class: 'leave-btn help-btn', text: '?', 'aria-label': 'How to play', onclick: () => showHelp(currentGame()) });
    return el('div', { class: 'brand' }, [dot, label, el('div', { class: 'brand-spacer' }), helpBtn, actionBtn]);
  }

  function showHelp(selected) {
    if (window.App.showHelp) window.App.showHelp(Object.keys(GAME_NAMES), selected);
  }

  function leaveOrEndGame(isHost) {
    if (isHost) {
      if (!confirm('End the game for everyone?')) return;
      socket.emit('end_game', { code: state.code, playerId: state.playerId });
      goHome();
    } else {
      if (!confirm('Leave this game?')) return;
      socket.emit('leave_room', { code: state.code, playerId: state.playerId }, () => {});
      goHome();
    }
  }

  // Send client-side errors to the server log so bugs on real phones can be diagnosed.
  function reportError(err, where) {
    try {
      socket.emit('client_error', {
        where, message: String(err && err.message || err), stack: String(err && err.stack || '').slice(0, 800),
        view: state.view, game: state.room && state.room.round && state.room.round.game,
        phase: state.room && state.room.round && state.room.round.phase, ua: navigator.userAgent
      });
    } catch (e) { /* ignore */ }
  }
  window.addEventListener('error', (e) => reportError(e.error || e.message, 'window'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));

  function goHome() {
    clearSession();
    state.code = null; state.playerId = null; state.isHost = false;
    state.room = null; state.myRole = null; state.peekModalOpen = false;
    state.view = 'home';
    render();
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
      el('p', { text: '8 games: Undercover, Inside Job, The Weasel, Among Us, Clue, Werewolf, Hit the Number and Called Shot. Host picks in the lobby. Everyone plays from their own phone.' }),
      el('div', { class: 'stack top' }, [
        el('button', { class: 'primary', text: 'Host a Game', onclick: () => { state.view = 'host-name'; render(); } }),
        el('button', { class: 'secondary', text: 'Join a Game', onclick: () => { state.view = 'join-name'; render(); } }),
        el('button', { class: 'ghost', text: 'How to play', onclick: () => showHelp() })
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

    const game = currentGame();
    const minPlayers = game === 'werewolf' ? 5 : game === 'calledshot' ? 2 : (game === 'weasel' || game === 'amongus') ? 4 : 3;
    const startBtn = (label) => el('div', { class: 'stack top' }, [
      room.players.length < minPlayers ? el('p', { text: `Need at least ${minPlayers} players to start.` }) : null,
      el('button', {
        class: 'primary', id: 'start-btn', text: label,
        onclick: () => socket.emit('start_game', { code: state.code, playerId: state.playerId }, (res) => {
          if (res && !res.ok) { state.error = res.error; render(); }
        })
      }),
      el('div', { class: 'error-text', text: state.error })
    ]);

    if (isHost) {
      const s = room.settings;
      const gameTabs = el('div', { class: 'diff-tabs game-tabs' });
      Object.entries(GAME_NAMES).forEach(([g, label]) => {
        gameTabs.appendChild(el('button', { class: g === game ? 'active' : '', text: label, onclick: () => updateSettings({ game: g }) }));
      });
      children.push(el('div', { class: 'settings-row' }, [el('div', {}, [el('div', { class: 'label', text: 'Game' })])]));
      children.push(gameTabs);
    } else {
      children.push(el('p', { class: 'center-note', text: 'Game: ' + GAME_NAMES[game] }));
    }
    children.push(el('button', { class: 'ghost small help-link', text: `How to play ${GAME_NAMES[game]}`, onclick: () => showHelp(game) }));

    if (isHost && game === 'weasel') {
      const ws = room.settings.weasel || { rounds: 5, eliminations: true };
      const box = el('div', {});
      box.appendChild(el('div', { class: 'settings-row' }, [
        el('div', {}, [el('div', { class: 'label', text: 'Missions' }), el('div', { class: 'sub', text: 'Mission + quiz rounds' })]),
        el('div', { class: 'stepper' }, [
          el('button', { class: 'secondary small', text: '\u2212', onclick: () => updateSettings({ weasel: { ...ws, rounds: Math.max(2, ws.rounds - 1) } }) }),
          el('span', { class: 'val', text: ws.rounds }),
          el('button', { class: 'secondary small', text: '+', onclick: () => updateSettings({ weasel: { ...ws, rounds: Math.min(8, ws.rounds + 1) } }) })
        ])
      ]));
      box.appendChild(el('div', { class: 'settings-row' }, [
        el('div', {}, [el('div', { class: 'label', text: 'Eliminations' }), el('div', { class: 'sub', text: 'Lowest quiz score is out each round. Ends at 2 crew left.' })]),
        (() => {
          const sw = el('label', { class: 'switch' });
          const cb = el('input', { type: 'checkbox' });
          cb.checked = ws.eliminations;
          cb.addEventListener('change', () => updateSettings({ weasel: { ...ws, eliminations: cb.checked } }));
          sw.appendChild(cb);
          sw.appendChild(el('span', { class: 'track' }));
          return sw;
        })()
      ]));
      children.push(box);
      const canStart = room.players.length >= minPlayers;
      children.push(el('div', { class: 'stack top' }, [
        !canStart ? el('p', { text: `Need at least ${minPlayers} players to start.` }) : null,
        el('button', {
          class: 'primary', id: 'start-btn', text: 'Start Inside Job',
          onclick: () => socket.emit('start_game', { code: state.code, playerId: state.playerId }, (res) => {
            if (res && !res.ok) { state.error = res.error; render(); }
          })
        }),
        el('div', { class: 'error-text', text: state.error })
      ]));
    } else if (isHost && game === 'werewolf') {
      const ws = room.settings.werewolf || { wolves: 0, seer: true, doctor: true };
      const set = (patch) => updateSettings({ werewolf: { ...ws, ...patch } });
      children.push(el('div', { class: 'settings-row' }, [el('div', {}, [el('div', { class: 'label', text: 'Werewolves' }), el('div', { class: 'sub', text: 'Auto = 1 for 5\u20136 players, 2 for 7\u20139, 3 for 10+' })])]));
      const wt = el('div', { class: 'diff-tabs' });
      [[0, 'Auto'], [1, '1'], [2, '2'], [3, '3']].forEach(([v, t]) => wt.appendChild(el('button', { class: ws.wolves === v ? 'active' : '', text: t, onclick: () => set({ wolves: v }) })));
      children.push(wt);
      const toggle = (label, sub, key) => {
        const sw = el('label', { class: 'switch' });
        const cb = el('input', { type: 'checkbox' }); cb.checked = ws[key];
        cb.addEventListener('change', () => set({ [key]: cb.checked }));
        sw.appendChild(cb); sw.appendChild(el('span', { class: 'track' }));
        return el('div', { class: 'settings-row' }, [el('div', {}, [el('div', { class: 'label', text: label }), el('div', { class: 'sub', text: sub })]), sw]);
      };
      children.push(el('div', { style: 'height:10px' }));
      children.push(toggle('Seer', 'Checks one player each night', 'seer'));
      children.push(toggle('Doctor', 'Protects one player each night', 'doctor'));
      children.push(el('div', { style: 'height:12px' }));
      children.push(startBtn('Start Werewolf'));
    } else if (isHost && game === 'calledshot') {
      const cs = room.settings.calledshot || { sport: 'bocce', turns: 3 };
      const set = (patch) => updateSettings({ calledshot: { ...cs, ...patch } });
      children.push(el('div', { class: 'settings-row' }, [el('div', {}, [el('div', { class: 'label', text: 'Which game?' }), el('div', { class: 'sub', text: 'Spots you can call come from this game' })])]));
      const sp = el('div', { class: 'diff-tabs tg-games' });
      [['bocce', 'Bocce'], ['bullseye', 'Bullseye'], ['shuffleboard', 'Shuffleboard'], ['shufflealley', 'ShuffleAlley']].forEach(([v, t]) => sp.appendChild(el('button', { class: cs.sport === v ? 'active' : '', text: t, onclick: () => set({ sport: v }) })));
      children.push(sp);
      children.push(el('div', { class: 'settings-row' }, [
        el('div', {}, [el('div', { class: 'label', text: 'Shots each' })]),
        el('div', { class: 'stepper' }, [
          el('button', { class: 'secondary small', text: '\u2212', onclick: () => set({ turns: Math.max(1, cs.turns - 1) }) }),
          el('span', { class: 'val', text: cs.turns }),
          el('button', { class: 'secondary small', text: '+', onclick: () => set({ turns: Math.min(10, cs.turns + 1) }) })
        ])
      ]));
      children.push(el('div', { style: 'height:12px' }));
      children.push(startBtn('Start Called Shot'));
    } else if (isHost && game === 'target') {
      const tg = room.settings.target || { sport: 'bocce', imposters: 1 };
      const set = (patch) => updateSettings({ target: { ...tg, ...patch } });
      const GAMES = {
        bocce: ['Bocce', '0, 10, 20, 30, 40, 50'],
        bullseye: ['Bullseye', '0, Front/Back 1\u20133, 10, 20, 25, Bullseye, Double'],
        shuffleboard: ['Shuffleboard', '0, 10, 8 Left/Right, 7 Left/Right, \u221210'],
        shufflealley: ['ShuffleAlley', '0, 1, 2, 3']
      };
      children.push(el('div', { class: 'settings-row' }, [el('div', {}, [el('div', { class: 'label', text: 'Which game?' }), el('div', { class: 'sub', text: 'Targets: ' + (GAMES[tg.sport] || GAMES.bocce)[1] })])]));
      const sp = el('div', { class: 'diff-tabs tg-games' });
      Object.entries(GAMES).forEach(([v, [t]]) => sp.appendChild(el('button', { class: tg.sport === v ? 'active' : '', text: t, onclick: () => set({ sport: v }) })));
      children.push(sp);
      children.push(el('div', { class: 'settings-row' }, [el('div', {}, [el('div', { class: 'label', text: 'Imposters' })])]));
      const im = el('div', { class: 'diff-tabs' });
      [[1, '1'], [2, '2 (6+ players)']].forEach(([v, t]) => im.appendChild(el('button', { class: tg.imposters === v ? 'active' : '', text: t, onclick: () => set({ imposters: v }) })));
      children.push(im);
      children.push(el('div', { style: 'height:16px' }));
      children.push(startBtn('Start Hit the Number'));
    } else if (isHost && game === 'clue') {
      children.push(el('p', { class: 'center-note', text: '3\u20136 players. Turn order follows the player list above.' }));
      if (room.players.length > 6) children.push(el('p', { class: 'error-text', text: 'Clue supports up to 6 players.' }));
      children.push(startBtn('Start Clue'));
    } else if (isHost && game === 'amongus') {
      const au = room.settings.amongus || { impostors: 0, tasks: 5, killCooldown: 30 };
      const set = (patch) => updateSettings({ amongus: { ...au, ...patch } });
      const tabRow = (label, sub, options, current, key) => {
        children.push(el('div', { class: 'settings-row' }, [el('div', {}, [el('div', { class: 'label', text: label }), sub ? el('div', { class: 'sub', text: sub }) : null])]));
        const tabs = el('div', { class: 'diff-tabs' });
        options.forEach(([v, t]) => tabs.appendChild(el('button', { class: v === current ? 'active' : '', text: t, onclick: () => set({ [key]: v }) })));
        children.push(tabs);
        children.push(el('div', { style: 'height:14px' }));
      };
      tabRow('Impostors', 'Auto = 1 for 4\u20136 players, 2 for 7\u20138', [[0, 'Auto'], [1, '1'], [2, '2'], [3, '3']], au.impostors, 'impostors');
      children.push(el('div', { class: 'settings-row' }, [
        el('div', {}, [el('div', { class: 'label', text: 'Tasks per player' })]),
        el('div', { class: 'stepper' }, [
          el('button', { class: 'secondary small', text: '\u2212', onclick: () => set({ tasks: Math.max(3, au.tasks - 1) }) }),
          el('span', { class: 'val', text: au.tasks }),
          el('button', { class: 'secondary small', text: '+', onclick: () => set({ tasks: Math.min(8, au.tasks + 1) }) })
        ])
      ]));
      tabRow('Kill cooldown', 'Seconds an Impostor waits between kills', [[15, '15s'], [30, '30s'], [45, '45s'], [60, '60s']], au.killCooldown, 'killCooldown');
      children.push(startBtn('Start Among Us'));
    } else if (isHost && game === 'offmap') {
      const om = room.settings.offmap || { minutes: 8 };
      children.push(el('div', { class: 'settings-row' }, [
        el('div', {}, [el('div', { class: 'label', text: 'Round timer' }), el('div', { class: 'sub', text: 'Vote opens automatically when time runs out' })])
      ]));
      const tabs = el('div', { class: 'diff-tabs' });
      [[0, 'Off'], [5, '5m'], [8, '8m'], [10, '10m'], [15, '15m']].forEach(([m, label]) => {
        tabs.appendChild(el('button', { class: m === om.minutes ? 'active' : '', text: label, onclick: () => updateSettings({ offmap: { minutes: m } }) }));
      });
      children.push(tabs);
      children.push(el('div', { style: 'height:18px' }));
      children.push(startBtn('Start The Weasel'));
    } else if (isHost) {
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
          class: 'primary', id: 'start-btn', text: 'Start Game', disabled: !canStart ? 'true' : null,
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
      const startBtn = root.querySelector('#start-btn') || root.querySelector('button.primary');
      if (startBtn && room.players.length < minPlayers) startBtn.disabled = true;
    }
  };

  function updateSettings(patch) {
    const s = { ...state.room.settings, ...patch };
    socket.emit('update_settings', { code: state.code, playerId: state.playerId, settings: s });
  }

  VIEWS.reveal = function () {
    const role = state.myRole;
    const room = state.room;
    const isHost = room && room.hostId === state.playerId;
    if (!role) { screen([brand(), el('p', { text: 'Dealing words\u2026' })]); return; }

    const card = buildPeekCard();

    screen([
      brand(),
      el('div', { class: 'card-reveal' }, [
        card,
        el('p', { text: 'Memorize it. Do not show anyone else\u2019s screen. You can check it again anytime this round.' }),
        isHost
          ? el('button', { class: 'primary', text: 'Continue to Speaking Order', onclick: () => socket.emit('advance_phase', { code: state.code, playerId: state.playerId, to: 'order' }) })
          : el('p', { class: 'center-note', text: 'Waiting for the host to continue.' })
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
    const container = el('div', { class: 'screen' }, [
      brand(),
      el('h2', { text: 'Speaking order' }),
      el('p', { text: 'Going in this order, each player says one short clue about their word out loud.' }),
      list,
      el('div', { class: 'spacer' }),
      isHost
        ? el('button', { class: 'primary', text: 'Start Discussion', onclick: () => socket.emit('advance_phase', { code: state.code, playerId: state.playerId, to: 'discuss' }) })
        : el('p', { class: 'center-note', text: 'Waiting for the host to start discussion.' })
    ]);
    root.appendChild(container);
    appendPeekFab(container);
  };

  VIEWS.discuss = function () {
    const room = state.room;
    const isHost = room.hostId === state.playerId;
    const container = el('div', { class: 'screen' }, [
      brand(),
      el('h2', { text: 'Open discussion' }),
      el('p', { text: 'Talk it out. Who sounded unsure? Who gave a vague clue? Move on whenever you\u2019re ready.' }),
      el('div', { class: 'spacer' }),
      isHost
        ? el('button', { class: 'primary', text: 'Start Voting', onclick: () => socket.emit('advance_phase', { code: state.code, playerId: state.playerId, to: 'vote' }) })
        : el('p', { class: 'center-note', text: 'Waiting for the host to open voting.' })
    ]);
    root.appendChild(container);
    appendPeekFab(container);
  };

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
    const container = el('div', { class: 'screen' }, [
      brand(),
      el('h2', { text: 'Who is the imposter?' }),
      el('p', { text: 'Tap a player to cast your vote.' }),
      grid,
      el('div', { class: 'progress-pill', text: `${room.round.votesCount}/${room.round.totalCount} voted` }),
      el('div', { class: 'spacer' }),
      isHost ? el('button', { class: 'secondary', text: 'Host Override: Tally Now', onclick: () => socket.emit('force_tally', { code: state.code, playerId: state.playerId }) }) : null
    ]);
    root.appendChild(container);
    appendPeekFab(container);
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
        if (nextView === 'reveal') { state.peeking = false; state.peekModalOpen = false; }
        if (nextView === 'vote') { state.voteTarget = null; }
        if (nextView === 'lobby') { state.myRole = null; state.peekModalOpen = false; state.error = ''; }
        state.view = nextView;
      }
      render();
    }
  });

  socket.on('your_role', (role) => {
    state.myRole = role;
    render();
  });

  socket.on('room_ended', () => {
    goHome();
  });

  function phaseToView(room) {
    if (!room.round) return 'lobby';
    if (room.round.game === 'weasel') return 'weasel';
    if (room.round.game === 'offmap') return 'offmap';
    if (room.round.game === 'amongus') return 'amongus';
    if (room.round.game === 'clue') return 'clue';
    if (room.round.game === 'target') return 'target';
    if (room.round.game === 'werewolf') return 'werewolf';
    if (room.round.game === 'calledshot') return 'calledshot';
    return room.round.phase || 'reveal';
  }

  window.addEventListener('beforeunload', () => { /* keep session for reconnect */ });

  // Shared toolkit for game modules (public/weasel.js)
  window.App = { socket, state, root, el, render, brand, buildPeekCard, appendPeekFab, VIEWS, GAME_NAMES };

  render();

  // Register service worker for installability
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
})();
