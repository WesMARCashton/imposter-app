// How-to-play instructions for every game. Opens as an overlay on top of the app.
(function () {
  const A = window.App;
  const { el } = A;

  const HELP = {
    undercover: {
      name: 'Undercover',
      players: '3+ players',
      goal: 'Find the imposter(s) hiding among you.',
      sections: [
        ['Setup', [
          'Most players are Civilians and get the same secret word.',
          'Imposters get a different but related word (e.g. Coffee vs. Tea). They don’t know they’re the imposter.',
          'Optional Mr. White gets no word at all and has to bluff.'
        ]],
        ['How to play', [
          'Press and hold your card to see your word. Don’t show anyone.',
          'Go around in the speaking order shown. Each player says ONE word or short clue about their word.',
          'Be vague enough that imposters can’t guess your word, but clear enough that civilians trust you.',
          'Discuss, then everyone votes on who they think is an imposter.'
        ]],
        ['Winning', [
          'Civilians win if the vote eliminates the imposter.',
          'Imposters win if the vote misses or ties.',
          'If Mr. White is voted out, he gets one guess at the civilians’ word. Right guess = Mr. White wins.'
        ]],
        ['Tips', [
          'Tap "My Word" anytime to check your word again.',
          'If your word seems slightly off from everyone else’s clues, you might be the imposter.'
        ]]
      ]
    },
    weasel: {
      name: 'Inside Job',
      players: '4+ players',
      goal: 'Crew: grow the pot and figure out who the Spy is. Spy: drain the pot without getting caught.',
      sections: [
        ['Setup', [
          'One random player is the secret Spy. Everyone else is Crew.',
          'Press and hold your card to see your role.'
        ]],
        ['Each round', [
          'Mission: everyone plays a quick phone challenge. Success adds money to the pot. The Spy quietly sabotages.',
          '• Brain Trust: trivia. $1,000 per correct answer.',
          '• Mind Meld: no talking. Pick what you think the group will pick.',
          '• Ballpark: guess a number. The group average has to be close.',
          '• The Vault: a random team secretly picks Crack or Jam. One jam = no money.',
          'Quiz: 5 questions about the Spy, e.g. who it is, what they answered in missions, clues about their name.',
          'Elimination (if on): lowest Crew quiz score is out. Ties go to the slower finisher. Everyone checks their own phone: green = safe, red = out.'
        ]],
        ['Winning', [
          'Final round: the Crew member with the best quiz score wins the pot.',
          'Then the Spy is unmasked, along with how much money they cost the team.'
        ]],
        ['Tips', [
          'Watch who gets missions wrong, and who was on the Vault team when it jammed.',
          'Spy: don’t sabotage every mission. Being too obvious gets you caught.'
        ]]
      ]
    },
    offmap: {
      name: 'The Weasel',
      players: '3+ players',
      goal: 'Crew: find the Weasel. Weasel: figure out where everyone is.',
      sections: [
        ['Setup', [
          'Everyone gets the same secret location (e.g. Casino) and a job there (e.g. Dealer).',
          'One player is the Weasel. They don’t know the location.',
          'Press and hold your card to see your location and job.'
        ]],
        ['How to play', [
          'The app picks who asks first. Ask any player one question about the location.',
          'Whoever answers asks the next question. You can’t ask back the person who just asked you.',
          'Stuck? Use the question card on your screen. Skip deals a new one; Previous goes back.',
          'Everyone sees 20 possible locations (a random mix from 60, always including the real one). Tap to cross off ones you’ve ruled out.',
          'Answers that are too vague make you look like the Weasel. Answers that are too specific give the location away.'
        ]],
        ['Ending the round', [
          'The Weasel can tap "I know where we are" at any time and guess. Right = Weasel wins. Wrong = Crew wins.',
          'Anyone can quietly tap "Ask for a vote". When a majority of players ask, voting opens (nobody sees who asked).',
          'The host calls the vote, or it opens when the timer runs out. Everyone votes on who the Weasel is. Host hit it by mistake? "Back to questions" resumes the round.',
          'If the Weasel gets the most votes, they get one last guess at the location to steal the win.',
          'Wrong person voted out, or a tie = Weasel wins.'
        ]]
      ]
    },
    amongus: {
      name: 'Among Us',
      players: '4–8 players',
      goal: 'Crewmates: finish your tasks or vote out every Impostor. Impostors: take out the crew without getting caught.',
      sections: [
        ['Setup', [
          'Everyone is a Crewmate except 1–2 secret Impostors (the host picks how many).',
          'Press and hold your card to see your role. Impostors can see who the other Impostors are.',
          'Everyone starts in the Cafeteria.'
        ]],
        ['Moving & tasks', [
          'Your phone shows the ship map. Tap a room next to yours to walk there.',
          'You can only see who is in the same room as you.',
          'Crewmates have a task list. Go to the room shown and tap the task to play a quick mini-game.',
          'Every finished task fills the shared task bar. If the bar hits 100%, the Crew wins.',
          'Impostors get a fake task list so they can pretend. Their tasks don’t count.'
        ]],
        ['Kills, bodies & meetings', [
          'Impostors can kill a Crewmate who is in the same room. Then they wait for a cooldown.',
          'If you’re killed, your phone tells you. Stay quiet! Ghosts can still do tasks.',
          'Anyone who walks into a room with a body can tap Report. Each player also has one Emergency Meeting button.',
          'A meeting freezes every phone. Talk it out across the table, then vote someone out or skip.'
        ]],
        ['Sabotage (Impostors)', [
          'Lights: nobody can see who is in their room until someone fixes it in Electrical.',
          'Reactor: two players must stand in the Reactor room before the countdown ends, or Impostors win.'
        ]],
        ['Winning', [
          'Crew wins if all tasks are done or every Impostor is voted out.',
          'Impostors win when they equal the number of living Crewmates, or a Reactor meltdown isn’t fixed in time.'
        ]]
      ]
    }
  };

  function close() {
    const o = document.getElementById('help-overlay');
    if (o) o.remove();
  }

  // games: list of game ids to show as tabs; first one is selected
  A.showHelp = function (games, selected) {
    close();
    const ids = (games || Object.keys(HELP)).filter(g => HELP[g]);
    let current = selected && HELP[selected] ? selected : ids[0];
    const overlay = el('div', { class: 'help-overlay', id: 'help-overlay', onclick: (e) => { if (e.target === overlay) close(); } });
    const sheet = el('div', { class: 'help-sheet' });
    overlay.appendChild(sheet);

    function draw() {
      sheet.innerHTML = '';
      const h = HELP[current];
      const head = el('div', { class: 'help-head' }, [
        el('div', {}, [el('div', { class: 'help-kicker', text: 'How to play' }), el('h2', { text: h.name })]),
        el('button', { class: 'leave-btn', text: 'Close', onclick: close })
      ]);
      sheet.appendChild(head);
      if (ids.length > 1) {
        const tabs = el('div', { class: 'diff-tabs help-tabs' });
        ids.forEach(g => tabs.appendChild(el('button', { class: g === current ? 'active' : '', text: HELP[g].name, onclick: () => { current = g; draw(); sheet.scrollTop = 0; } })));
        sheet.appendChild(tabs);
      }
      sheet.appendChild(el('div', { class: 'help-meta', text: h.players }));
      sheet.appendChild(el('p', { class: 'help-goal', text: h.goal }));
      h.sections.forEach(([title, items]) => {
        sheet.appendChild(el('div', { class: 'help-section-title', text: title }));
        const ul = el('ul', { class: 'help-list' });
        items.forEach(t => ul.appendChild(el('li', { class: t.startsWith('•') ? 'sub' : '', text: t.replace(/^•\s*/, '') })));
        sheet.appendChild(ul);
      });
      sheet.appendChild(el('button', { class: 'primary', text: 'Got it', onclick: close }));
    }
    draw();
    document.body.appendChild(overlay);
  };

  A.HELP_GAMES = Object.keys(HELP);
})();
