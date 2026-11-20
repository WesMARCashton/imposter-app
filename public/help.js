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
    werewolf: {
      name: 'Werewolf',
      players: '5+ players \u00b7 the app is the narrator',
      goal: 'Village: find and vote out every Werewolf. Werewolves: eliminate villagers until you equal them.',
      sections: [
        ['Roles', [
          '\ud83d\udc3a Werewolves (1\u20133): pick someone to eliminate each night. They know each other.',
          '\ud83d\udd2e Seer: each night, check one player to learn if they\u2019re a Werewolf.',
          '\ud83e\ude7a Doctor: each night, protect one player (yourself allowed, not the same person twice in a row).',
          '\ud83e\uddd1\u200d\ud83c\udf3e Villagers: no power \u2014 just your wits.'
        ]],
        ['Night', [
          'Everyone taps something on their phone, so nobody can tell who has a power. Villagers mark who they suspect.',
          'Werewolves see each other\u2019s picks. If they split, the app picks one of their top choices.',
          'The night ends when everyone has tapped (or the host ends it).'
        ]],
        ['Day', [
          'Dawn reveals who died and their role, or that the Doctor saved someone. The village\u2019s top suspect is announced too.',
          'Discuss, then vote. Most votes is out and their role is revealed. Tie or skip = nobody.',
          'Dead players stay quiet.'
        ]],
        ['Winning', [
          'Village wins when every Werewolf is gone.',
          'Werewolves win when they equal the number of villagers.'
        ]]
      ]
    },
    calledshot: {
      name: 'Called Shot',
      players: '2+ players \u00b7 on the shuffleboard machine',
      goal: 'Score the most points by hitting your called shots and reading everyone else.',
      sections: [
        ['Each turn', [
          'The shooter secretly calls a spot on their phone (Bocce, Bullseye, Shuffleboard or ShuffleAlley spots).',
          'Everyone else bets: will they HIT or MISS? They don\u2019t know what was called.',
          'The shooter throws, then honestly taps "I hit it" or "I missed". The call is revealed to everyone.'
        ]],
        ['Scoring', [
          'Shooter: +2 for a hit, plus +1 for every person who bet wrong.',
          'Bettors: +1 for a correct bet.',
          'Call easy spots and people bet HIT. Call hard ones and they bet MISS. Mind games!'
        ]],
        ['End', [
          'Everyone shoots the number of times the host set. Highest score wins.'
        ]]
      ]
    },
    target: {
      name: 'Hit the Number',
      players: '3+ players \u00b7 played on the shuffleboard machine (Bocce, Bullseye, Shuffleboard, ShuffleAlley)',
      goal: 'Crew: aim for the secret target and spot the Imposter. Imposter: blend in without knowing the target.',
      sections: [
        ['Setup', [
          'The host picks which game you\u2019re playing. The secret target is one of that game\u2019s scoring spots (0 is always possible): Bocce 0\u201350, Bullseye Front/Back 1\u20133 + dartboard, Shuffleboard 10 / 8 L-R / 7 L-R / \u221210, ShuffleAlley 0\u20133.',
          'Everyone gets the same secret target, except the Imposter, who gets nothing.',
          'Press and hold your card to see it. Don\u2019t say your target out loud.'
        ]],
        ['Play', [
          'Play the real game. Aim for your target.',
          'The Imposter has to guess what everyone is aiming for and act natural.',
          'Watch for anyone who seems to be playing for a different score.'
        ]],
        ['Vote', [
          'When the game ends, the host opens the vote. Everyone votes for who they think was the Imposter.',
          'Wrong person or a tie = Imposter wins.',
          'If the Imposter is caught, they pick one guess from the list of targets. Right = they steal the win.'
        ]]
      ]
    },
    clue: {
      name: 'Clue',
      players: '3\u20136 players \u00b7 about 15\u201325 min',
      goal: 'Be the first to work out who did it, with what, and where.',
      sections: [
        ['Setup', [
          'The app secretly picks one suspect, one weapon and one room. That\u2019s the answer.',
          'All the other cards are dealt to the players. Your cards are NOT the answer \u2014 use them to rule things out.',
          'Your Detective notes cross off your own cards automatically.'
        ]],
        ['Your turn', [
          'Pick a room to search (not the same one as your last turn), then name a suspect and a weapon.',
          'The app checks the next players in order. The first one holding any of those cards must show you one \u2014 only you see which.',
          'Everyone else just sees who showed you a card. Cards shown to you are crossed off in your notes automatically.',
          'If nobody can disprove it, those cards are either in your own hand or the answer.'
        ]],
        ['Winning', [
          'When you think you know, tap Final accusation on your turn (before or after suggesting).',
          'Right = you win. Wrong = you\u2019re out, but you still have to show cards when asked.',
          'If everyone else is out, the last detective standing wins.'
        ]],
        ['Tips', [
          'Read the Case log: if someone couldn\u2019t disprove a suggestion, they hold none of those cards.',
          'Suggest cards from your own hand to trick other players.',
          'Tap cards in your notes to mark \u2717 (ruled out) or ? (suspicious).'
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
