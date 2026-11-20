// Clue (office edition) — client. Plugs into window.App from app.js.
(function () {
  const A = window.App;
  const { el, socket } = A;
  const C = A.state.clue = { me: null, pick: { suspect: null, weapon: null, room: null }, mode: 'suggest', notesOpen: true, key: '' };

  const emit = (ev, extra) => socket.emit(ev, Object.assign({ code: A.state.code, playerId: A.state.playerId }, extra || {}));
  const note = (text) => el('p', { class: 'center-note', text });

  socket.on('clue_you', (me) => { C.me = me; if (A.state.view === 'clue') A.render(); });

  // ---------- notepad (saved on this phone per game) ----------
  const notesKey = (r) => `clue_notes_${A.state.code}_${r.gameId}`;
  const loadNotes = (r) => { try { return JSON.parse(localStorage.getItem(notesKey(r)) || '{}'); } catch (e) { return {}; } };
  const saveNotes = (r, n) => { try { localStorage.setItem(notesKey(r), JSON.stringify(n)); } catch (e) { /* ignore */ } };
  const CYCLE = ['', 'x', '?'];

  function notepad(r) {
    const me = C.me || { hand: [], seen: [] };
    const notes = loadNotes(r);
    const mine = new Set(me.hand);
    const seenBy = {}; me.seen.forEach(s => { seenBy[s.card] = s.by; });
    const revealed = new Set((r.revealed || []).map(c => c.id));
    const wrap = el('div', { class: 'clue-notes' });
    const head = el('button', { class: 'clue-notes-head', onclick: () => { C.notesOpen = !C.notesOpen; A.render(); } }, [
      el('span', { text: 'Detective notes' }), el('span', { text: C.notesOpen ? '▲' : '▼' })
    ]);
    wrap.appendChild(head);
    if (!C.notesOpen) return wrap;
    wrap.appendChild(el('div', { class: 'clue-notes-hint', text: 'Your cards and cards shown to you are crossed off automatically. Tap others to mark ✗ (ruled out) or ? (suspicious).' }));
    [['Suspects', r.cards.suspects], ['Weapons', r.cards.weapons], ['Rooms', r.cards.rooms]].forEach(([title, list]) => {
      wrap.appendChild(el('div', { class: 'clue-notes-title', text: title }));
      list.forEach(c => {
        let state = notes[c.id] || '', tag = '', auto = false;
        if (mine.has(c.id)) { state = 'x'; tag = 'your card'; auto = true; }
        else if (seenBy[c.id]) { state = 'x'; tag = 'shown by ' + seenBy[c.id]; auto = true; }
        else if (revealed.has(c.id)) { state = 'x'; tag = 'revealed'; auto = true; }
        wrap.appendChild(el('button', {
          class: 'clue-note-row' + (state === 'x' ? ' x' : state === '?' ? ' q' : '') + (auto ? ' auto' : ''),
          onclick: () => {
            if (auto) return;
            const n = loadNotes(r);
            n[c.id] = CYCLE[(CYCLE.indexOf(n[c.id] || '') + 1) % CYCLE.length];
            saveNotes(r, n); A.render();
          }
        }, [
          el('span', { class: 'clue-note-mark', text: state === 'x' ? '✗' : state === '?' ? '?' : '' }),
          el('span', { class: 'clue-note-name', text: c.name }),
          el('span', { class: 'clue-note-tag', text: tag })
        ]));
      });
    });
    return wrap;
  }

  function handView() {
    const me = C.me;
    if (!me) return null;
    const names = {};
    const r = A.state.room.round;
    [...r.cards.suspects, ...r.cards.weapons, ...r.cards.rooms].forEach(c => { names[c.id] = c.name; });
    return el('div', { class: 'clue-hand' }, [
      el('div', { class: 'label-sm', text: `Your cards (${me.hand.length}) — keep these secret` }),
      el('div', { class: 'clue-chips' }, me.hand.map(id => el('span', { class: 'clue-chip ' + id[0], text: names[id] })))
    ]);
  }

  function orderBar(r) {
    return el('div', { class: 'clue-order' }, r.order.map(p => el('span', {
      class: 'clue-order-p' + (p.id === r.currentId && ['turn', 'refute', 'suggested'].includes(r.phase) ? ' now' : '') + (p.out ? ' out' : ''),
      text: p.name + (p.id === A.state.playerId ? ' (you)' : '')
    })));
  }

  function picker(r, label, key, list, disabledId) {
    const box = el('div', { class: 'clue-pick' }, [el('div', { class: 'label-sm', text: label })]);
    const grid = el('div', { class: 'clue-pick-grid' });
    list.forEach(c => {
      const b = el('button', {
        class: 'clue-opt' + (C.pick[key] === c.id ? ' on' : ''), text: c.name,
        onclick: () => { C.pick[key] = c.id; A.render(); }
      });
      if (c.id === disabledId) { b.disabled = true; b.title = 'You were just here'; }
      grid.appendChild(b);
    });
    box.appendChild(grid);
    return box;
  }

  function logView(r) {
    if (!r.log.length) return null;
    const box = el('div', { class: 'clue-log' }, [el('div', { class: 'label-sm', text: 'Case log' })]);
    r.log.forEach(e => {
      let text;
      if (e.left) text = `${e.left} left. Their cards are now public: ${e.cards.join(', ')}.`;
      else if (e.wrongAccusation) text = `❌ ${e.by} accused ${e.suspect} / ${e.weapon} / ${e.room} — wrong. They're out.`;
      else text = `${e.by}: ${e.suspect}, ${e.weapon}, ${e.room} → ` +
        (e.passed.length ? `${e.passed.join(', ')} couldn't. ` : '') +
        (e.shownBy ? `${e.shownBy} showed a card.` : 'nobody could disprove!');
      box.appendChild(el('div', { class: 'clue-log-row', text }));
    });
    return box;
  }

  const PHASES = {};

  PHASES.reveal = (room, r, ctx) => [
    el('h2', { text: 'The case file is sealed.' }),
    el('p', { text: 'Someone did it, with something, somewhere in the office. Your cards are NOT the answer — use them to rule things out.' }),
    handView(),
    el('div', { class: 'label-sm', text: 'Turn order (sit in this order if you can)' }),
    orderBar(r),
    el('div', { class: 'spacer' }),
    ctx.isHost ? el('button', { class: 'primary', text: 'Start Investigation', onclick: () => emit('clue_advance') }) : note('Waiting for the host.')
  ];

  function myTurnControls(r) {
    const me = C.me || {};
    const out = [];
    const accusing = C.mode === 'accuse';
    out.push(el('div', { class: 'diff-tabs clue-mode' }, [
      el('button', { class: accusing ? '' : 'active', text: 'Suggest', onclick: () => { C.mode = 'suggest'; A.render(); } }),
      el('button', { class: accusing ? 'active danger-tab' : '', text: 'Final accusation', onclick: () => { C.mode = 'accuse'; A.render(); } })
    ]));
    out.push(el('p', { class: 'clue-mode-note', text: accusing
      ? 'One shot. Right = you win. Wrong = you\'re out (you still show cards).'
      : 'Pick a room to search, then name a suspect and weapon. You can\'t search the same room twice in a row.' }));
    out.push(picker(r, accusing ? 'Where?' : 'Go to room', 'room', r.cards.rooms, accusing ? null : me.lastRoom));
    out.push(picker(r, 'Who?', 'suspect', r.cards.suspects));
    out.push(picker(r, 'With what?', 'weapon', r.cards.weapons));
    const ready = C.pick.suspect && C.pick.weapon && C.pick.room && !(!accusing && C.pick.room === me.lastRoom);
    const names = {}; [...r.cards.suspects, ...r.cards.weapons, ...r.cards.rooms].forEach(c => { names[c.id] = c.name; });
    const b = el('button', {
      class: accusing ? 'danger' : 'primary',
      text: accusing ? 'Accuse!' : 'Make suggestion',
      onclick: () => {
        const p = { suspect: C.pick.suspect, weapon: C.pick.weapon, room: C.pick.room };
        if (accusing) {
          if (!confirm(`Final accusation:\n${names[p.suspect]}, with the ${names[p.weapon]}, in the ${names[p.room]}?`)) return;
          emit('clue_accuse', p);
        } else emit('clue_suggest', p);
      }
    });
    if (!ready) b.disabled = true;
    out.push(b);
    return out;
  }

  PHASES.turn = (room, r, ctx) => {
    const mine = r.currentId === ctx.me;
    const out = [orderBar(r)];
    if (mine) {
      out.push(el('h2', { text: 'Your turn, detective.' }));
      out.push(...myTurnControls(r));
    } else {
      out.push(el('h2', { text: `${r.currentName} is investigating…` }));
      if (ctx.isHost) out.push(el('button', { class: 'ghost small', text: 'Host: skip their turn', onclick: () => { if (confirm(`Skip ${r.currentName}'s turn?`)) emit('clue_skip_turn'); } }));
    }
    return out;
  };

  PHASES.refute = (room, r, ctx) => {
    const s = r.suggestion;
    const me = C.me || {};
    const out = [orderBar(r), el('div', { class: 'clue-sugg' }, [
      el('div', { class: 'label-sm', text: `${s.byName} suggests` }),
      el('div', { class: 'clue-sugg-text', text: `${s.suspect}, with the ${s.weapon}, in the ${s.room}` })
    ])];
    if (me.needToShow && me.needToShow.length) {
      const names = {}; [...r.cards.suspects, ...r.cards.weapons, ...r.cards.rooms].forEach(c => { names[c.id] = c.name; });
      out.push(el('h2', { text: `Show ${s.byName} one card` }));
      out.push(el('p', { text: 'Only they will see which one. Pick wisely.' }));
      me.needToShow.forEach(id => out.push(el('button', { class: 'primary', text: 'Show: ' + names[id], onclick: () => emit('clue_refute', { card: id }) })));
    } else {
      if (s.passed.length) out.push(note(`${s.passed.join(', ')} couldn't disprove it.`));
      out.push(el('h2', { text: `Waiting for ${s.refuterName} to show ${s.byId === ctx.me ? 'you' : s.byName} a card…` }));
    }
    return out;
  };

  PHASES.suggested = (room, r, ctx) => {
    const s = r.suggestion;
    const me = C.me || {};
    const mine = s.byId === ctx.me;
    const names = {}; [...r.cards.suspects, ...r.cards.weapons, ...r.cards.rooms].forEach(c => { names[c.id] = c.name; });
    const out = [orderBar(r), el('div', { class: 'clue-sugg' }, [
      el('div', { class: 'label-sm', text: `${s.byName} suggested` }),
      el('div', { class: 'clue-sugg-text', text: `${s.suspect}, with the ${s.weapon}, in the ${s.room}` })
    ])];
    if (s.passed.length) out.push(note(`${s.passed.join(', ')} couldn't disprove it.`));
    if (mine) {
      if (s.nobody) out.push(el('div', { class: 'clue-reveal none' }, [el('div', { class: 'big', text: 'Nobody could disprove it!' }), el('div', { text: 'Those cards are either in the case file or in your own hand.' })]));
      else if (me.lastShown) out.push(el('div', { class: 'clue-reveal' }, [el('div', { text: `${me.lastShown.by} showed you:` }), el('div', { class: 'big', text: names[me.lastShown.card] })]));
      out.push(el('button', { class: 'danger', text: 'Make final accusation', onclick: () => { C.mode = 'accuse'; C.forceAccuse = true; A.render(); } }));
      out.push(el('button', { class: 'primary', text: 'End turn', onclick: () => emit('clue_end_turn') }));
      if (C.forceAccuse) { out.push(...myTurnControls(r).slice(2)); }
    } else {
      out.push(el('h2', { text: s.nobody ? 'Nobody could disprove it!' : `${s.shownByName} showed ${s.byName} a card.` }));
      if (me.shownByMe && s.shownByName && me.shownByMe.to === s.byName && s.shownByName === ((A.state.room.players.find(p => p.id === ctx.me) || {}).name)) {
        out.push(note(`You showed: ${names[me.shownByMe.card]}`));
      }
      out.push(note(`Waiting for ${s.byName} to end their turn.`));
      if (ctx.isHost) out.push(el('button', { class: 'ghost small', text: 'Host: skip their turn', onclick: () => emit('clue_skip_turn') }));
    }
    return out;
  };

  const REASONS = {
    solved: (res) => `${res.winnerName} solved it!`,
    last_standing: (res) => `Everyone else accused wrong. ${res.winnerName} wins by default.`,
    everyone_wrong: () => 'Everyone accused wrong. The killer got away.'
  };

  PHASES.results = (room, r, ctx) => {
    const res = r.result;
    const e = res.envelope;
    const out = [
      el('div', { class: 'result-banner ' + (res.winnerId ? 'civ' : 'imp') }, [
        el('h2', { text: res.winnerId ? `${res.winnerName} cracked the case` : 'Case unsolved' }),
        el('p', { style: 'margin-bottom:0', text: (REASONS[res.reason] || (() => ''))(res) })
      ]),
      el('div', { class: 'clue-answer' }, [
        el('div', { class: 'label-sm', text: 'It was' }),
        el('div', { class: 'clue-answer-text', text: `${e.suspect}` }),
        el('div', { class: 'clue-answer-sub', text: `with the ${e.weapon}, in the ${e.room}` })
      ])
    ];
    const list = el('div', { class: 'role-reveal-list' });
    res.hands.forEach(h => list.appendChild(el('div', { class: 'role-reveal-row clue-hand-row' }, [el('span', { text: h.name }), el('span', { class: 'muted', text: h.cards.join(', ') })])));
    out.push(el('div', { class: 'label-sm', text: 'Everyone\'s cards' }));
    out.push(list);
    out.push(el('div', { class: 'spacer' }));
    out.push(ctx.isHost ? el('button', { class: 'primary', text: 'Back to Lobby', onclick: () => emit('play_again') }) : note('Waiting for the host.'));
    return out;
  };

  A.VIEWS.clue = function () {
    const room = A.state.room;
    const r = room && room.round;
    if (!r) return;
    const me = A.state.playerId;
    const ctx = { me, isHost: room.hostId === me };
    const key = r.gameId + ':' + r.phase + ':' + r.currentId;
    if (key !== C.key) {
      C.key = key;
      if (r.phase === 'turn') { C.pick = { suspect: null, weapon: null, room: null }; C.mode = 'suggest'; }
      C.forceAccuse = false;
    }
    const children = [A.brand()];
    if (C.me && C.me.eliminated && r.phase !== 'results') {
      const a = C.me.answer || {};
      const names = {}; [...r.cards.suspects, ...r.cards.weapons, ...r.cards.rooms].forEach(c => { names[c.id] = c.name; });
      children.push(el('div', { class: 'au-ghost', text: `You're out. The answer was ${names[a.suspect]}, ${names[a.weapon]}, ${names[a.room]}. Keep it secret — you still show cards.` }));
    }
    children.push(...(PHASES[r.phase] || (() => []))(room, r, ctx));
    if (r.phase !== 'reveal' && r.phase !== 'results') {
      children.push(handView());
      children.push(notepad(r));
      children.push(logView(r));
    }
    A.root.appendChild(el('div', { class: 'screen' }, children));
  };
})();
