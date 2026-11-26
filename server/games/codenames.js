// Codenames — two teams. Each team has a Spymaster who sees the secret key and gives
// one-word clues; teammates tap words. First team to find all their agents wins.
// Hit the Assassin and your team loses instantly.

const { shuffle } = require('../util');

const MIN_PLAYERS = 4;

const WORDS = ('Apple Arm Bank Bark Bat Bear Bed Bell Belt Berry Bird Board Boat Bolt Bomb Bond Book Boot Bottle Bow Box Bridge Brush Bug Button ' +
  'Cake Calf Camp Canada Cap Capital Car Card Carrot Castle Cat Cell Chair Change Check Chest Chicken China Chip Chocolate Church Circle Cliff Cloak Clock Cloud Club Code Cold Comic Compound Concert Contract Cook Copper Cotton Court Cover Crane Crash Cricket Cross Crown Cycle ' +
  'Dance Date Day Deck Degree Diamond Dice Dinosaur Doctor Dog Draft Dragon Dress Drill Drop Duck Dwarf ' +
  'Eagle Egg Engine Europe Eye Face Fair Fall Fan Fence Field Fighter Figure File Film Fire Fish Flute Fly Foot Force Forest Fork France ' +
  'Game Gas Ghost Giant Glass Glove Gold Grace Grass Green Ground Guitar Hand Hawk Head Heart Helicopter Hole Hollywood Honey Hood Hook Horn Horse Hospital Hotel ' +
  'Ice Iron Jack Jam Jet Jupiter Kangaroo Ketchup Key Kid King Kiwi Knife Knight Lab Lap Laser Lawyer Lead Lemon Light Limousine Line Link Lion Litter Lock Log London Luck ' +
  'Mail Mammoth Maple Marble March Mass Match Mercury Mexico Microscope Milk Mine Mint Missile Model Mole Moon Mount Mouse Mouth Mug ' +
  'Nail Needle Net Night Ninja Note Novel Nurse Nut Octopus Oil Olive Opera Orange Organ Pan Pants Paper Parachute Park Part Pass Paste Penguin Phoenix Piano Pie Pilot Pin Pipe Pirate Pistol Pit Pitch Plane Plastic Plate Platypus Play Plot Point Poison Pole Police Pool Port Post Pound Press Princess Pumpkin Pupil Pyramid ' +
  'Queen Rabbit Racket Ray Revolution Ring Robin Robot Rock Rome Root Rose Roulette Round Row Ruler ' +
  'Satellite Saturn Scale School Scientist Scorpion Screen Seal Server Shadow Shark Ship Shoe Shop Shot Sink Skyscraper Slip Slug Smuggler Snow Snowman Sock Soldier Soul Sound Space Spell Spider Spike Spine Spot Spring Spy Square Stadium Staff Star State Stick Stock Straw Stream Strike String Sub Suit Superhero Swing Switch ' +
  'Table Tablet Tag Tail Tap Teacher Telescope Temple Theater Thief Thumb Tick Tie Time Tokyo Tooth Torch Tower Track Train Triangle Trip Trunk Tube Turkey ' +
  'Undertaker Unicorn Vacuum Van Vet Wake Wall War Washer Washington Watch Water Wave Web Well Whale Whip Wind Witch Worm Yard ' +
  'Coffee Stapler Printer Laptop Desk Meeting Boss Lunch Pizza Taco Burger Hockey Raptors Subway Beach Cabin Canoe Moose Beaver Maple Toque Snowboard Bowling Bocce Dart Trophy Wifi Password Email Zoom').split(' ');

let io = null;
function init(socketIo) { io = socketIo; }
function defaultSettings() { return {}; }
function sanitizeSettings() { return {}; }
const socketOf = (room, id) => { const p = room.players.find(x => x.id === id); return p && p.socketId; };

function makeTeams(room) {
  const ids = shuffle(room.players.map(p => p.id));
  const half = Math.ceil(ids.length / 2);
  const red = ids.slice(0, half), blue = ids.slice(half);
  return { red, blue, spymaster: { red: red[0], blue: blue[0] } };
}

function start(room) {
  const words = shuffle([...new Set(WORDS)]).slice(0, 25);
  const first = Math.random() < 0.5 ? 'red' : 'blue';
  const second = first === 'red' ? 'blue' : 'red';
  const key = shuffle([...Array(9).fill(first), ...Array(8).fill(second), ...Array(7).fill('neutral'), 'assassin']);
  room.round = {
    game: 'codenames',
    phase: 'setup',
    teams: makeTeams(room),
    names: Object.fromEntries(room.players.map(p => [p.id, p.name])),
    words, key, revealed: Array(25).fill(false),
    first, turn: first,
    clue: null, guessesLeft: 0,
    log: [],
    result: null
  };
  room.phase = 'playing';
}

const teamOf = (r, id) => (r.teams.red.includes(id) ? 'red' : r.teams.blue.includes(id) ? 'blue' : null);
const isSpymaster = (r, id) => r.teams.spymaster.red === id || r.teams.spymaster.blue === id;
const remaining = (r, team) => r.key.filter((k, i) => k === team && !r.revealed[i]).length;

// ---- setup: shuffle teams, swap team, become spymaster ----
function shuffleTeams(room) { const r = room.round; if (r && r.phase === 'setup') r.teams = makeTeams(room); }
function switchTeam(room, id) {
  const r = room.round;
  if (!r || r.phase !== 'setup') return;
  const t = teamOf(r, id); if (!t) return;
  const o = t === 'red' ? 'blue' : 'red';
  if (r.teams[t].length <= 2) return; // each team needs 2+
  r.teams[t] = r.teams[t].filter(x => x !== id);
  r.teams[o].push(id);
  if (r.teams.spymaster[t] === id) r.teams.spymaster[t] = r.teams[t][0];
}
function claimSpymaster(room, id) {
  const r = room.round;
  if (!r || r.phase !== 'setup') return;
  const t = teamOf(r, id); if (t) r.teams.spymaster[t] = id;
}
function begin(room) { const r = room.round; if (r && r.phase === 'setup' && r.teams.red.length >= 2 && r.teams.blue.length >= 2) r.phase = 'clue'; }

// ---- play ----
function giveClue(room, id, word, number) {
  const r = room.round;
  if (!r || r.phase !== 'clue' || r.teams.spymaster[r.turn] !== id) return;
  const w = String(word || '').trim();
  if (!/^[A-Za-z'\-]{1,24}$/.test(w)) return { error: 'One word only (letters).' };
  if (r.words.some((bw, i) => !r.revealed[i] && bw.toLowerCase() === w.toLowerCase())) return { error: 'You can\'t use a word that\'s on the board.' };
  const n = parseInt(number, 10);
  if (!(n >= 0 && n <= 9)) return { error: 'Pick a number 0–9.' };
  r.clue = { word: w.toUpperCase(), number: n, team: r.turn };
  r.guessesLeft = n === 0 ? 99 : n + 1;
  r.log.unshift({ team: r.turn, clue: `${w.toUpperCase()} ${n}`, guesses: [] });
  r.phase = 'guess';
  return { ok: true };
}

function guess(room, id, idx) {
  const r = room.round;
  if (!r || r.phase !== 'guess' || teamOf(r, id) !== r.turn || isSpymaster(r, id)) return;
  idx = parseInt(idx, 10);
  if (!(idx >= 0 && idx < 25) || r.revealed[idx]) return;
  r.revealed[idx] = true;
  const k = r.key[idx];
  r.log[0].guesses.push({ word: r.words[idx], color: k, by: r.names[id] });
  const other = r.turn === 'red' ? 'blue' : 'red';
  if (k === 'assassin') return finish(room, other, 'assassin');
  if (remaining(r, 'red') === 0) return finish(room, 'red', 'all_found');
  if (remaining(r, 'blue') === 0) return finish(room, 'blue', 'all_found');
  if (k !== r.turn) return endTurn(room);
  r.guessesLeft--;
  if (r.guessesLeft <= 0) endTurn(room);
}

function endTurn(room) {
  const r = room.round;
  r.turn = r.turn === 'red' ? 'blue' : 'red';
  r.clue = null; r.guessesLeft = 0;
  r.phase = 'clue';
}
function pass(room, id) {
  const r = room.round;
  if (r && r.phase === 'guess' && teamOf(r, id) === r.turn && !isSpymaster(r, id)) endTurn(room);
}

function finish(room, winner, reason) {
  const r = room.round;
  r.result = { winner, reason };
  r.phase = 'results';
}

function privateState(room, id) {
  const r = room.round;
  return { team: teamOf(r, id), spymaster: isSpymaster(r, id), key: isSpymaster(r, id) || r.phase === 'results' ? r.key : null };
}
function syncPrivate(room) {
  const r = room.round;
  if (!r || r.game !== 'codenames') return;
  room.players.forEach(p => { if (p.socketId) io.to(p.socketId).emit('cn_you', privateState(room, p.id)); });
}
function resendPrivate(room, id) { const sid = socketOf(room, id); if (room.round && sid) io.to(sid).emit('cn_you', privateState(room, id)); }

function onPlayerRemoved(room, id) {
  const r = room.round;
  if (!r || r.game !== 'codenames' || r.phase === 'results') return;
  ['red', 'blue'].forEach(t => {
    r.teams[t] = r.teams[t].filter(x => x !== id);
    if (r.teams.spymaster[t] === id) r.teams.spymaster[t] = r.teams[t][0] || null;
  });
  if (r.phase !== 'setup' && (!r.teams.red.length || !r.teams.blue.length)) finish(room, r.teams.red.length ? 'red' : 'blue', 'forfeit');
}

function publicState(room) {
  const r = room.round;
  const mk = (t) => r.teams[t].map(id => ({ id, name: r.names[id], spymaster: r.teams.spymaster[t] === id }));
  return {
    game: 'codenames',
    phase: r.phase,
    teams: { red: mk('red'), blue: mk('blue') },
    words: r.words,
    revealed: r.revealed.map((v, i) => (v ? r.key[i] : null)),
    turn: r.turn,
    first: r.first,
    clue: r.clue,
    guessesLeft: r.guessesLeft >= 99 ? null : r.guessesLeft,
    left: { red: remaining(r, 'red'), blue: remaining(r, 'blue') },
    log: r.log.slice(0, 10),
    result: r.result
  };
}

module.exports = {
  init, defaultSettings, sanitizeSettings, start, shuffleTeams, switchTeam, claimSpymaster, begin, giveClue, guess, pass,
  resendPrivate, syncPrivate, onPlayerRemoved, publicState, MIN_PLAYERS
};
