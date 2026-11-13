// Off the Map — client views. Plugs into window.App from app.js.
(function () {
  const A = window.App;
  const { el, socket } = A;
  const O = A.state.om = { key: '', crossed: new Set(), guessMode: false, vote: null, skew: 0, lastServerNow: 0 };

  const PIN_SVG = `
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-label="Location">
  <circle cx="60" cy="60" r="57" fill="#142033" stroke="#4A8FE7" stroke-width="4"/>
  <path d="M60 24 C45 24 34 35 34 50 C34 70 60 96 60 96 C60 96 86 70 86 50 C86 35 75 24 60 24 Z" fill="#4A8FE7"/>
  <circle cx="60" cy="50" r="11" fill="#142033"/>
</svg>`;
  const SPY_SVG = `
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-label="Weasel">
  <circle cx="60" cy="60" r="57" fill="#2A0F12" stroke="#C24949" stroke-width="4"/>
  <path d="M30 52 L40 30 Q60 24 80 30 L90 52 Z" fill="#C24949"/>
  <rect x="24" y="50" width="72" height="7" rx="3.5" fill="#C24949"/>
  <circle cx="45" cy="72" r="11" fill="none" stroke="#EDEEF0" stroke-width="4"/>
  <circle cx="75" cy="72" r="11" fill="none" stroke="#EDEEF0" stroke-width="4"/>
  <path d="M56 72 Q60 68 64 72" fill="none" stroke="#EDEEF0" stroke-width="4"/>
</svg>`;

  // Question deck: shuffled per device, no repeats until the deck runs out.
  function nextQuestion() {
    if (!O.deck || !O.deck.length) {
      const q = (window.OFFMAP_QUESTIONS || []).slice();
      for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
      O.deck = q;
    }
    O.question = O.deck.pop() || null;
  }
  function questionCard() {
    if (!O.question) nextQuestion();
    if (!O.question) return null;
    return el('div', { class: 'om-qcard' }, [
      el('div', { class: 'om-qcard-label', text: 'Need a question? Ask someone:' }),
      el('div', { class: 'om-qcard-text', text: O.question }),
      el('button', { class: 'secondary small', text: 'Skip \u2192 New question', onclick: () => { nextQuestion(); A.render(); } })
    ]);
  }

  A.SPY_SVG = SPY_SVG;
  const svgBox = (markup, cls) => { const d = el('div', { class: cls }); d.innerHTML = markup; return d; };
  const note = (text) => el('p', { class: 'center-note', text });
  const hostBtn = (text, cls) => el('button', { class: cls || 'primary', text, onclick: () => socket.emit('om_advance', { code: A.state.code, playerId: A.state.playerId }) });

  // Role card: identical layout for Weasel and crew.
  A.buildOffmapCard = function (role) {
    const card = el('div', { class: 'card' });
    const hint = el('div', { class: 'hint', text: 'Press and hold to peek' });
    card.appendChild(el('div', { class: 'lamp' }));
    card.appendChild(hint);
    card.appendChild(el('div', { class: 'content blank' }, [el('div', { class: 'role-word', text: '?' })]));
    card.appendChild(el('div', { class: 'content secret' }, [
      svgBox(role.spy ? (A.WEASEL_SVG || SPY_SVG) : PIN_SVG, 'role-logo'),
      el('div', { class: 'role-label' + (role.spy ? ' weasel' : ' om'), text: role.spy ? 'YOU ARE THE WEASEL' : 'LOCATION' }),
      el('div', { class: 'role-word', text: role.spy ? '???' : role.location }),
      el('div', { class: 'category-tag', text: role.spy ? 'Figure out where everyone is.' : 'Your job: ' + role.job })
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

  function remainingText(r) {
    if (!r.endsAt) return null;
    const ms = Math.max(0, r.endsAt - (Date.now() + O.skew));
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  setInterval(() => {
    const t = document.getElementById('om-timer');
    const r = A.state.room && A.state.room.round;
    if (t && r && r.game === 'offmap') t.textContent = remainingText(r);
  }, 500);

  function locationGrid(r, opts) {
    const grid = el('div', { class: 'om-grid' + (opts.guess ? ' guessing' : '') });
    r.locations.forEach(name => {
      const crossed = O.crossed.has(name);
      grid.appendChild(el('button', {
        class: 'om-loc' + (crossed ? ' crossed' : ''), text: name,
        onclick: () => {
          if (opts.guess) {
            if (!confirm(`Final answer: ${name}?`)) return;
            socket.emit('om_guess', { code: A.state.code, playerId: A.state.playerId, location: name });
            return;
          }
          if (crossed) O.crossed.delete(name); else O.crossed.add(name);
          A.render();
        }
      }));
    });
    return grid;
  }

  const PHASES = {};

  PHASES.reveal = (room, r, ctx) => {
    if (!A.state.myRole) return [note('Dealing locations…')];
    return [el('div', { class: 'card-reveal' }, [
      A.buildPeekCard(),
      el('p', { text: 'Everyone shares one location except the Weasel. Don’t say it out loud.' }),
      ctx.isHost ? hostBtn('Start Questions') : note('Waiting for the host to start.')
    ])];
  };

  PHASES.play = (room, r, ctx) => {
    const isSpy = A.state.myRole && A.state.myRole.spy;
    const out = [];
    const timer = remainingText(r);
    if (timer) out.push(el('div', { class: 'timer om-timer', id: 'om-timer', text: timer }));
    out.push(el('h2', { text: `${r.firstAskerName}${r.firstAskerId === ctx.me ? ' (you)' : ''} asks first.` }));
    out.push(el('p', { text: 'Ask one player a question about the location. Whoever answers asks next. Too vague and you look like the Weasel; too specific and the Weasel figures it out.' }));
    if (isSpy && O.guessMode) {
      out.push(el('div', { class: 'om-guess-banner', text: 'Tap the location you think it is. One shot.' }));
      out.push(locationGrid(r, { guess: true }));
      out.push(el('button', { class: 'ghost', text: 'Cancel', onclick: () => { O.guessMode = false; A.render(); } }));
    } else {
      out.push(questionCard());
      out.push(el('div', { class: 'label-sm', text: 'Possible locations (tap to cross off)' }));
      out.push(locationGrid(r, {}));
      if (isSpy) out.push(el('button', { class: 'danger', text: 'I know where we are — Guess', onclick: () => { O.guessMode = true; A.render(); } }));
    }
    out.push(el('div', { class: 'spacer' }));
    if (ctx.isHost) out.push(hostBtn('Call the Vote', isSpy && O.guessMode ? 'secondary' : 'primary'));
    return out;
  };

  PHASES.vote = (room, r, ctx) => {
    const voted = r.votedIds.includes(ctx.me);
    const grid = el('div', { class: 'vote-grid' });
    room.players.filter(p => p.id !== ctx.me).forEach(p => {
      grid.appendChild(el('div', {
        class: 'vote-option' + (O.vote === p.id ? ' selected' : ''),
        onclick: () => { O.vote = p.id; socket.emit('om_vote', { code: A.state.code, playerId: A.state.playerId, targetId: p.id }); A.render(); }
      }, [el('span', { text: p.name }), O.vote === p.id ? el('span', { class: 'count', text: 'Your vote' }) : null]));
    });
    return [
      el('h2', { text: 'Who is the Weasel?' }),
      el('p', { text: voted ? 'Vote cast. You can still change it until everyone has voted.' : 'Tap a player. A tie means the Weasel escapes.' }),
      grid,
      el('div', { class: 'progress-pill', text: `${r.votedIds.length}/${room.players.length} voted` }),
      el('div', { class: 'spacer' }),
      ctx.isHost ? hostBtn('Host: Tally Now', 'secondary') : null
    ];
  };

  PHASES.spy_guess = (room, r, ctx) => {
    const isSpy = A.state.myRole && A.state.myRole.spy;
    if (isSpy) return [
      el('h2', { text: 'You’ve been caught!' }),
      el('p', { text: 'Last chance: name the location to steal the win.' }),
      locationGrid(r, { guess: true })
    ];
    return [
      el('h2', { text: `${r.accusedName} was the Weasel!` }),
      el('p', { text: 'They get one guess at the location to steal the win. Hang tight.' })
    ];
  };

  const REASONS = {
    tie: 'The vote tied. The Weasel slipped away.',
    wrong_vote: (res) => `You voted out ${res.accusedName}, who wasn’t the Weasel.`,
    caught: (res) => `Weasel caught, and they guessed ${res.spyGuess}. Wrong.`,
    caught_but_guessed: 'Weasel caught, but they named the location and stole the win.',
    spy_called_it: 'The Weasel named the location before the vote.',
    spy_guessed_wrong: (res) => `The Weasel guessed ${res.spyGuess} and got it wrong.`,
    spy_left: 'The Weasel left the game.',
    no_crew: 'Not enough players left.'
  };

  PHASES.results = (room, r, ctx) => {
    const res = r.result;
    const reason = typeof REASONS[res.reason] === 'function' ? REASONS[res.reason](res) : REASONS[res.reason];
    const spyWon = res.winner === 'spy';
    const list = el('div', { class: 'role-reveal-list' });
    res.roles.forEach(p => list.appendChild(el('div', { class: 'role-reveal-row' }, [
      el('span', { text: p.name + (p.votes ? ` · ${p.votes} vote${p.votes === 1 ? '' : 's'}` : '') }),
      el('span', { class: 'tag ' + (p.id === res.spyId ? 'imposter' : 'civilian'), text: p.job })
    ])));
    return [
      el('div', { class: 'result-banner ' + (spyWon ? 'imp' : 'civ') }, [
        el('h2', { text: spyWon ? 'The Weasel wins' : 'Crew wins' }),
        el('p', { style: 'margin-bottom:0', text: reason })
      ]),
      svgBox(A.WEASEL_SVG || SPY_SVG, 'w-final-logo om-final-logo'),
      el('div', { class: 'om-answer' }, [
        el('div', { class: 'label-sm', text: 'The location was' }),
        el('div', { class: 'om-answer-loc', text: res.location }),
        el('div', { class: 'muted', text: `The Weasel: ${res.spyName}${res.spyId === ctx.me ? ' (you)' : ''}` })
      ]),
      list,
      el('div', { class: 'spacer' }),
      ctx.isHost
        ? el('button', { class: 'primary', text: 'Back to Lobby', onclick: () => socket.emit('play_again', { code: A.state.code, playerId: A.state.playerId }) })
        : note('Waiting for the host.')
    ];
  };

  A.VIEWS.offmap = function () {
    const room = A.state.room;
    const r = room && room.round;
    if (!r) return;
    const me = A.state.playerId;
    const ctx = { me, isHost: room.hostId === me };
    if (r.serverNow !== O.lastServerNow) { O.lastServerNow = r.serverNow; O.skew = r.serverNow - Date.now(); }
    if (r.phase !== O.key) {
      if (r.phase === 'reveal') O.crossed = new Set();
      if (r.phase === 'vote') O.vote = null;
      O.guessMode = false;
      O.key = r.phase;
    }
    const container = el('div', { class: 'screen' }, [A.brand(), ...(PHASES[r.phase] || (() => []))(room, r, ctx)]);
    A.root.appendChild(container);
    if (r.phase !== 'results' && r.phase !== 'reveal') A.appendPeekFab(container);
  };
})();
