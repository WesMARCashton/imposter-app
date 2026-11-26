// Coup — client.
(function () {
  const A = window.App;
  const { el, socket } = A;
  const K = A.state.coup = { me: { hand: [], mustLose: false, exchange: null }, action: null, target: null, keep: [], err: '', cheat: false };
  const emit = (ev, extra, cb) => socket.emit(ev, Object.assign({ code: A.state.code, playerId: A.state.playerId }, extra || {}), cb);
  const note = (text) => el('p', { class: 'center-note', text });

  const ROLE_INFO = {
    Duke: { icon: '👑', power: 'Tax: take 3 coins. Blocks Foreign Aid.' },
    Assassin: { icon: '🗡️', power: 'Assassinate: pay 3, target loses a card.' },
    Captain: { icon: '⚓', power: 'Steal 2 coins. Blocks stealing.' },
    Ambassador: { icon: '📜', power: 'Exchange cards with the deck. Blocks stealing.' },
    Contessa: { icon: '💃', power: 'Blocks assassination.' }
  };
  const ACTIONS = [
    { id: 'income', label: 'Income', sub: '+1 coin · can\'t be stopped' },
    { id: 'foreign_aid', label: 'Foreign Aid', sub: '+2 coins · Duke can block' },
    { id: 'tax', label: '👑 Tax', sub: 'Claim Duke · +3 coins' },
    { id: 'steal', label: '⚓ Steal', sub: 'Claim Captain · take 2', target: true },
    { id: 'assassinate', label: '🗡️ Assassinate', sub: 'Claim Assassin · pay 3', target: true, cost: 3 },
    { id: 'exchange', label: '📜 Exchange', sub: 'Claim Ambassador · swap cards' },
    { id: 'coup', label: '💥 Coup', sub: 'Pay 7 · target loses a card', target: true, cost: 7 }
  ];

  socket.on('coup_you', (me) => { K.me = me; if (A.state.view === 'coup') A.render(); });

  const cardEl = (c, extra) => el('div', { class: 'coup-card' + (c.dead ? ' dead' : '') + (extra || '') }, [
    el('div', { class: 'coup-card-icon', text: ROLE_INFO[c.role].icon }),
    el('div', { class: 'coup-card-role', text: c.role }),
    el('div', { class: 'coup-card-power', text: c.dead ? 'Lost' : ROLE_INFO[c.role].power })
  ]);

  function myHand() {
    return el('div', { class: 'coup-hand' }, [
      el('div', { class: 'label-sm', text: 'Your cards (secret)' }),
      el('div', { class: 'coup-cards' }, K.me.hand.map(c => cardEl(c)))
    ]);
  }

  function table(r, ctx) {
    const box = el('div', { class: 'coup-table' });
    r.players.forEach(p => box.appendChild(el('div', { class: 'coup-player' + (p.id === r.currentId && r.phase !== 'results' ? ' now' : '') + (p.influence === 0 ? ' out' : '') }, [
      el('span', { class: 'coup-pname', text: p.name + (p.id === ctx.me ? ' (you)' : '') }),
      el('span', { class: 'coup-pinfo', text: `🪙 ${p.coins} · ${'🂠'.repeat(p.influence)}${p.revealed.map(x => ' ✗' + x).join('')}` })
    ])));
    return box;
  }

  function logView(r) {
    if (!r.log.length) return null;
    const box = el('div', { class: 'clue-log' }, [el('div', { class: 'label-sm', text: 'What happened' })]);
    r.log.slice(0, 8).forEach(t => box.appendChild(el('div', { class: 'clue-log-row', text: t })));
    return box;
  }

  function cheatSheet() {
    const b = el('div', { class: 'clue-notes' }, [el('button', { class: 'clue-notes-head', onclick: () => { K.cheat = !K.cheat; A.render(); } }, [el('span', { text: 'Character cheat sheet' }), el('span', { text: K.cheat ? '▲' : '▼' })])]);
    if (K.cheat) Object.entries(ROLE_INFO).forEach(([role, i]) => b.appendChild(el('div', { class: 'clue-note-row' }, [el('span', { class: 'clue-note-mark', text: i.icon }), el('span', { class: 'clue-note-name', text: `${role} — ${i.power}` })])));
    return b;
  }

  const PHASES = {};

  PHASES.action = (room, r, ctx) => {
    const mine = r.currentId === ctx.me;
    const out = [];
    if (!mine) { out.push(el('h2', { text: `${r.currentName}'s turn` }), note('Waiting for them to act…')); return out; }
    const myCoins = r.players.find(p => p.id === ctx.me).coins;
    out.push(el('h2', { text: 'Your turn' }));
    if (myCoins >= 10) out.push(note('You have 10+ coins — you must Coup.'));
    const list = el('div', { class: 'coup-actions' });
    ACTIONS.forEach(a => {
      const dis = (myCoins >= 10 && a.id !== 'coup') || (a.cost && myCoins < a.cost);
      const b = el('button', { class: 'coup-action' + (K.action === a.id ? ' on' : ''), onclick: () => { K.action = a.id; K.target = null; K.err = ''; A.render(); } }, [el('div', { class: 'coup-action-label', text: a.label }), el('div', { class: 'coup-action-sub', text: a.sub })]);
      if (dis) b.disabled = true;
      list.appendChild(b);
    });
    out.push(list);
    const act = ACTIONS.find(a => a.id === K.action);
    if (act && act.target) {
      out.push(el('div', { class: 'label-sm', text: 'Target' }));
      const tg = el('div', { class: 'ww-chips' });
      r.players.filter(p => p.id !== ctx.me && p.influence > 0).forEach(p => tg.appendChild(el('button', { class: 'ww-chip' + (K.target === p.id ? ' on' : ''), text: `${p.name} (🪙${p.coins})`, onclick: () => { K.target = p.id; A.render(); } })));
      out.push(tg);
    }
    const ready = act && (!act.target || K.target);
    const go = el('button', { class: 'primary', text: act ? `Do it: ${act.label.replace(/^\S+ /, '')}` : 'Pick an action', onclick: () => emit('coup_declare', { action: K.action, target: K.target }, (res) => { K.err = res && res.error ? res.error : ''; K.action = null; K.target = null; A.render(); }) });
    if (!ready) go.disabled = true;
    out.push(go);
    if (K.err) out.push(el('div', { class: 'error-text', text: K.err }));
    out.push(note('Tip: you can claim any character, even if you don\'t have it. That\'s the bluff.'));
    return out;
  };

  function pendingBanner(r) {
    const p = r.pending;
    return el('div', { class: 'coup-pending' }, [
      el('div', { class: 'big', text: `${p.actorName}: ${p.label}${p.targetName ? ' → ' + p.targetName : ''}` }),
      el('div', { text: p.claim ? `Claims ${ROLE_INFO[p.claim].icon} ${p.claim}` : 'No character claimed' }),
      p.block ? el('div', { class: 'coup-block', text: `🛡 ${p.block.byName} blocks with ${ROLE_INFO[p.block.role].icon} ${p.block.role}` }) : null
    ]);
  }

  PHASES.respond = (room, r, ctx) => {
    const p = r.pending;
    const out = [pendingBanner(r)];
    const amResponder = p.responderIds.includes(ctx.me) && !p.passedIds.includes(ctx.me);
    if (amResponder) {
      const row = el('div', { class: 'coup-responses' });
      row.appendChild(el('button', { class: 'secondary', text: '👍 Allow', onclick: () => emit('coup_respond', { type: 'pass' }) }));
      if (p.canChallenge) row.appendChild(el('button', { class: 'danger', text: `🤨 Challenge (you think they don't have ${p.claim})`, onclick: () => { if (confirm(`Challenge ${p.actorName}'s ${p.claim}? If they have it, YOU lose a card.`)) emit('coup_respond', { type: 'challenge' }); } }));
      if (p.blockers.includes(ctx.me)) p.blockRoles.forEach(role => row.appendChild(el('button', { class: 'primary', text: `🛡 Block as ${ROLE_INFO[role].icon} ${role}`, onclick: () => emit('coup_respond', { type: 'block', role }) })));
      out.push(row);
    } else {
      out.push(note(p.waitingOn.length ? `Waiting on: ${p.waitingOn.join(', ')}` : 'Resolving…'));
    }
    return out;
  };

  PHASES.block_respond = (room, r, ctx) => {
    const p = r.pending;
    const out = [pendingBanner(r)];
    const amResponder = p.responderIds.includes(ctx.me) && !p.passedIds.includes(ctx.me);
    if (amResponder) out.push(el('div', { class: 'coup-responses' }, [
      el('button', { class: 'secondary', text: '👍 Accept the block', onclick: () => emit('coup_respond', { type: 'pass' }) }),
      el('button', { class: 'danger', text: `🤨 Challenge (they don't have ${p.block.role})`, onclick: () => { if (confirm(`Challenge ${p.block.byName}'s ${p.block.role}? If they have it, YOU lose a card.`)) emit('coup_respond', { type: 'challenge' }); } })
    ]));
    else out.push(note(p.waitingOn.length ? `Waiting on: ${p.waitingOn.join(', ')}` : 'Resolving…'));
    return out;
  };

  PHASES.lose = (room, r, ctx) => {
    if (!K.me.mustLose) return [el('h2', { text: `${r.losingName} is choosing a card to lose…` })];
    return [
      el('h2', { text: 'You lose a card.' }),
      el('p', { text: 'Pick which one to reveal. Keep the one that helps you most.' }),
      el('div', { class: 'coup-cards' }, K.me.hand.map((c, i) => c.dead ? cardEl(c) : el('button', { class: 'coup-pick', onclick: () => { if (confirm(`Give up your ${c.role}?`)) emit('coup_lose', { idx: i }); } }, [cardEl(c, ' pickable')])))
    ];
  };

  PHASES.exchange = (room, r, ctx) => {
    const ex = K.me.exchange;
    if (!ex) return [el('h2', { text: `${r.exchangingName} is exchanging cards…` })];
    const out = [el('h2', { text: `Keep ${ex.keep} card${ex.keep > 1 ? 's' : ''}` }), el('p', { text: 'The rest go back into the deck.' })];
    const cards = el('div', { class: 'coup-cards wrap' });
    ex.options.forEach((role, i) => cards.appendChild(el('button', { class: 'coup-pick' + (K.keep.includes(i) ? ' on' : ''), onclick: () => {
      if (K.keep.includes(i)) K.keep = K.keep.filter(x => x !== i); else if (K.keep.length < ex.keep) K.keep.push(i);
      A.render();
    } }, [cardEl({ role, dead: false })])));
    out.push(cards);
    const b = el('button', { class: 'primary', text: 'Keep these', onclick: () => { emit('coup_exchange', { keep: K.keep }); K.keep = []; } });
    if (K.keep.length !== ex.keep) b.disabled = true;
    out.push(b);
    return out;
  };

  PHASES.results = (room, r, ctx) => [
    el('div', { class: 'result-banner civ' }, [el('h2', { text: r.result.winner ? `👑 ${r.result.winner} wins!` : 'Game over' }), el('p', { style: 'margin-bottom:0', text: 'Last player with influence standing.' })]),
    table(r, ctx), logView(r), el('div', { class: 'spacer' }),
    ctx.isHost ? el('button', { class: 'primary', text: 'Back to Lobby', onclick: () => emit('play_again') }) : note('Waiting for the host.')
  ];

  A.VIEWS.coup = function () {
    const room = A.state.room; const r = room && room.round; if (!r) return;
    const ctx = { me: A.state.playerId, isHost: room.hostId === A.state.playerId };
    if (r.phase !== 'exchange') K.keep = [];
    const out = [A.brand()];
    const meP = r.players.find(p => p.id === ctx.me);
    if (meP && meP.influence === 0 && r.phase !== 'results') out.push(el('div', { class: 'au-ghost', text: 'You\'re out. Watch the bluffs fly.' }));
    out.push(...(PHASES[r.phase] || (() => []))(room, r, ctx));
    if (r.phase !== 'results') out.push(myHand(), table(r, ctx), logView(r), cheatSheet());
    A.root.appendChild(el('div', { class: 'screen' }, out));
  };
})();
