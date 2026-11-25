// Werewolf — client. The app is the narrator.
(function () {
  const A = window.App;
  const { el, socket } = A;
  const W = A.state.ww = { me: null, pick: null, vote: null, key: '' };

  const emit = (ev, extra) => socket.emit(ev, Object.assign({ code: A.state.code, playerId: A.state.playerId }, extra || {}));
  const note = (text) => el('p', { class: 'center-note', text });
  const hostBtn = (text, cls) => el('button', { class: cls || 'primary', text, onclick: () => emit('ww_advance') });

  const ICONS = { wolf: '🐺', seer: '🔮', doctor: '🩺', villager: '🧑‍🌾' };
  const DESC = {
    wolf: 'Each night, pick someone to eliminate. Blend in during the day.',
    seer: 'Each night, check one player to learn if they\'re a Werewolf.',
    doctor: 'Each night, protect one player (yourself allowed, not the same person twice in a row).',
    villager: 'Find the Werewolves and vote them out during the day.'
  };

  socket.on('ww_you', (me) => {
    W.me = me;
    A.state.myRole = { game: 'werewolf', role: me.role, roleName: me.roleName, wolves: me.wolves };
    if (A.state.view === 'werewolf') A.render();
  });

  A.buildWerewolfCard = function (role) {
    const card = el('div', { class: 'card' });
    const hint = el('div', { class: 'hint', text: 'Press and hold to peek' });
    card.appendChild(el('div', { class: 'lamp' }));
    card.appendChild(hint);
    card.appendChild(el('div', { class: 'content blank' }, [el('div', { class: 'role-word', text: '?' })]));
    card.appendChild(el('div', { class: 'content secret' }, [
      el('div', { class: 'ww-icon', text: ICONS[role.role] || '?' }),
      el('div', { class: 'role-label' + (role.role === 'wolf' ? ' weasel' : ' crew'), text: 'YOU ARE THE ' + String(role.roleName || '').toUpperCase() }),
      el('div', { class: 'category-tag', text: DESC[role.role] || '' }),
      el('div', { class: 'category-tag', text: role.role === 'wolf' && role.wolves && role.wolves.length ? 'Your pack: ' + role.wolves.join(', ') : ' ' })
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

  function playerList(r) {
    const box = el('div', { class: 'ww-players' });
    r.players.forEach(p => box.appendChild(el('span', { class: 'ww-p' + (p.alive ? '' : ' dead'), text: (p.alive ? '' : '💀 ') + p.name })));
    return box;
  }

  const PHASES = {};

  PHASES.reveal = (room, r, ctx) => {
    if (!W.me) return [note('Dealing roles…')];
    return [el('div', { class: 'card-reveal' }, [
      A.buildPeekCard(),
      el('p', { text: 'Check your role and keep it secret. When everyone is ready, night falls.' }),
      ctx.isHost ? hostBtn('Night falls…') : note('Waiting for the host.')
    ])];
  };

  PHASES.night = (room, r, ctx) => {
    const me = W.me;
    const out = [el('div', { class: 'ww-banner night' }, [el('div', { class: 'big', text: '🌙 Night ' + (r.dayNum + 1) }), el('div', { text: 'Everyone taps something. Shield your screen.' })])];
    if (!me) return out;
    if (!me.alive) { out.push(el('h2', { text: 'You\'re dead.' }), note('Watch quietly.')); }
    else if (me.nightDone && me.role !== 'wolf') {
      if (me.role === 'seer' && me.seerResults.length) {
        const last = me.seerResults[me.seerResults.length - 1];
        out.push(el('div', { class: 'ww-seer ' + (last.isWolf ? 'wolf' : 'safe') }, [el('div', { text: `${last.name} is…` }), el('div', { class: 'big', text: last.isWolf ? 'A WEREWOLF 🐺' : 'Not a werewolf' })]));
      } else out.push(el('h2', { text: 'Done. Waiting for the night to end…' }));
    } else {
      const prompts = {
        wolf: 'Who do you eliminate tonight?',
        seer: 'Whose role do you want to check?',
        doctor: 'Who do you protect tonight?',
        villager: 'Who do you suspect? (Keeps everyone tapping. Top suspect is announced at dawn.)'
      };
      out.push(el('h2', { text: prompts[me.role] }));
      if (me.role === 'wolf' && me.packSize > 1) {
        const picked = me.wolfVotes.filter(v => v.target);
        let status, cls;
        if (me.packAgreed) { status = `✓ Pack agrees: ${me.wolfVotes[0].target}. Waiting for the rest of the village…`; cls = 'ok'; }
        else if (picked.length < me.packSize) { status = `Your pack must all pick the same person. ${picked.length}/${me.packSize} wolves have picked.`; cls = 'wait'; }
        else { status = 'Your pack disagrees! Change picks until you all match.'; cls = 'bad'; }
        out.push(el('div', { class: 'ww-pack ' + cls }, [
          el('div', { class: 'ww-pack-status', text: status }),
          ...me.wolfVotes.map(v => el('div', { class: 'ww-pack-row', text: `🐺 ${v.wolf}: ${v.target || '…'}` }))
        ]));
      }
      const grid = el('div', { class: 'vote-grid' });
      r.players.filter(p => p.alive).forEach(p => {
        let disabled = false;
        if (me.role !== 'doctor' && p.id === ctx.me) disabled = true;
        if (me.role === 'wolf' && (me.wolves.includes(p.name) || p.id === ctx.me)) disabled = true;
        if (me.role === 'doctor' && p.id === me.lastProtectedId) disabled = true;
        const opt = el('div', {
          class: 'vote-option' + (W.pick === p.id ? ' selected' : '') + (disabled ? ' au-dead' : ''),
          onclick: () => { if (disabled) return; W.pick = p.id; A.render(); }
        }, [
          el('span', { text: p.name + (p.id === ctx.me ? ' (you)' : '') }),
          disabled && me.role === 'doctor' ? el('span', { class: 'count', text: 'protected last night' }) : null,
          me.role === 'wolf' && me.packSize > 1 ? el('span', { class: 'count', text: me.wolfVotes.filter(v => v.targetId === p.id).map(v => '🐺 ' + v.wolf).join(' ') }) : null
        ]);
        grid.appendChild(opt);
      });
      out.push(grid);
      const myPick = me.nightPick;
      const b = el('button', { class: 'primary', text: me.role === 'wolf' && myPick ? (W.pick === myPick ? 'Your pick is in' : 'Change my pick') : 'Confirm', onclick: () => emit('ww_night', { target: W.pick }) });
      if (!W.pick || (me.role === 'wolf' && W.pick === myPick)) b.disabled = true;
      out.push(b);
    }
    out.push(el('div', { class: 'progress-pill', text: `${r.nightDoneCount}/${r.aliveCount} done` }));
    out.push(el('div', { class: 'spacer' }));
    if (ctx.isHost) out.push(hostBtn('Host: End night now', 'secondary'));
    return out;
  };

  PHASES.dawn = (room, r, ctx) => {
    const d = r.dawn;
    const out = [el('div', { class: 'ww-banner day' }, [el('div', { class: 'big', text: '☀️ Day ' + r.dayNum })])];
    if (d.victimName) out.push(el('div', { class: 'ww-death' }, [el('div', { class: 'big', text: `${d.victimName} was killed.` }), el('div', { text: 'Their role stays secret until the end.' })]));
    else if (d.saved) out.push(el('div', { class: 'ww-death saved' }, [el('div', { class: 'big', text: 'Nobody died!' }), el('div', { text: 'The Doctor saved someone last night.' })]));
    else out.push(el('div', { class: 'ww-death saved' }, [el('div', { class: 'big', text: 'A quiet night.' }), el('div', { text: 'Nobody was attacked.' })]));
    if (d.suspect) out.push(note(`The village was most suspicious of ${d.suspect} last night.`));
    out.push(playerList(r));
    out.push(el('div', { class: 'spacer' }));
    out.push(ctx.isHost ? hostBtn('Start discussion & vote') : note('Waiting for the host.'));
    return out;
  };

  PHASES.day = (room, r, ctx) => {
    const me = W.me || {};
    const voted = r.votedIds.includes(ctx.me);
    const out = [el('h2', { text: `Day ${r.dayNum}: who's a Werewolf?` }), el('p', { text: 'Discuss, then vote. Most votes is out. Tie or skip = nobody.' })];
    if (!me.alive) out.push(note('You\'re dead — no vote, no talking.'));
    const grid = el('div', { class: 'vote-grid' });
    r.players.forEach(p => {
      const canPick = me.alive && p.alive && p.id !== ctx.me;
      grid.appendChild(el('div', {
        class: 'vote-option' + (p.alive ? '' : ' au-dead') + (W.vote === p.id ? ' selected' : ''),
        onclick: () => { if (!canPick) return; W.vote = p.id; emit('ww_vote', { target: p.id }); A.render(); }
      }, [el('span', { text: (p.alive ? '' : '💀 ') + p.name + (p.id === ctx.me ? ' (you)' : '') }), el('span', { class: 'count', text: p.alive ? (r.votedIds.includes(p.id) ? 'voted ✓' : '') : 'dead' })]));
    });
    out.push(grid);
    if (me.alive) out.push(el('button', { class: 'secondary' + (W.vote === 'skip' ? ' on' : ''), text: W.vote === 'skip' ? 'Skipping ✓' : 'Skip vote', onclick: () => { W.vote = 'skip'; emit('ww_vote', { target: 'skip' }); A.render(); } }));
    out.push(el('div', { class: 'progress-pill', text: `${r.votedIds.length}/${r.aliveCount} voted${voted ? ' · you can change until everyone votes' : ''}` }));
    out.push(el('div', { class: 'spacer' }));
    if (ctx.isHost) out.push(hostBtn('Host: End voting now', 'secondary'));
    return out;
  };

  PHASES.lynch = (room, r, ctx) => {
    const l = r.lynch;
    const out = [];
    if (l.id) out.push(el('div', { class: 'ww-death' }, [el('div', { class: 'big', text: `${l.name} was voted out.` }), el('div', { text: 'Were they a Werewolf? You\'ll find out at the end.' })]));
    else out.push(el('div', { class: 'ww-death saved' }, [el('div', { class: 'big', text: 'Nobody was voted out.' }), el('div', { text: l.reason === 'tie' ? 'The vote was tied.' : 'The village skipped.' })]));
    if (l.counts.length) {
      const list = el('div', { class: 'role-reveal-list' });
      l.counts.forEach(c => list.appendChild(el('div', { class: 'role-reveal-row' }, [el('span', { text: c.name }), el('span', { class: 'tag civilian', text: `${c.n} vote${c.n === 1 ? '' : 's'}` })])));
      out.push(list);
    }
    out.push(el('div', { class: 'spacer' }));
    out.push(ctx.isHost ? hostBtn('Night falls…') : note('Waiting for the host.'));
    return out;
  };

  PHASES.results = (room, r, ctx) => {
    const wolves = r.result.winner === 'wolves';
    const out = [el('div', { class: 'result-banner ' + (wolves ? 'imp' : 'civ') }, [
      el('h2', { text: wolves ? '🐺 The Werewolves win' : '🧑‍🌾 The Village wins' }),
      el('p', { style: 'margin-bottom:0', text: wolves ? 'The wolves now equal the village.' : 'Every Werewolf has been found.' })
    ])];
    if (r.dawn && r.dawn.victimName) out.push(note(`Last night: ${r.dawn.victimName} was killed.`));
    if (r.lynch && r.lynch.id) out.push(note(`Voted out: ${r.lynch.name}.`));
    const list = el('div', { class: 'role-reveal-list' });
    r.players.forEach(p => list.appendChild(el('div', { class: 'role-reveal-row' }, [
      el('span', { text: (p.alive ? '' : '💀 ') + p.name }),
      el('span', { class: 'tag ' + (p.role === 'Werewolf' ? 'imposter' : 'civilian'), text: p.role })
    ])));
    out.push(list, el('div', { class: 'spacer' }));
    out.push(ctx.isHost ? el('button', { class: 'primary', text: 'Back to Lobby', onclick: () => emit('play_again') }) : note('Waiting for the host.'));
    return out;
  };

  A.VIEWS.werewolf = function () {
    const room = A.state.room;
    const r = room && room.round;
    if (!r) return;
    const me = A.state.playerId;
    const ctx = { me, isHost: room.hostId === me };
    const key = r.phase + ':' + r.dayNum;
    if (key !== W.key) { W.key = key; W.pick = null; W.vote = null; }
    if (W.me && W.me.nightPick && !W.pick) W.pick = W.me.nightPick;
    const container = el('div', { class: 'screen' + (r.phase === 'night' ? ' ww-night' : '') }, [A.brand(), ...(PHASES[r.phase] || (() => []))(room, r, ctx)]);
    A.root.appendChild(container);
    if (['night', 'dawn', 'day', 'lynch'].includes(r.phase)) A.appendPeekFab(container);
  };
})();
