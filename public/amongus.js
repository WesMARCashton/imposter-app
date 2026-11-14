// Among Us (phone version) — client. Plugs into window.App from app.js.
(function () {
  const A = window.App;
  const { el, socket } = A;
  const U = A.state.au = { me: null };

  const CREW_SVG = `
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-label="Crew">
  <circle cx="60" cy="60" r="57" fill="#142033" stroke="#4A8FE7" stroke-width="4"/>
  <path d="M60 18 C74 30 80 48 78 70 L42 70 C40 48 46 30 60 18 Z" fill="#EDEEF0"/>
  <circle cx="60" cy="46" r="8" fill="#4A8FE7"/>
  <path d="M42 70 L32 86 L44 82 Z M78 70 L88 86 L76 82 Z" fill="#4A8FE7"/>
  <path d="M52 72 L60 98 L68 72 Z" fill="#E8B23A"/>
</svg>`;
  const IMP_SVG = `
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-label="Impostor">
  <circle cx="60" cy="60" r="57" fill="#2A0F12" stroke="#C24949" stroke-width="4"/>
  <circle cx="60" cy="60" r="30" fill="none" stroke="#C24949" stroke-width="5"/>
  <circle cx="60" cy="60" r="12" fill="none" stroke="#C24949" stroke-width="5"/>
  <path d="M60 18 V42 M60 78 V102 M18 60 H42 M78 60 H102" stroke="#C24949" stroke-width="5" stroke-linecap="round"/>
  <circle cx="60" cy="60" r="4" fill="#EDEEF0"/>
</svg>`;

  const svgBox = (markup, cls) => { const d = el('div', { class: cls }); d.innerHTML = markup; return d; };
  const note = (text) => el('p', { class: 'center-note', text });
  const emit = (ev, extra) => socket.emit(ev, Object.assign({ code: A.state.code, playerId: A.state.playerId }, extra || {}));

  socket.on('au_you', (me) => {
    const prevRoom = U.me && U.me.room;
    U.me = me;
    if (prevRoom && prevRoom !== me.room) closeTask();
    if (A.state.view === 'amongus') A.render();
  });

  // ---------- role card ----------
  A.auOpenTask = (t) => openTask(t);
  A.buildAmongUsCard = function (role) {
    const imp = role.role === 'impostor';
    const card = el('div', { class: 'card' });
    const hint = el('div', { class: 'hint', text: 'Press and hold to peek' });
    card.appendChild(el('div', { class: 'lamp' }));
    card.appendChild(hint);
    card.appendChild(el('div', { class: 'content blank' }, [el('div', { class: 'role-word', text: '?' })]));
    card.appendChild(el('div', { class: 'content secret' }, [
      svgBox(imp ? IMP_SVG : CREW_SVG, 'role-logo'),
      el('div', { class: 'role-label' + (imp ? ' weasel' : ' om'), text: imp ? 'IMPOSTOR' : 'CREWMATE' }),
      el('div', { class: 'role-desc', text: imp ? 'Blend in. Take out the crew.' : 'Do your tasks. Find the Impostor.' }),
      el('div', { class: 'category-tag', text: imp && role.partners.length ? 'Other Impostor: ' + role.partners.join(', ') : ' ' })
    ]));
    const startPeek = (e) => { e.preventDefault(); card.classList.add('peeking'); hint.textContent = 'Release to hide'; };
    const endPeek = () => { card.classList.remove('peeking'); hint.textContent = 'Press and hold to peek'; };
    card.addEventListener('touchstart', startPeek, { passive: false });
    card.addEventListener('touchend', endPeek);
    card.addEventListener('mousedown', startPeek);
    card.addEventListener('mouseup', endPeek);
    card.addEventListener('mouseleave', endPeek);
    return card;
  };

  // ---------- task mini-games (rendered in an overlay outside the app root so re-renders don't wipe them) ----------
  function closeTask() {
    const o = document.getElementById('au-task');
    if (o) { if (o._cleanup) o._cleanup(); o.remove(); }
  }

  function openTask(task) {
    closeTask();
    const overlay = el('div', { class: 'au-task-overlay', id: 'au-task' });
    const box = el('div', { class: 'au-task-box' });
    const status = el('div', { class: 'au-task-status', text: '' });
    const body = el('div', { class: 'au-task-body' });
    box.appendChild(el('div', { class: 'au-task-head' }, [
      el('div', {}, [el('div', { class: 'help-kicker', text: task.roomName }), el('h2', { text: task.name })]),
      el('button', { class: 'leave-btn', text: 'Close', onclick: closeTask })
    ]));
    box.appendChild(body);
    box.appendChild(status);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const done = () => {
      status.textContent = 'Task complete!';
      status.className = 'au-task-status ok';
      emit('au_task', { taskId: task.id });
      setTimeout(closeTask, 700);
    };
    const fail = (msg) => { status.textContent = msg; status.className = 'au-task-status bad'; };
    const clear = () => { status.textContent = ''; status.className = 'au-task-status'; };
    const builder = GAMES[task.type] || GAMES.hold;
    overlay._cleanup = builder(body, task, { done, fail, clear });
  }

  const shuffled = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const GAMES = {
    hold(body, task, f) {
      const secs = task.secs || 3;
      body.appendChild(el('p', { text: `Press and hold for ${secs} seconds. Letting go resets it.` }));
      const fill = el('div', { class: 'au-hold-fill' });
      const btn = el('button', { class: 'au-hold' }, [fill, el('span', { text: 'HOLD' })]);
      body.appendChild(btn);
      let t0 = null, raf = null, finished = false;
      const tick = () => {
        const pct = Math.min(1, (Date.now() - t0) / (secs * 1000));
        fill.style.height = (pct * 100) + '%';
        if (pct >= 1) { finished = true; f.done(); return; }
        raf = requestAnimationFrame(tick);
      };
      const down = (e) => { e.preventDefault(); if (finished) return; f.clear(); t0 = Date.now(); tick(); };
      const up = () => { if (finished || t0 === null) return; cancelAnimationFrame(raf); t0 = null; fill.style.height = '0%'; f.fail('Keep holding!'); };
      btn.addEventListener('touchstart', down, { passive: false });
      btn.addEventListener('touchend', up);
      btn.addEventListener('mousedown', down);
      btn.addEventListener('mouseup', up);
      btn.addEventListener('mouseleave', up);
      return () => cancelAnimationFrame(raf);
    },

    wires(body, task, f) {
      const colors = [['#C24949', 'Red'], ['#4A8FE7', 'Blue'], ['#E8B23A', 'Yellow'], ['#4B9E7A', 'Green']];
      body.appendChild(el('p', { text: 'Tap a wire on the left, then the same colour on the right.' }));
      const left = shuffled(colors), right = shuffled(colors);
      let pick = null; const connected = new Set();
      const grid = el('div', { class: 'au-wires' });
      const L = el('div', { class: 'au-wire-col' }), R = el('div', { class: 'au-wire-col' });
      const draw = () => {
        L.innerHTML = ''; R.innerHTML = '';
        left.forEach(([c, n]) => L.appendChild(el('button', {
          class: 'au-wire' + (pick === c ? ' picked' : '') + (connected.has(c) ? ' done' : ''), style: `background:${c}`, 'aria-label': n,
          onclick: () => { if (connected.has(c)) return; pick = c; f.clear(); draw(); }
        })));
        right.forEach(([c, n]) => R.appendChild(el('button', {
          class: 'au-wire' + (connected.has(c) ? ' done' : ''), style: `background:${c}`, 'aria-label': n,
          onclick: () => {
            if (!pick || connected.has(c)) return;
            if (pick === c) { connected.add(c); pick = null; draw(); if (connected.size === colors.length) f.done(); }
            else { pick = null; f.fail('Wrong wire. Try again.'); draw(); }
          }
        })));
      };
      grid.appendChild(L); grid.appendChild(el('div', { class: 'au-wire-gap' })); grid.appendChild(R);
      body.appendChild(grid); draw();
    },

    sequence(body, task, f) {
      const n = task.n || 6;
      body.appendChild(el('p', { text: `Tap 1 to ${n} in order.` }));
      const grid = el('div', { class: 'au-seq' });
      let next = 1;
      const nums = shuffled(Array.from({ length: n }, (_, i) => i + 1));
      const btns = nums.map(num => el('button', {
        class: 'au-seq-btn', text: String(num),
        onclick: (e) => {
          if (num === next) { e.currentTarget.classList.add('done'); next++; f.clear(); if (next > n) f.done(); }
          else { next = 1; btns.forEach(b => b.classList.remove('done')); f.fail('Wrong order. Start again from 1.'); }
        }
      }));
      btns.forEach(b => grid.appendChild(b));
      body.appendChild(grid);
    },

    slider(body, task, f) {
      const target = 15 + Math.floor(Math.random() * 70);
      body.appendChild(el('p', { text: 'Slide to line up with the marker, then hold it there.' }));
      const wrap = el('div', { class: 'au-slider' });
      const marker = el('div', { class: 'au-slider-marker', style: `left:${target}%` });
      const input = el('input', { type: 'range', min: '0', max: '100', value: String(target > 50 ? 5 : 95), class: 'au-range' });
      wrap.appendChild(marker); wrap.appendChild(input);
      body.appendChild(wrap);
      let timer = null, finished = false;
      const check = () => {
        if (finished) return;
        const close = Math.abs(Number(input.value) - target) <= 3;
        marker.classList.toggle('hit', close);
        if (close && !timer) timer = setTimeout(() => { finished = true; f.done(); }, 800);
        if (!close && timer) { clearTimeout(timer); timer = null; }
      };
      input.addEventListener('input', check);
      return () => clearTimeout(timer);
    },

    swipe(body, task, f) {
      body.appendChild(el('p', { text: 'Drag the card all the way across at a steady speed. Not too fast, not too slow.' }));
      const track = el('div', { class: 'au-swipe' });
      const knob = el('div', { class: 'au-swipe-card', text: 'ID' });
      track.appendChild(knob); body.appendChild(track);
      let startX = null, t0 = 0, finished = false;
      const max = () => track.clientWidth - knob.clientWidth;
      const pos = (e) => (e.touches ? e.touches[0].clientX : e.clientX);
      const down = (e) => { if (finished) return; e.preventDefault(); startX = pos(e); t0 = Date.now(); f.clear(); };
      const moveH = (e) => {
        if (startX === null) return;
        const dx = Math.max(0, Math.min(max(), pos(e) - startX));
        knob.style.transform = `translateX(${dx}px)`;
        if (dx >= max() - 2) {
          const dt = Date.now() - t0; startX = null;
          if (dt < 500) { f.fail('Too fast. Try again.'); knob.style.transform = ''; }
          else if (dt > 1800) { f.fail('Too slow. Try again.'); knob.style.transform = ''; }
          else { finished = true; f.done(); }
        }
      };
      const up = () => { if (startX !== null) { startX = null; knob.style.transform = ''; f.fail('Swipe all the way across.'); } };
      knob.addEventListener('touchstart', down, { passive: false });
      knob.addEventListener('mousedown', down);
      window.addEventListener('touchmove', moveH, { passive: true });
      window.addEventListener('mousemove', moveH);
      window.addEventListener('touchend', up);
      window.addEventListener('mouseup', up);
      return () => {
        window.removeEventListener('touchmove', moveH); window.removeEventListener('mousemove', moveH);
        window.removeEventListener('touchend', up); window.removeEventListener('mouseup', up);
      };
    },

    timing(body, task, f) {
      const need = 3;
      let hits = 0, x = 0, dir = 1, raf = null;
      body.appendChild(el('p', { text: `Tap STOP when the line is in the green zone. ${need} hits to finish.` }));
      const bar = el('div', { class: 'au-timing' });
      const zoneStart = 35 + Math.random() * 30;
      const zone = el('div', { class: 'au-timing-zone', style: `left:${zoneStart}%;width:14%` });
      const line = el('div', { class: 'au-timing-line' });
      bar.appendChild(zone); bar.appendChild(line);
      const counter = el('div', { class: 'au-timing-count', text: `0 / ${need}` });
      const btn = el('button', {
        class: 'primary', text: 'STOP', onclick: () => {
          if (x >= zoneStart && x <= zoneStart + 14) { hits++; f.clear(); counter.textContent = `${hits} / ${need}`; if (hits >= need) { cancelAnimationFrame(raf); f.done(); } }
          else { f.fail('Missed. Keep going.'); }
        }
      });
      body.appendChild(bar); body.appendChild(counter); body.appendChild(btn);
      let last = performance.now();
      const step = (now) => {
        const dt = now - last; last = now;
        x += dir * dt * (0.07 + hits * 0.02);
        if (x >= 100) { x = 100; dir = -1; } if (x <= 0) { x = 0; dir = 1; }
        line.style.left = x + '%';
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }
  };

  // ---------- screens ----------
  function taskBar(r) {
    const pct = r.taskTotal ? Math.round((r.taskDone / r.taskTotal) * 100) : 0;
    return el('div', { class: 'au-taskbar' }, [
      el('div', { class: 'au-taskbar-label' }, [el('span', { text: 'Total tasks' }), el('span', { text: pct + '%' })]),
      el('div', { class: 'au-taskbar-track' }, [el('div', { class: 'au-taskbar-fill', style: `width:${pct}%` })])
    ]);
  }

  function shipMap(r, me) {
    const grid = el('div', { class: 'au-map' });
    const todo = {};
    me.tasks.filter(t => !t.done).forEach(t => { todo[t.room] = (todo[t.room] || 0) + 1; });
    r.rooms.forEach(room => {
      const here = room.id === me.room;
      const adj = me.adjacent.includes(room.id);
      const tile = el('button', {
        class: 'au-room' + (here ? ' here' : adj ? ' adj' : ' far'),
        style: `grid-column:${room.x + 1};grid-row:${room.y + 1}`,
        onclick: () => { if (adj) { closeTask(); emit('au_move', { to: room.id }); } }
      }, [
        el('span', { class: 'au-room-name', text: room.name }),
        here ? el('span', { class: 'au-you', text: 'YOU' }) : null,
        todo[room.id] ? el('span', { class: 'au-room-tasks', text: '•'.repeat(todo[room.id]) }) : null
      ]);
      if (!adj && !here) tile.disabled = true;
      grid.appendChild(tile);
    });
    return grid;
  }

  const PHASES = {};

  PHASES.reveal = (room, r, ctx) => {
    if (!A.state.myRole) return [note('Assigning roles…')];
    return [el('div', { class: 'card-reveal' }, [
      A.buildPeekCard(),
      el('p', { text: 'Keep your role secret. Everyone starts in the Cafeteria.' }),
      ctx.isHost ? el('button', { class: 'primary', text: 'Start Game', onclick: () => emit('au_advance') }) : note('Waiting for the host to start.')
    ])];
  };

  PHASES.play = (room, r, ctx) => {
    const me = U.me;
    if (!me) return [note('Loading ship…')];
    const roomName = (r.rooms.find(x => x.id === me.room) || {}).name || '';
    const out = [taskBar(r)];
    out.push(el('div', { class: 'au-where' }, [
      el('div', { class: 'help-kicker', text: 'You are in' }),
      el('h1', { text: roomName }),
      el('div', { class: 'au-with', text: me.occupants.length ? 'With you: ' + me.occupants.join(', ') : 'You’re alone.' })
    ]));
    const hereTasks = me.tasks.filter(t => t.room === me.room && !t.done);
    if (hereTasks.length) {
      const row = el('div', { class: 'stack' });
      hereTasks.forEach(t => row.appendChild(el('button', { class: 'primary', text: 'Do task: ' + t.name, onclick: () => openTask(t) })));
      out.push(row);
    }
    out.push(el('div', { class: 'label-sm', text: 'Ship map (tap a room next to you to walk there)' }));
    out.push(shipMap(r, me));
    const list = el('div', { class: 'au-tasklist' });
    me.tasks.forEach(t => list.appendChild(el('div', { class: 'au-task-row' + (t.done ? ' done' : '') }, [
      el('span', { text: (t.done ? '✓ ' : '') + t.name }), el('span', { class: 'muted', text: t.roomName })
    ])));
    out.push(el('div', { class: 'label-sm', text: me.role === 'impostor' ? 'Fake tasks (for cover — they don’t count)' : 'Your tasks' }));
    out.push(list);
    return out;
  };

  const REASONS = {
    tasks: 'The crew finished every task.',
    impostors_out: 'Every Impostor is gone.',
    outnumbered: 'The Impostors outnumber the crew.'
  };

  PHASES.results = (room, r, ctx) => {
    const res = r.result;
    const crewWon = res.winner === 'crew';
    const list = el('div', { class: 'role-reveal-list' });
    res.players.forEach(p => list.appendChild(el('div', { class: 'role-reveal-row' }, [
      el('span', { text: p.name + (p.role === 'crew' ? ` · ${p.tasksDone}/${p.tasksTotal} tasks` : '') }),
      el('span', { class: 'tag ' + (p.role === 'impostor' ? 'imposter' : 'civilian'), text: p.role === 'impostor' ? 'IMPOSTOR' : 'CREWMATE' })
    ])));
    return [
      svgBox(crewWon ? CREW_SVG : IMP_SVG, 'w-final-logo'),
      el('div', { class: 'result-banner ' + (crewWon ? 'civ' : 'imp') }, [
        el('h2', { text: crewWon ? 'Crewmates win' : 'Impostors win' }),
        el('p', { style: 'margin-bottom:0', text: REASONS[res.reason] || '' })
      ]),
      list,
      el('div', { class: 'spacer' }),
      ctx.isHost
        ? el('button', { class: 'primary', text: 'Back to Lobby', onclick: () => emit('play_again') })
        : note('Waiting for the host.')
    ];
  };

  A.VIEWS.amongus = function () {
    const room = A.state.room;
    const r = room && room.round;
    if (!r) return;
    if (r.phase !== 'play') closeTask();
    const me = A.state.playerId;
    const ctx = { me, isHost: room.hostId === me };
    const container = el('div', { class: 'screen' }, [A.brand(), ...(PHASES[r.phase] || (() => []))(room, r, ctx)]);
    A.root.appendChild(container);
    if (r.phase === 'play') A.appendPeekFab(container);
  };
})();
