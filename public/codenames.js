// Codenames — client.
(function () {
  const A = window.App;
  const { el, socket } = A;
  const C = A.state.cn = { me: { team: null, spymaster: false, key: null }, num: 1, err: '', word: '' };
  const emit = (ev, extra, cb) => socket.emit(ev, Object.assign({ code: A.state.code, playerId: A.state.playerId }, extra || {}), cb);
  const note = (text) => el('p', { class: 'center-note', text });
  const TEAM = { red: 'Red', blue: 'Blue' };

  socket.on('cn_you', (me) => { C.me = me; if (A.state.view === 'codenames') A.render(); });

  function teamsView(r, ctx, editable) {
    const box = el('div', { class: 'cn-teams' });
    ['red', 'blue'].forEach(t => box.appendChild(el('div', { class: 'cn-team ' + t }, [
      el('div', { class: 'cn-team-name', text: `${TEAM[t]} team${r.phase !== 'setup' ? ` · ${r.left[t]} left` : ''}` }),
      ...r.teams[t].map(p => el('div', { class: 'cn-member', text: (p.spymaster ? '🕵️ ' : '') + p.name + (p.id === ctx.me ? ' (you)' : '') }))
    ])));
    return box;
  }

  function grid(r, ctx, canGuess) {
    const key = C.me.key;
    const g = el('div', { class: 'cn-grid' });
    r.words.forEach((w, i) => {
      const rev = r.revealed[i];
      const k = key ? key[i] : null;
      const cls = 'cn-card' + (w.length >= 9 ? ' xlong' : w.length >= 7 ? ' long' : '') + (rev ? ' rev ' + rev : '') + (!rev && k ? ' key-' + k : '') + (canGuess && !rev ? ' tap' : '');
      g.appendChild(el('button', {
        class: cls, text: w,
        onclick: () => { if (!canGuess || rev) return; if (confirm(`Guess "${w}"?`)) emit('cn_guess', { idx: i }); }
      }));
    });
    return g;
  }

  function logView(r) {
    if (!r.log.length) return null;
    const box = el('div', { class: 'clue-log' }, [el('div', { class: 'label-sm', text: 'Clues' })]);
    r.log.forEach(e => box.appendChild(el('div', { class: 'clue-log-row' }, [
      el('span', { class: 'cn-dot ' + e.team }), el('b', { text: ` ${e.clue}` }),
      el('span', { text: e.guesses.length ? ' → ' + e.guesses.map(x => x.word + (x.color === e.team ? ' ✓' : x.color === 'assassin' ? ' ☠' : ' ✗')).join(', ') : '' })
    ])));
    return box;
  }

  const PHASES = {};

  PHASES.setup = (room, r, ctx) => {
    const out = [
      el('h2', { text: 'Pick teams' }),
      el('p', { text: 'Each team needs 2+ players. 🕵️ = Spymaster (sees the secret key and gives clues).' }),
      teamsView(r, ctx, true),
      el('div', { class: 'cs-bets' }, [
        el('button', { class: 'secondary', text: 'Switch my team', onclick: () => emit('cn_switch') }),
        el('button', { class: 'secondary', text: '🕵️ Be Spymaster', onclick: () => emit('cn_spymaster') })
      ])
    ];
    if (ctx.isHost) {
      out.push(el('button', { class: 'ghost', text: 'Shuffle teams', onclick: () => emit('cn_shuffle') }));
      const b = el('button', { class: 'primary', text: 'Start Codenames', onclick: () => emit('cn_begin') });
      if (r.teams.red.length < 2 || r.teams.blue.length < 2) b.disabled = true;
      out.push(b);
    } else out.push(note('Waiting for the host to start.'));
    return out;
  };

  function header(r) {
    return el('div', { class: 'cn-head' }, [
      el('span', { class: 'cn-score red', text: `Red ${r.left.red}` }),
      el('span', { class: 'cn-turn ' + r.turn, text: `${TEAM[r.turn]}'s turn` }),
      el('span', { class: 'cn-score blue', text: `Blue ${r.left.blue}` })
    ]);
  }

  PHASES.clue = (room, r, ctx) => {
    const me = C.me;
    const myTurnSpy = me.spymaster && me.team === r.turn;
    const out = [header(r)];
    if (myTurnSpy) {
      const input = el('input', { type: 'text', id: 'cn-word', placeholder: 'One word', autocomplete: 'off', autocapitalize: 'characters' });
      input.value = C.word;
      input.addEventListener('input', () => { C.word = input.value; });
      out.push(el('div', { class: 'cn-cluebox' }, [
        el('div', { class: 'label-sm', text: 'Your clue: one word + how many cards it links' }),
        input,
        el('div', { class: 'cn-nums' }, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => el('button', { class: 'cn-num' + (C.num === n ? ' on' : ''), text: String(n), onclick: () => { C.num = n; A.render(); } }))),
        el('button', { class: 'primary', text: 'Give clue', onclick: () => {
          emit('cn_clue', { word: C.word, number: C.num }, (res) => { C.err = res && res.error ? res.error : ''; if (!C.err) { C.word = ''; C.num = 1; } A.render(); });
        } }),
        C.err ? el('div', { class: 'error-text', text: C.err }) : null
      ]));
    } else {
      out.push(el('h2', { class: 'cn-wait', text: `${TEAM[r.turn]} Spymaster is thinking…` }));
    }
    out.push(grid(r, ctx, false));
    if (me.spymaster) out.push(note('You see the key: tinted = your team / other team, grey = bystander, black = assassin.'));
    out.push(teamsView(r, ctx), logView(r));
    return out;
  };

  PHASES.guess = (room, r, ctx) => {
    const me = C.me;
    const canGuess = me.team === r.turn && !me.spymaster;
    const out = [header(r), el('div', { class: 'cn-clue ' + r.turn }, [
      el('div', { class: 'big', text: `${r.clue.word} · ${r.clue.number}` }),
      el('div', { text: r.guessesLeft == null ? 'Unlimited guesses' : `${r.guessesLeft} guess${r.guessesLeft === 1 ? '' : 'es'} left` })
    ])];
    out.push(el('p', { class: 'center-note', text: canGuess ? 'Talk it over, then tap a word.' : (me.team === r.turn ? 'Spymaster: no hints! Poker face.' : `${TEAM[r.turn]} team is guessing.`) }));
    out.push(grid(r, ctx, canGuess));
    if (canGuess) out.push(el('button', { class: 'secondary', text: 'End our turn', onclick: () => { if (confirm('End your turn?')) emit('cn_pass'); } }));
    out.push(teamsView(r, ctx), logView(r));
    return out;
  };

  PHASES.results = (room, r, ctx) => {
    const res = r.result;
    const out = [el('div', { class: 'result-banner ' + (res.winner === 'red' ? 'imp' : 'civ') + ' cn-win ' + res.winner }, [
      el('h2', { text: `${TEAM[res.winner]} team wins!` }),
      el('p', { style: 'margin-bottom:0', text: res.reason === 'assassin' ? 'The other team hit the assassin ☠' : res.reason === 'forfeit' ? 'The other team ran out of players.' : 'All their agents found.' })
    ]), grid(r, ctx, false), teamsView(r, ctx), logView(r), el('div', { class: 'spacer' })];
    out.push(ctx.isHost ? el('button', { class: 'primary', text: 'Back to Lobby', onclick: () => emit('play_again') }) : note('Waiting for the host.'));
    return out;
  };

  A.VIEWS.codenames = function () {
    const room = A.state.room; const r = room && room.round; if (!r) return;
    const ctx = { me: A.state.playerId, isHost: room.hostId === A.state.playerId };
    if (r.phase !== 'clue') C.err = '';
    A.root.appendChild(el('div', { class: 'screen' }, [A.brand(), ...(PHASES[r.phase] || (() => []))(room, r, ctx)]));
  };
})();
