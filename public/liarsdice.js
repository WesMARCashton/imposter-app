// Liar's Dice — client.
(function () {
  const A = window.App;
  const { el, socket } = A;
  const L = A.state.ld = { me: { dice: [], rollId: null }, qty: 1, face: 2, err: '', key: '' };
  const emit = (ev, extra, cb) => socket.emit(ev, Object.assign({ code: A.state.code, playerId: A.state.playerId }, extra || {}), cb);
  const note = (text) => el('p', { class: 'center-note', text });
  const PIPS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  socket.on('ld_you', (me) => {
    const newRoll = me.rollId !== L.me.rollId;
    L.me = me;
    if (newRoll && me.dice.length) { try { if (navigator.vibrate) navigator.vibrate(80); } catch (e) { /* ignore */ } }
    if (A.state.view === 'liarsdice') A.render();
  });

  const die = (v, cls) => el('div', { class: 'ld-die' + (cls || ''), text: PIPS[v] });

  function players(r, ctx) {
    const box = el('div', { class: 'coup-table' });
    r.players.forEach(p => box.appendChild(el('div', { class: 'coup-player' + (p.id === r.currentId && r.phase === 'bidding' ? ' now' : '') + (p.dice === 0 ? ' out' : '') }, [
      el('span', { class: 'coup-pname', text: p.name + (p.id === ctx.me ? ' (you)' : '') }),
      el('span', { class: 'coup-pinfo', text: p.dice ? '🎲'.repeat(p.dice) : 'out' })
    ])));
    return box;
  }

  function minRaise(r) {
    const lowFace = r.wild ? 2 : 1;
    if (!r.bid) return { qty: 1, face: lowFace };
    if (r.bid.face < 6) return { qty: r.bid.qty, face: r.bid.face + 1 };
    return { qty: r.bid.qty + 1, face: lowFace };
  }
  const higher = (r, q, f) => !r.bid || q > r.bid.qty || (q === r.bid.qty && f > r.bid.face);

  const PHASES = {};

  PHASES.bidding = (room, r, ctx) => {
    const mine = r.currentId === ctx.me;
    const myDice = L.me.dice || [];
    const out = [
      el('div', { class: 'ld-mine' }, [el('div', { class: 'label-sm', text: 'Your dice (hidden)' }), el('div', { class: 'ld-dice' }, myDice.map(v => die(v, r.wild && v === 1 ? ' wild' : '')))]),
      el('div', { class: 'ld-table-info', text: `${r.totalDice} dice on the table${r.wild ? ' · 1s are wild' : ''}` })
    ];
    out.push(r.bid
      ? el('div', { class: 'ld-bid' }, [el('div', { class: 'label-sm', text: `${r.bid.byName} bids` }), el('div', { class: 'ld-bid-line' }, [el('span', { class: 'big', text: `${r.bid.qty} ×` }), die(r.bid.face, ' big')])])
      : el('div', { class: 'ld-bid empty', text: 'No bid yet' }));
    if (mine) {
      const def = minRaise(r);
      if (!higher(r, L.qty, L.face) || L.key !== r.roundNum + ':' + (r.bid ? r.bid.qty + '-' + r.bid.face : '')) { L.qty = def.qty; L.face = def.face; L.key = r.roundNum + ':' + (r.bid ? r.bid.qty + '-' + r.bid.face : ''); }
      out.push(el('h2', { text: 'Your move' }));
      out.push(el('div', { class: 'settings-row' }, [
        el('div', {}, [el('div', { class: 'label', text: 'How many' })]),
        el('div', { class: 'stepper' }, [
          el('button', { class: 'secondary small', text: '−', onclick: () => { L.qty = Math.max(1, L.qty - 1); A.render(); } }),
          el('span', { class: 'val', text: L.qty }),
          el('button', { class: 'secondary small', text: '+', onclick: () => { L.qty = Math.min(r.totalDice, L.qty + 1); A.render(); } })
        ])
      ]));
      const faces = el('div', { class: 'ld-faces' });
      for (let f = r.wild ? 2 : 1; f <= 6; f++) faces.appendChild(el('button', { class: 'ld-face' + (L.face === f ? ' on' : ''), text: PIPS[f], onclick: () => { L.face = f; A.render(); } }));
      out.push(faces);
      const ok = higher(r, L.qty, L.face);
      const b = el('button', { class: 'primary', text: `Bid ${L.qty} × ${PIPS[L.face]}`, onclick: () => emit('ld_bid', { qty: L.qty, face: L.face }, (res) => { L.err = res && res.error ? res.error : ''; A.render(); }) });
      if (!ok) b.disabled = true;
      out.push(b);
      if (!ok) out.push(note('Raise it: more dice, or the same number of a higher face.'));
      if (r.bid) out.push(el('button', { class: 'danger ld-liar', text: `🤥 LIAR! (I don't believe ${r.bid.qty} × ${PIPS[r.bid.face]})`, onclick: () => { if (confirm(`Call ${r.bid.byName} a liar?`)) emit('ld_liar'); } }));
      if (L.err) out.push(el('div', { class: 'error-text', text: L.err }));
    } else {
      out.push(el('h2', { class: 'cn-wait', text: `${r.currentName} is thinking…` }));
    }
    out.push(players(r, ctx));
    return out;
  };

  PHASES.reveal = (room, r, ctx) => {
    const v = r.reveal;
    const out = [el('div', { class: 'cs-reveal ' + (v.bidTrue ? 'hit' : 'miss') }, [
      el('div', { text: `${v.caller} called ${v.bidder} a liar on` }),
      el('div', { class: 'big', text: `${v.qty} × ${PIPS[v.face]}` }),
      el('div', { class: 'verdict', text: `There ${v.count === 1 ? 'was' : 'were'} ${v.count}. ${v.bidTrue ? 'The bid was TRUE.' : 'It was a LIE!'}` }),
      el('div', { text: `${v.loser} loses a die${v.loserOut ? ' and is OUT!' : '.'}` })
    ])];
    const box = el('div', { class: 'ld-reveal' });
    v.dice.forEach(p => box.appendChild(el('div', { class: 'ld-reveal-row' }, [
      el('span', { class: 'coup-pname', text: p.name }),
      el('div', { class: 'ld-dice small' }, p.dice.map(d => die(d, d === v.face || (r.wild && d === 1) ? ' match' : ' dim')))
    ])));
    out.push(box);
    const canNext = ctx.isHost || v.loserId === ctx.me;
    out.push(el('div', { class: 'spacer' }));
    out.push(canNext ? el('button', { class: 'primary', text: r.result ? 'See winner' : 'Roll next round', onclick: () => emit('ld_next') }) : note(`Waiting for ${v.loser} or the host to roll.`));
    return out;
  };

  PHASES.results = (room, r, ctx) => [
    el('div', { class: 'result-banner civ' }, [el('h2', { text: `🎲 ${r.result.winner} wins!` }), el('p', { style: 'margin-bottom:0', text: 'Last player with dice.' })]),
    players(r, ctx), el('div', { class: 'spacer' }),
    ctx.isHost ? el('button', { class: 'primary', text: 'Back to Lobby', onclick: () => emit('play_again') }) : note('Waiting for the host.')
  ];

  A.VIEWS.liarsdice = function () {
    const room = A.state.room; const r = room && room.round; if (!r) return;
    const ctx = { me: A.state.playerId, isHost: room.hostId === A.state.playerId };
    if (r.phase !== 'bidding') L.err = '';
    A.root.appendChild(el('div', { class: 'screen' }, [A.brand(), ...(PHASES[r.phase] || (() => []))(room, r, ctx)]));
  };
})();
