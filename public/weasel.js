// The Weasel — client views. Plugs into window.App from app.js.
(function () {
  const A = window.App;
  const { el, socket } = A;
  const W = A.state.w = { key: '', pick: null, est: '', quiz: null, answers: [], quizRound: null };

  const WEASEL_SVG = `
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-label="Weasel">
  <defs><clipPath id="wz-clip"><circle cx="60" cy="60" r="55"/></clipPath></defs>
  <circle cx="60" cy="60" r="57" fill="#2A0F12" stroke="#C24949" stroke-width="4"/>
  <g clip-path="url(#wz-clip)">
    <path d="M30 124 Q34 92 60 89 Q86 92 90 124 Z" fill="#9A5B2E"/>
    <path d="M46 124 Q48 98 60 96 Q72 98 74 124 Z" fill="#F3E3C6"/>
  </g>
  <circle cx="35" cy="33" r="11" fill="#9A5B2E"/><circle cx="35" cy="33" r="5.5" fill="#E2A98C"/>
  <circle cx="85" cy="33" r="11" fill="#9A5B2E"/><circle cx="85" cy="33" r="5.5" fill="#E2A98C"/>
  <path d="M60 22 C84 22 94 40 92 56 C90 74 76 90 60 92 C44 90 30 74 28 56 C26 40 36 22 60 22 Z" fill="#9A5B2E"/>
  <path d="M38 66 C44 60 52 62 60 64 C68 62 76 60 82 66 C80 80 70 90 60 90 C50 90 40 80 38 66 Z" fill="#F3E3C6"/>
  <path d="M30 50 C40 42 50 46 60 50 C70 46 80 42 90 50 C88 60 78 62 70 58 C66 56 62 56 60 57 C58 56 54 56 50 58 C42 62 32 60 30 50 Z" fill="#2A1A10"/>
  <ellipse cx="46" cy="52" rx="5" ry="3" fill="#F7D25A"/><circle cx="47.5" cy="52" r="1.8" fill="#111"/>
  <ellipse cx="74" cy="52" rx="5" ry="3" fill="#F7D25A"/><circle cx="75.5" cy="52" r="1.8" fill="#111"/>
  <path d="M38 43 L53 47" stroke="#2A1A10" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M82 43 L67 47" stroke="#2A1A10" stroke-width="3.2" stroke-linecap="round"/>
  <ellipse cx="60" cy="68" rx="5" ry="3.5" fill="#2A1A10"/>
  <path d="M52 76 Q60 80 69 73" fill="none" stroke="#2A1A10" stroke-width="2.4" stroke-linecap="round"/>
  <g stroke="#2A1A10" stroke-width="1.2" stroke-linecap="round" opacity="0.7">
    <path d="M44 70 L26 66"/><path d="M44 73 L27 76"/><path d="M76 70 L94 66"/><path d="M76 73 L93 76"/>
  </g>
</svg>`;

  const CREW_SVG = `
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-label="Crew">
  <circle cx="60" cy="60" r="57" fill="#16241E" stroke="#4B9E7A" stroke-width="4"/>
  <path d="M60 24 L88 34 V58 C88 76 76 89 60 96 C44 89 32 76 32 58 V34 Z" fill="#4B9E7A"/>
  <path d="M47 60 L56 69 L74 50" fill="none" stroke="#14171C" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

  const svgBox = (markup, cls) => { const d = el('div', { class: cls }); d.innerHTML = markup; return d; };
  const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const emitAdvance = () => socket.emit('w_advance', { code: A.state.code, playerId: A.state.playerId });
  const hostBtn = (text, cls) => el('button', { class: cls || 'primary', text, onclick: emitAdvance });
  const note = (text) => el('p', { class: 'center-note', text });
  const nameOf = (id) => { const p = A.state.room.players.find(x => x.id === id); return p ? p.name : 'Someone'; };

  socket.on('your_quiz', (q) => {
    W.quiz = q;
    W.quizRound = q.round;
    W.answers = new Array(q.questions.length).fill(null);
    A.render();
  });

  // Role card: identical size, layout and animation for both roles.
  A.buildWeaselCard = function (role) {
    const isW = role.role === 'weasel';
    const card = el('div', { class: 'card' });
    const hint = el('div', { class: 'hint', text: 'Press and hold to peek' });
    card.appendChild(el('div', { class: 'lamp' }));
    card.appendChild(hint);
    card.appendChild(el('div', { class: 'content blank' }, [el('div', { class: 'role-word', text: '?' })]));
    card.appendChild(el('div', { class: 'content secret' }, [
      svgBox(isW ? WEASEL_SVG : CREW_SVG, 'role-logo'),
      el('div', { class: 'role-label' + (isW ? ' weasel' : ' crew'), text: isW ? 'YOU ARE THE WEASEL' : 'YOU ARE CREW' }),
      el('div', { class: 'role-desc', text: isW ? 'Drain the pot. Don’t get caught.' : 'Grow the pot. Find the Weasel.' })
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

  function optionList(options, selected, onPick) {
    const list = el('div', { class: 'vote-grid' });
    options.forEach((label, i) => {
      list.appendChild(el('div', {
        class: 'vote-option' + (selected === i ? ' selected' : ''),
        onclick: () => onPick(i)
      }, [el('span', { text: label })]));
    });
    return list;
  }

  function lockIn(value, disabled) {
    const b = el('button', {
      class: 'primary', text: 'Lock In',
      onclick: () => socket.emit('w_submit', { code: A.state.code, playerId: A.state.playerId, value })
    });
    if (disabled) b.disabled = true;
    return b;
  }

  const PHASES = {};

  PHASES.reveal = (room, r, ctx) => {
    if (!A.state.myRole) return [note('Dealing roles…')];
    return [
      el('div', { class: 'card-reveal' }, [
        A.buildPeekCard(),
        el('p', { text: 'One of you is the Weasel. Keep your role to yourself. You can check it anytime.' }),
        ctx.isHost ? hostBtn('Start Mission 1') : note('Waiting for the host to start.')
      ])
    ];
  };

  PHASES.intro = (room, r, ctx) => {
    const m = r.mission;
    const out = [
      el('div', { class: 'w-kicker', text: `Mission ${r.roundNum}${r.isFinalRound ? ' — Final round' : ''}` }),
      el('h1', { text: m.title }),
      el('p', { text: m.rules })
    ];
    if (m.type === 'vault') {
      out.push(el('div', { class: 'label-sm', text: 'Vault team' }));
      const list = el('div', { class: 'order-list' });
      m.teamIds.forEach(id => list.appendChild(el('div', { class: 'order-item' }, [el('span', { text: nameOf(id) + (id === ctx.me ? ' (you)' : '') })])));
      out.push(list);
    }
    out.push(el('div', { class: 'spacer' }));
    out.push(ctx.isHost ? hostBtn('Start Mission') : note('Waiting for the host.'));
    return out;
  };

  PHASES.mission = (room, r, ctx) => {
    const m = r.mission;
    const required = r.requiredIds.includes(ctx.me);
    const done = r.submittedIds.includes(ctx.me);
    const out = [el('div', { class: 'w-kicker', text: m.title })];

    if (!required) {
      out.push(el('h2', { text: m.type === 'vault' ? 'The vault team is working.' : 'Mission in progress.' }));
      out.push(el('p', { text: m.type === 'vault' ? 'Watch their faces closely.' : 'You’re out, so just watch.' }));
    } else if (done) {
      out.push(el('h2', { text: 'Locked in.' }));
      out.push(el('p', { text: 'Waiting for everyone else.' }));
    } else if (m.type === 'trivia' || m.type === 'sync') {
      out.push(el('h2', { text: m.question }));
      out.push(el('p', { text: m.type === 'sync' ? 'No talking. Match the group.' : 'No talking. Answer alone.' }));
      out.push(optionList(m.options, W.pick, (i) => { W.pick = i; A.render(); }));
      out.push(lockIn(W.pick, W.pick === null));
    } else if (m.type === 'estimate') {
      out.push(el('h2', { text: m.question }));
      const input = el('input', { type: 'text', id: 'w-est', inputmode: 'decimal', placeholder: 'Your guess' + (m.unit ? ` (${m.unit})` : ''), autocomplete: 'off' });
      input.value = W.est;
      input.addEventListener('input', () => { W.est = input.value; btn.disabled = !W.est.trim(); });
      const btn = el('button', {
        class: 'primary', text: 'Lock In',
        onclick: () => socket.emit('w_submit', { code: A.state.code, playerId: A.state.playerId, value: W.est })
      });
      btn.disabled = !W.est.trim();
      out.push(input, btn);
    } else if (m.type === 'vault') {
      out.push(el('h2', { text: 'You’re on the vault team.' }));
      out.push(el('p', { text: 'Shield your screen. Pick one.' }));
      out.push(optionList(['Crack it', 'Jam it'], W.pick, (i) => { W.pick = i; A.render(); }));
      out.push(lockIn(W.pick === 0 ? 'crack' : 'jam', W.pick === null));
    }

    out.push(el('div', { class: 'progress-pill', text: `${r.submittedIds.length}/${r.requiredIds.length} locked in` }));
    out.push(el('div', { class: 'spacer' }));
    if (ctx.isHost) out.push(hostBtn('Host: End Mission Now', 'secondary'));
    return out;
  };

  PHASES.mission_result = (room, r, ctx) => {
    const res = r.missionResult;
    const out = [
      el('div', { class: 'w-kicker', text: res.title + ' — results' }),
      el('div', { class: 'w-earned' + (res.earned ? '' : ' zero'), text: res.earned ? '+' + money(res.earned) : '$0' }),
      el('p', { class: 'center-note', text: `out of ${money(res.possible)} possible` })
    ];
    const box = el('div', { class: 'w-detail' });
    if (res.type === 'trivia') {
      box.appendChild(el('div', { text: `${res.correct} of ${res.total} got it right.` }));
      box.appendChild(el('div', { class: 'muted', text: `Answer: ${res.answerText}` }));
    } else if (res.type === 'sync') {
      box.appendChild(el('div', { text: res.question }));
      const total = res.counts.reduce((a, b) => a + b, 0) || 1;
      res.options.forEach((o, i) => {
        box.appendChild(el('div', { class: 'w-bar' }, [
          el('span', { class: 'w-bar-label', text: `${o} — ${res.counts[i]}` }),
          el('span', { class: 'w-bar-fill', style: `width:${(res.counts[i] / total) * 100}%` })
        ]));
      });
    } else if (res.type === 'estimate') {
      box.appendChild(el('div', { text: res.question }));
      box.appendChild(el('div', { class: 'muted', text: res.guesses ? `Group average: ${fmt(res.average)} ${res.unit || ''}` : 'No guesses locked in.' }));
      box.appendChild(el('div', { class: 'muted', text: `Real answer: ${fmt(res.answer)} ${res.unit || ''}` }));
    } else if (res.type === 'vault') {
      box.appendChild(el('div', { text: res.jams === 0 && !res.missing ? 'Vault cracked clean.' : `${res.jams} jam${res.jams === 1 ? '' : 's'} detected.` }));
      if (res.missing) box.appendChild(el('div', { class: 'muted', text: `${res.missing} team member${res.missing === 1 ? '' : 's'} didn’t lock in.` }));
    }
    out.push(box);
    out.push(el('div', { class: 'spacer' }));
    out.push(ctx.isHost ? hostBtn(r.isFinalRound ? 'Start Final Quiz' : 'Start Quiz') : note('Quiz time is next.'));
    return out;
  };

  PHASES.quiz = (room, r, ctx) => {
    const out = [el('div', { class: 'w-kicker', text: r.isFinalRound ? 'Final quiz' : `Quiz ${r.roundNum}` })];
    const done = r.quizSubmittedIds.includes(ctx.me);
    if (!ctx.alive) {
      out.push(el('h2', { text: 'Survivors are taking the quiz.' }));
    } else if (done) {
      out.push(el('h2', { text: 'Quiz locked in.' }));
      out.push(el('p', { text: 'Waiting for everyone else.' }));
    } else if (!W.quiz || W.quizRound !== r.roundNum) {
      out.push(note('Loading quiz…'));
    } else {
      out.push(el('h2', { text: 'How well do you know the Weasel?' }));
      out.push(el('p', { text: r.isFinalRound ? 'Top score wins the pot. Ties go to the faster finisher.' : (r.eliminations ? 'Lowest score is out. Ties go to the faster finisher.' : 'Points add up. Ties go to the faster finisher.') }));
      W.quiz.questions.forEach((q, qi) => {
        out.push(el('div', { class: 'w-q' }, [
          el('div', { class: 'w-q-num', text: `Q${qi + 1}` }),
          el('div', { class: 'w-q-text', text: q.q }),
          optionList(q.options, W.answers[qi], (i) => { W.answers[qi] = i; A.render(); })
        ]));
      });
      const ready = W.answers.every(a => a !== null);
      const b = el('button', {
        class: 'primary', text: 'Submit Quiz',
        onclick: () => socket.emit('w_quiz_submit', { code: A.state.code, playerId: A.state.playerId, answers: W.answers })
      });
      if (!ready) b.disabled = true;
      out.push(b);
    }
    out.push(el('div', { class: 'progress-pill', text: `${r.quizSubmittedIds.length}/${r.alive.length} submitted` }));
    out.push(el('div', { class: 'spacer' }));
    if (ctx.isHost) out.push(hostBtn('Host: Close Quiz Now', 'secondary'));
    return out;
  };

  PHASES.quiz_done = (room, r, ctx) => [
    el('h1', { text: 'Quizzes are in.' }),
    el('p', { text: r.isFinalRound ? 'Time to crown a winner and unmask the Weasel.' : (r.eliminations ? 'Everyone look at your own phone. The host reveals together.' : 'Scores banked. On to the next mission.') }),
    el('div', { class: 'spacer' }),
    ctx.isHost ? hostBtn(r.isFinalRound ? 'Unmask the Weasel' : (r.eliminations ? 'Reveal' : 'Continue')) : note('Waiting for the host.')
  ];

  PHASES.elimination = (room, r, ctx) => {
    const out = [];
    if (!r.eliminations || !r.lastElimId) {
      out.push(el('h1', { text: 'No one goes home.' }));
      out.push(el('p', { text: 'On to the next mission.' }));
    } else if (r.lastElimId === ctx.me) {
      out.push(el('div', { class: 'w-verdict out' }, [el('div', { class: 'big', text: 'You’re out.' }), el('div', { text: 'You can stay and watch.' })]));
    } else if (ctx.alive) {
      out.push(el('div', { class: 'w-verdict safe' }, [el('div', { class: 'big', text: 'Safe.' }), el('div', { text: `${r.lastElimName} is out.` })]));
    } else {
      out.push(el('h2', { text: `${r.lastElimName} is out.` }));
    }
    out.push(el('div', { class: 'spacer' }));
    out.push(ctx.isHost ? hostBtn('Next Mission') : note('Waiting for the host.'));
    return out;
  };

  PHASES.final = (room, r, ctx) => {
    const f = r.final;
    const iAmWeasel = f.weaselId === ctx.me;
    const out = [svgBox(WEASEL_SVG, 'w-final-logo')];
    out.push(el('div', { class: 'w-kicker center', text: 'The Weasel was' }));
    out.push(el('h1', { class: 'center', text: f.weaselName + (iAmWeasel ? ' (you)' : '') }));
    if (f.endReason === 'weasel_left') out.push(note('The Weasel left the game.'));
    if (f.endReason === 'no_crew') out.push(note('No crew left standing.'));

    const pct = f.maxPot ? Math.round((f.pot / f.maxPot) * 100) : 0;
    out.push(el('div', { class: 'result-banner ' + (f.winnerId ? 'civ' : 'imp') }, [
      el('h2', { text: f.winnerName ? `${f.winnerName} wins ${money(f.pot)}` : `Pot: ${money(f.pot)}` }),
      el('p', { style: 'margin-bottom:0', text: `Crew banked ${pct}% of a possible ${money(f.maxPot)}. The Weasel cost them ${money(f.maxPot - f.pot)}.` })
    ]));

    if (f.standings.length) {
      out.push(el('div', { class: 'label-sm', text: 'Final quiz' }));
      const list = el('div', { class: 'role-reveal-list' });
      f.standings.forEach((s, i) => list.appendChild(el('div', { class: 'role-reveal-row' }, [
        el('span', { text: `${i + 1}. ${s.name}` }), el('span', { class: 'tag civilian', text: `${s.score}/${s.of}` })
      ])));
      out.push(list);
    }

    out.push(el('div', { class: 'label-sm', text: 'Missions' }));
    const hist = el('div', { class: 'role-reveal-list' });
    f.history.forEach(h => hist.appendChild(el('div', { class: 'role-reveal-row' }, [
      el('span', { text: `${h.round}. ${h.title}` }), el('span', { class: 'tag ' + (h.earned ? 'civilian' : 'imposter'), text: `${money(h.earned)} / ${money(h.possible)}` })
    ])));
    out.push(hist);
    if (f.eliminated.length) out.push(el('p', { class: 'center-note', text: 'Out, in order: ' + f.eliminated.join(', ') }));

    out.push(el('div', { class: 'spacer' }));
    out.push(ctx.isHost
      ? el('button', { class: 'primary', text: 'Back to Lobby', onclick: () => socket.emit('play_again', { code: A.state.code, playerId: A.state.playerId }) })
      : note('Waiting for the host.'));
    return out;
  };

  A.VIEWS.weasel = function () {
    const room = A.state.room;
    const r = room && room.round;
    if (!r) return;
    const me = A.state.playerId;
    const ctx = { me, isHost: room.hostId === me, alive: r.alive.includes(me) };

    const key = r.roundNum + ':' + r.phase;
    if (key !== W.key) {
      W.key = key; W.pick = null; W.est = '';
      if (r.phase === 'reveal') { W.quiz = null; W.answers = []; W.quizRound = null; }
    }

    const head = (r.phase !== 'reveal' && r.phase !== 'final')
      ? el('div', { class: 'w-hdr' }, [
          el('span', { text: `Mission ${r.roundNum} of ${r.maxRounds}` }),
          el('span', { class: 'w-pot', text: 'Pot ' + money(r.pot) })
        ])
      : null;
    const spectating = !ctx.alive && r.phase !== 'final' && !(r.phase === 'elimination' && r.lastElimId === me)
      ? el('div', { class: 'w-spectator', text: 'You’re out — spectating' })
      : null;

    const container = el('div', { class: 'screen' + (r.phase === 'final' ? ' w-final' : '') },
      [A.brand(), head, spectating, ...(PHASES[r.phase] || (() => []))(room, r, ctx)]);
    A.root.appendChild(container);
    if (r.phase !== 'final' && r.phase !== 'reveal') A.appendPeekFab(container);
  };
})();
