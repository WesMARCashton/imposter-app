# Office Shenanigans

Office party games (Undercover, The Weasel, Clue, Werewolf, Hit the Number, Called Shot).

## Stack
- Node/Express + Socket.io (realtime rooms, in-memory state)
- Vanilla JS/CSS frontend, installable PWA
- No database — rooms live in server memory, cleared on restart

## Features
- Host/Join with 5-letter room codes
- Settings: imposter count, Mr. White toggle, word difficulty, discuss timer
- Press-and-hold reveal card
- Speaking order, discussion timer, voting, results
- Mr. White steal-the-win guess
- Reconnect on disconnect (phone lock / dropped wifi) via localStorage session


## The Weasel
Internal id is `offmap` (files, settings, socket events).
Everyone gets the same secret location and a job there, except the Weasel (min 3 players).
Players take turns asking each other questions. Each round shows 20 possible locations (random from 60, always including the real one); players can cross them off. Question card on each phone (385 questions, no repeats until the deck is used up, Previous/Skip).
- The Weasel can guess the location at any time: right = Weasel wins, wrong = crew wins.
- Host calls the vote (or the timer runs out); host can undo and resume with the remaining time. Plurality on the Weasel = caught, then the Weasel gets one last guess to steal the win. Wrong person or a tie = Weasel wins.
Host setting: round timer (off / 5 / 8 / 10 / 15 min). Weasel pick is random but weighted down for anyone who was the Weasel in the last 4 games (streak breaker). Locations and jobs live in `server/offmap-content.js`.

## Dev
npm install
npm start
Open http://localhost:3000 on your phone (same wifi) or localhost on desktop.

## Deploy
1. Push this repo to GitHub.
2. In Railway: New Project → Deploy from GitHub repo.
3. Railway auto-detects Node via railway.json. No env vars needed.
4. Open the Railway URL on your phone, tap Share → Add to Home Screen.

## Known limits (v1)
- Single elimination per round only (no multi-round survival within one game — "Play Again" starts fresh)
- No persistent stats/history
- Word library is fixed in server/words.js — add more pairs there anytime
