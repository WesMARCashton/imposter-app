# Undercover

Local multiplayer social deduction word game. Everyone plays from their own phone, in the same room.

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
