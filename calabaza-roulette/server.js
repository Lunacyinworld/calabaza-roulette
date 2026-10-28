// Calabaza Roulette - servidor (Node.js + ws). El servidor es la autoridad: el cliente solo envía acciones.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const ITEMS = ['crystal', 'potion', 'axe', 'bat', 'web'];
const WINS_NEEDED = 2;

// Sirve los archivos de /public (index, manifest, service worker, iconos)
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server });
const rooms = new Map();
const rand = n => Math.floor(Math.random() * n);

function makeCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => abc[rand(abc.length)]).join(''); } while (rooms.has(c));
  return c;
}

function log(r, msg) { r.log.push(msg); if (r.log.length > 30) r.log.shift(); }

function loadChamber(r) {
  const n = 2 + rand(7);               // 2 a 8 cartuchos
  const live = 1 + rand(n - 1);        // al menos 1 real y 1 de fogueo
  r.shells = Array.from({ length: n }, (_, i) => i < live);
  for (let i = n - 1; i > 0; i--) { const j = rand(i + 1); [r.shells[i], r.shells[j]] = [r.shells[j], r.shells[i]]; }
  r.initLive = live; r.initBlank = n - live;
  r.peek = null;
  for (let p = 0; p < 2; p++) {
    const give = 2 + rand(3);
    for (let k = 0; k < give && r.items[p].length < 8; k++) r.items[p].push(ITEMS[rand(ITEMS.length)]);
  }
  log(r, `El cañón se carga: ${live} maldición(es) y ${n - live} caramelo(s).`);
}

function startRound(r, starter) {
  r.phase = 'play';
  r.max = 2 + rand(3);
  r.hp = [r.max, r.max];
  r.items = [[], []];
  r.cuffed = [false, false];
  r.sawed = false;
  r.turn = starter;
  log(r, `Ronda ${r.round}: cada alma tiene ${r.max} vela(s).`);
  loadChamber(r);
}

function startMatch(r) {
  r.round = 1; r.wins = [0, 0]; r.winner = null; r.log = [];
  startRound(r, rand(2));
}

function view(r, me) {
  const o = 1 - me;
  return {
    t: 'state', code: r.code, me, names: r.players.map(p => p.name), phase: r.phase,
    round: r.round, wins: r.wins, hp: r.hp, max: r.max, turn: r.turn,
    items: r.items, cuffed: r.cuffed, sawed: r.sawed,
    left: r.shells ? r.shells.length : 0, initLive: r.initLive, initBlank: r.initBlank,
    peek: r.peek && r.peek.p === me ? r.peek.live : null,
    winner: r.winner, log: r.log, event: r.event || null, opp: o
  };
}

function broadcast(r) {
  r.players.forEach((p, i) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(view(r, i))); });
  r.event = null;
}

function afterShot(r) {
  const dead = r.hp.findIndex(h => h <= 0);
  if (dead !== -1) {
    const w = 1 - dead;
    r.wins[w]++;
    log(r, `${r.players[dead].name} se queda sin velas. ${r.players[w].name} gana la ronda.`);
    if (r.wins[w] >= WINS_NEEDED) {
      r.phase = 'over'; r.winner = w;
      log(r, `${r.players[w].name} se lleva la partida.`);
    } else {
      r.phase = 'between';
      r.round++;
      setTimeout(() => { if (rooms.has(r.code)) { startRound(r, dead); broadcast(r); } }, 3500);
    }
    return;
  }
  if (r.shells.length === 0) loadChamber(r);
}

function handle(r, me, m) {
  if (m.t === 'rematch') {
    if (r.phase === 'over' && r.players.length === 2) { startMatch(r); broadcast(r); }
    return;
  }
  if (r.phase !== 'play' || r.turn !== me) return;
  const foe = 1 - me, name = r.players[me].name;

  if (m.t === 'shoot') {
    const self = m.target === 'self';
    const live = r.shells.shift();
    r.peek = null;
    const dmg = live ? (r.sawed ? 2 : 1) : 0;
    const victim = self ? me : foe;
    r.sawed = false;
    if (live) r.hp[victim] = Math.max(0, r.hp[victim] - dmg);
    log(r, `${name} dispara ${self ? 'contra sí mismo' : 'al rival'}: ${live ? `¡MALDICIÓN! (-${dmg})` : 'caramelo...'}`);
    r.event = { type: live ? 'live' : 'blank', victim };
    if (!(self && !live)) {
      if (r.cuffed[foe]) { r.cuffed[foe] = false; log(r, `${r.players[foe].name} está atrapado en la telaraña y pierde el turno.`); }
      else r.turn = foe;
    }
    afterShot(r);
    return broadcast(r);
  }

  if (m.t === 'use') {
    const item = r.items[me][m.idx];
    if (!item) return;
    if (item === 'axe' && r.sawed) return;
    if (item === 'web' && r.cuffed[foe]) return;
    if (item === 'potion' && r.hp[me] >= r.max) return;
    r.items[me].splice(m.idx, 1);
    if (item === 'crystal') { r.peek = { p: me, live: r.shells[0] }; log(r, `${name} mira la bola de cristal.`); }
    if (item === 'potion') { r.hp[me]++; log(r, `${name} bebe una poción (+1 vela).`); }
    if (item === 'axe') { r.sawed = true; log(r, `${name} afila el hacha: el próximo disparo hará doble daño.`); }
    if (item === 'web') { r.cuffed[foe] = true; log(r, `${name} lanza una telaraña al rival.`); }
    if (item === 'bat') {
      const s = r.shells.shift(); r.peek = null;
      log(r, `${name} espanta el cartucho con un murciélago: era ${s ? 'una MALDICIÓN' : 'un caramelo'}.`);
      if (r.shells.length === 0) loadChamber(r);
    }
    r.event = { type: 'item', item };
    broadcast(r);
  }
}

wss.on('connection', ws => {
  let room = null, me = -1;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const name = String(m.name || 'Anónimo').replace(/[<>]/g, '').slice(0, 16) || 'Anónimo';
    if (m.t === 'create' && !room) {
      const code = makeCode();
      room = { code, players: [{ ws, name }], phase: 'lobby', log: [], wins: [0, 0], hp: [0, 0], items: [[], []], cuffed: [false, false], max: 0, turn: 0 };
      rooms.set(code, room); me = 0;
      ws.send(JSON.stringify({ t: 'lobby', code }));
    } else if (m.t === 'join' && !room) {
      const r = rooms.get(String(m.code || '').toUpperCase());
      if (!r) return ws.send(JSON.stringify({ t: 'error', msg: 'Esa sala no existe.' }));
      if (r.players.length >= 2) return ws.send(JSON.stringify({ t: 'error', msg: 'La sala está llena.' }));
      r.players.push({ ws, name }); room = r; me = 1;
      startMatch(r); broadcast(r);
    } else if (room && room.players.length === 2) {
      handle(room, me, m);
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.players.forEach((p, i) => { if (i !== me && p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'left' })); });
    rooms.delete(room.code);
  });
});

// Mantiene vivas las conexiones detrás de proxies (Render, Railway, etc.)
setInterval(() => wss.clients.forEach(ws => {
  if (!ws.isAlive) return ws.terminate();
  ws.isAlive = false; ws.ping();
}), 25000);

server.listen(PORT, () => console.log(`Calabaza Roulette en http://localhost:${PORT}`));
