// Hit the Number — client. Plugs into window.App from app.js.
(function () {
  const A = window.App;
  const { el, socket } = A;
  const T = A.state.tg = { key: '', vote: null, guess: '' };

  const emit = (ev, extra) => socket.emit(ev, Object.assign({ code: A.state.code, playerId: A.state.playerId }, extra || {}));
  const note = (text) => el('p', { class: 'center-note', text });
  const hostBtn = (text, ev, cls) => el('button', { class: cls || 'primary', text, onclick: () => emit(ev) });

  // Role card: same layout for both roles so nobody can tell from across the table.
  A.buildTargetCard = function (role) {
    const imp = role.imposter;
    const card = el('div', { class: 'card' });
    const hint = el('div', { class: 'hint', text: 'Press and hold to peek' });
    card.appendChild(el('div', { class: 'lamp' }));
    card.appendChild(hint);
    card.appendChild(el('div', { class: 'content blank' }, [el('div', { class: 'role-word', text: '?' })]));
    card.appendChild(el('div', { class: 'content secret' }, [
      el('div', { class: 'role-label' + (imp ? ' weasel' : ' crew'), text: imp ? 'YOU ARE THE IMPOSTER' : 'YOUR TARGET SCORE' }),
      el('div', { class: 'tg-number' + (imp ? ' imp' : ''), text: imp ? '??' : String(role.target) }),
      el('div', { class: 'category-tag', text: imp
        ? `You don't know the number (it's ${role.range[0]}–${role.range[1]}). Blend in.`
        : `Try to finish ${role.sport} with exactly ${role.target}.` })
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

  const PHASES = {};

  PHASES.reveal = (room, r, ctx) => {
    if (!A.state.myRole) return [note('Dealing numbers…')];
    return [el('div', { class: 'card-reveal' }, [
      A.buildPeekCard(),
      el('p', { text: `Everyone has the same secret target except ${r.imposterCount > 1 ? 'the ' + r.imposterCount + ' Imposters' : 'one Imposter'}. Don't say your number out loud.` }),
      ctx.isHost ? hostBtn('Everyone’s seen it — go play', 'tg_advance') : note('Waiting for the host.')
    ])];
  };

  PHASES.play = (room, r, ctx) => [
    el('div', { class: 'tg-play' }, [
      el('div', { class: 'help-kicker', text: 'Go play' }),
      el('h1', { text: r.sport }),
      el('p', { text: 'Try to finish with exactly your target score. Watch who seems to be aiming for something different.' }),
      el('p', { class: 'muted', text: `Target range this round: ${r.range[0]}–${r.range[1]}. Tap "My Role" to check your number.` })
    ]),
    el('div', { class: 'spacer' }),
    ctx.isHost ? hostBtn('Game over — time to vote', 'tg_advance') : note('When the game ends, the host opens the vote.')
  ];

  PHASES.vote = (room, r, ctx) => {
    const grid = el('div', { class: 'vote-grid' });
    room.players.filter(p => p.id !== ctx.me).forEach(p => grid.appendChild(el('div', {
      class: 'vote-option' + (T.vote === p.id ? ' selected' : ''),
      onclick: () => { T.vote = p.id; emit('tg_vote', { targetId: p.id }); A.render(); }
    }, [el('span', { text: p.name }), T.vote === p.id ? el('span', { class: 'count', text: 'Your vote' }) : null])));
    return [
      el('h2', { text: 'Who was the Imposter?' }),
      el('p', { text: 'Who looked like they were aiming for the wrong score? A tie means the Imposter escapes. You can change your vote until everyone has voted.' }),
      grid,
      el('div', { class: 'progress-pill', text: `${r.votedIds.length}/${room.players.length} voted` }),
      el('div', { class: 'spacer' }),
      ctx.isHost ? hostBtn('Host: Tally Now', 'tg_advance', 'secondary') : null,
      ctx.isHost ? el('button', { class: 'ghost', text: '← Oops, back to the game', onclick: () => emit('tg_back') }) : null
    ];
  };

  PHASES.guess = (room, r, ctx) => {
    if (r.accusedId !== ctx.me) return [
      el('h2', { text: `${r.accusedName} was the Imposter!` }),
      el('p', { text: 'They get one guess at the target number to steal the win.' })
    ];
    const input = el('input', { type: 'text', id: 'tg-guess', inputmode: 'numeric', placeholder: `${r.range[0]}–${r.range[1]}`, autocomplete: 'off' });
    input.value = T.guess;
    const btn = el('button', { class: 'primary', text: 'Lock in guess', onclick: () => { if (confirm(`Final guess: ${T.guess}?`)) emit('tg_guess', { value: T.guess }); } });
    btn.disabled = !String(T.guess).trim();
    input.addEventListener('input', () => { T.guess = input.value.replace(/[^0-9]/g, ''); input.value = T.guess; btn.disabled = !T.guess; });
    return [
      el('h2', { text: 'You got caught!' }),
      el('p', { text: `Guess the exact target number (${r.range[0]}–${r.range[1]}) to steal the win.` }),
      input, btn
    ];
  };

  const REASONS = {
    tie: 'The vote tied. The Imposter slipped away.',
    wrong_vote: (res) => `You voted out ${res.accusedName}, who wasn't the Imposter.`,
    guessed: (res) => `Caught, but they guessed ${res.guess}. Exactly right!`,
    caught: (res) => `Caught, and they guessed ${res.guess}. Wrong.`,
    imposter_left: 'The Imposter left the game.'
  };

  PHASES.results = (room, r, ctx) => {
    const res = r.result;
    const impWon = res.winner === 'imposter';
    const reason = typeof REASONS[res.reason] === 'function' ? REASONS[res.reason](res) : REASONS[res.reason];
    const list = el('div', { class: 'role-reveal-list' });
    res.votes.forEach(v => list.appendChild(el('div', { class: 'role-reveal-row' }, [
      el('span', { text: v.name + (v.votes ? ` · ${v.votes} vote${v.votes === 1 ? '' : 's'}` : '') }),
      el('span', { class: 'tag ' + (v.imposter ? 'imposter' : 'civilian'), text: v.imposter ? 'IMPOSTER' : 'CREW' })
    ])));
    return [
      el('div', { class: 'result-banner ' + (impWon ? 'imp' : 'civ') }, [
        el('h2', { text: impWon ? 'The Imposter wins' : 'Crew wins' }),
        el('p', { style: 'margin-bottom:0', text: reason || '' })
      ]),
      el('div', { class: 'tg-answer' }, [
        el('div', { class: 'label-sm', text: 'The target was' }),
        el('div', { class: 'tg-number small', text: String(res.target) }),
        el('div', { class: 'muted', text: 'Imposter: ' + res.imposters.join(', ') })
      ]),
      list,
      el('div', { class: 'spacer' }),
      ctx.isHost ? el('button', { class: 'primary', text: 'Back to Lobby', onclick: () => emit('play_again') }) : note('Waiting for the host.')
    ];
  };

  A.VIEWS.target = function () {
    const room = A.state.room;
    const r = room && room.round;
    if (!r) return;
    const me = A.state.playerId;
    const ctx = { me, isHost: room.hostId === me };
    if (r.phase !== T.key) {
      if (r.phase === 'vote') T.vote = null;
      if (r.phase === 'guess') T.guess = '';
      if (r.phase === 'vote' && T.key === 'play') { try { if (navigator.vibrate) navigator.vibrate([300, 120, 300]); } catch (e) { /* ignore */ } }
      T.key = r.phase;
    }
    const container = el('div', { class: 'screen' }, [A.brand(), ...(PHASES[r.phase] || (() => []))(room, r, ctx)]);
    A.root.appendChild(container);
    if (r.phase === 'play' || r.phase === 'vote') A.appendPeekFab(container);
  };
})();
