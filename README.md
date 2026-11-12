# Undercover + The Weasel

Two local multiplayer social deduction games. Host picks the game in the lobby. Everyone plays from their own phone, in the same room.

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
One secret Weasel (min 4 players). Each round:
1. **Mission** on everyone's phone — Brain Trust (trivia), Mind Meld (match the group), Ballpark (number guess), The Vault (random team picks Crack/Jam). Success grows the pot; the Weasel quietly sabotages.
2. **Quiz** — 5 questions about the Weasel (who is it, what did they answer in past missions, name/join-order clues). Questions are auto-built from what the Weasel actually did.
3. **Elimination** (toggle) — lowest crew score is out, ties go to the slower finisher. Phones show Safe / You're out.
Final round: top quiz score wins the pot, then the Weasel is unmasked.
Host settings: missions (2–8), eliminations on/off. Content lives in `server/weasel-content.js`.

Code layout: `server/games/weasel.js` (game logic), `public/weasel.js` (screens). Undercover logic is unchanged in `server/index.js` / `public/app.js`.

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
