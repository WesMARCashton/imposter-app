// Called Shot — client. For the shuffleboard machine.
(function () {
  const A = window.App;
  const { el, socket } = A;
  const S = A.state.cs = { me: { myCall: null, myBet: null }, pick: null, key: '' };

  const emit = (ev, extra) => socket.emit(ev, Object.assign({ code: A.state.code, playerId: A.state.playerId }, extra || {}));
  const note = (text) => el('p', { class: 'center-note', text });

  socket.on('cs_you', (me) => { S.me = me; if (A.state.view === 'calledshot') A.render(); });

  function scoreboard(r, compact) {
    const list = el('div', { class: 'role-reveal-list cs-scores' + (compact ? ' compact' : '') });
    r.scores.forEach((s, i) => list.appendChild(el('div', { class: 'role-reveal-row' + (s.id === r.shooterId && !compact ? ' cs-now' : '') }, [
      el('span', { text: `${i + 1}. ${s.name}` + (s.id === A.state.playerId ? ' (you)' : '') }),
      el('span', { class: 'tag civilian', text: `${s.score} pt${s.score === 1 ? '' : 's'}` })
    ])));
    return list;
  }

  function header(r) {
    return el('div', { class: 'cs-head' }, [
      el('span', { text: r.sport }),
      el('span', { text: `Turn ${r.turn} of ${r.totalTurns}` })
    ]);
  }

  const PHASES = {};

  PHASES.call = (room, r, ctx) => {
    const mine = r.shooterId === ctx.me;
    const out = [header(r)];
    if (mine) {
      out.push(el('h2', { text: 'Your shot. Call it — secretly.' }));
      out.push(el('p', { text: 'Pick the spot you\'re going for. Nobody sees it until after you throw.' }));
      const grid = el('div', { class: 'tg-guess-grid' });
      r.options.forEach(o => grid.appendChild(el('button', { class: 'clue-opt' + (S.pick === o ? ' on' : ''), text: o, onclick: () => { S.pick = o; A.render(); } })));
      out.push(grid);
      const b = el('button', { class: 'primary', text: S.pick ? `Lock in: ${S.pick}` : 'Pick a spot', onclick: () => emit('cs_call', { option: S.pick }) });
      if (!S.pick) b.disabled = true;
      out.push(b);
    } else {
      out.push(el('h2', { text: `${r.shooterName} is calling their shot…` }));
      out.push(note('Get ready to bet: will they hit it?'));
    }
    out.push(el('div', { class: 'label-sm', text: 'Scores' }), scoreboard(r));
    return out;
  };

  PHASES.bet = (room, r, ctx) => {
    const mine = r.shooterId === ctx.me;
    const out = [header(r)];
    if (mine) {
      out.push(el('div', { class: 'cs-callcard' }, [el('div', { class: 'label-sm', text: 'Your call (secret)' }), el('div', { class: 'big', text: S.me.myCall || '' })]));
      out.push(note('Act natural. Bets coming in…'));
    } else {
      out.push(el('h2', { text: `Will ${r.shooterName} hit their called shot?` }));
      out.push(el('p', { text: 'You don\'t know what they called. Read their face.' }));
      const my = S.me.myBet;
      out.push(el('div', { class: 'cs-bets' }, [
        el('button', { class: 'cs-bet hit' + (my === 'hit' ? ' on' : ''), text: '🎯 HIT', onclick: () => emit('cs_bet', { choice: 'hit' }) }),
        el('button', { class: 'cs-bet miss' + (my === 'miss' ? ' on' : ''), text: '❌ MISS', onclick: () => emit('cs_bet', { choice: 'miss' }) })
      ]));
      if (my) out.push(note('Bet placed. You can switch until everyone\'s in.'));
    }
    out.push(el('div', { class: 'progress-pill', text: `${r.betCount}/${r.bettorCount} bets in` }));
    out.push(el('div', { class: 'spacer' }));
    if (ctx.isHost) out.push(el('button', { class: 'ghost small', text: 'Host: stop waiting for bets', onclick: () => emit('cs_force_throw') }));
    return out;
  };

  PHASES.throw = (room, r, ctx) => {
    const mine = r.shooterId === ctx.me;
    const out = [header(r), el('div', { class: 'ww-banner day' }, [el('div', { class: 'big', text: `🎳 ${r.shooterName}, throw!` }), el('div', { text: 'Bets are locked.' })])];
    if (mine) {
      out.push(el('div', { class: 'cs-callcard' }, [el('div', { class: 'label-sm', text: 'You called' }), el('div', { class: 'big', text: S.me.myCall || '' })]));
      out.push(el('p', { text: 'After the throw, be honest:' }));
      out.push(el('div', { class: 'cs-bets' }, [
        el('button', { class: 'cs-bet hit', text: '🎯 I hit it', onclick: () => emit('cs_report', { hit: true }) }),
        el('button', { class: 'cs-bet miss', text: '❌ I missed', onclick: () => emit('cs_report', { hit: false }) })
      ]));
    } else {
      out.push(note('Waiting for the shooter to report.'));
      if (ctx.isHost) out.push(el('div', { class: 'cs-bets' }, [
        el('button', { class: 'ghost small', text: 'Host: mark HIT', onclick: () => emit('cs_report', { hit: true }) }),
        el('button', { class: 'ghost small', text: 'Host: mark MISS', onclick: () => emit('cs_report', { hit: false }) })
      ]));
    }
    return out;
  };

  PHASES.reveal = (room, r, ctx) => {
    const o = r.outcome;
    const out = [header(r), el('div', { class: 'cs-reveal ' + (o.hit ? 'hit' : 'miss') }, [
      el('div', { text: `${o.shooterName} called` }),
      el('div', { class: 'big', text: o.call }),
      el('div', { class: 'verdict', text: o.hit ? '🎯 HIT!' : '❌ MISSED' })
    ])];
    const lines = [`${o.shooterName} +${o.shooterPts}`];
    if (o.right.length) lines.push(`Right: ${o.right.join(', ')} (+1 each)`);
    if (o.wrong.length) lines.push(`Fooled: ${o.wrong.join(', ')}`);
    lines.forEach(t => out.push(note(t)));
    out.push(el('div', { class: 'label-sm', text: 'Scores' }), scoreboard(r, true));
    out.push(el('div', { class: 'spacer' }));
    const canNext = r.shooterId === ctx.me || ctx.isHost;
    const last = r.turn >= r.totalTurns;
    out.push(canNext ? el('button', { class: 'primary', text: last ? 'Final scores' : 'Next shooter', onclick: () => emit('cs_next') }) : note('Waiting for the next shooter.'));
    if (ctx.isHost && !last) out.push(el('button', { class: 'ghost small', text: 'Host: end game now', onclick: () => { if (confirm('End the game and show final scores?')) emit('cs_end'); } }));
    return out;
  };

  PHASES.results = (room, r, ctx) => {
    const st = r.result.standings;
    const top = st.length ? st[0].score : 0;
    const winners = st.filter(s => s.score === top).map(s => s.name);
    const list = el('div', { class: 'role-reveal-list' });
    st.forEach((s, i) => list.appendChild(el('div', { class: 'role-reveal-row' }, [el('span', { text: `${i + 1}. ${s.name}` }), el('span', { class: 'tag civilian', text: `${s.score} pts` })])));
    return [
      el('div', { class: 'result-banner civ' }, [el('h2', { text: `🏆 ${winners.join(' & ')} win${winners.length > 1 ? '' : 's'}` }), el('p', { style: 'margin-bottom:0', text: `${r.sport} · Called Shot` })]),
      list,
      el('div', { class: 'spacer' }),
      ctx.isHost ? el('button', { class: 'primary', text: 'Back to Lobby', onclick: () => emit('play_again') }) : note('Waiting for the host.')
    ];
  };

  A.VIEWS.calledshot = function () {
    const room = A.state.room;
    const r = room && room.round;
    if (!r) return;
    const me = A.state.playerId;
    const ctx = { me, isHost: room.hostId === me };
    const key = r.phase + ':' + r.turn;
    if (key !== S.key) { if (r.phase === 'call') S.pick = null; S.key = key; }
    A.root.appendChild(el('div', { class: 'screen' }, [A.brand(), ...(PHASES[r.phase] || (() => []))(room, r, ctx)]));
  };
})();
