// Hub relay MiniDayZ+ (protokol "np1"): hanya meneruskan pesan JSON antar game.
// Host (game dedicated di browser headless) dan semua pemain adalah klien WebSocket.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PROTO = 'np1';
const GAME_DIR = path.join(__dirname, 'game');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.gif': 'image/gif', '.css': 'text/css', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg', '.webm': 'video/webm', '.mp4': 'video/mp4', '.txt': 'text/plain', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

// Koneksi lokal = dari browser host di container yang sama (tanpa header proxy Railway).
const isLocal = (req) => !req.headers['x-forwarded-for'] &&
  /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '');
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

function createHub(opts = {}) {
  const log = opts.log || console.log;
  let host = null;                  // { ws, id:'h', name, uid, room }
  let room = null;                  // { id, name, max, pvp, locked }
  let password = '';
  const peers = new Map();          // id -> { ws, id, name, uid, ip }
  const queue = [];                 // { ws, hello, ip }
  let seq = 1;

  const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const everyone = () => [host, ...peers.values()].filter(Boolean);
  const playerList = () => [...peers.values()].map(p => ({ id: p.id, name: p.name, uid: p.uid, ip: p.ip }));

  function uniqueName(name) {
    name = String(name || 'Survivor').slice(0, 24) || 'Survivor';
    const taken = new Set([...peers.values()].map(p => p.name.toLowerCase()));
    if (host) taken.add(host.name.toLowerCase());
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 100; i++) { const n = `${name.slice(0, 20)}(${i})`; if (!taken.has(n.toLowerCase())) return n; }
    return name;
  }

  function admit(ws, h, ip) {
    const id = 'p' + (seq++);
    const p = { ws, id, name: uniqueName(h.name), uid: String(h.uid || ''), ip };
    ws.mdz = p; peers.set(id, p);
    send(ws, { t: 'welcome', id, host: false, room, players: playerList().filter(x => x.id !== id), name: p.name, now: Date.now() });
    const ev = { t: 'joined', id, name: p.name, uid: p.uid, ip };
    everyone().forEach(x => { if (x.ws !== ws) send(x.ws, ev); });
    log(`+ ${p.name} (${id}) ${ip}  [${peers.size}/${room.max}]`);
  }

  function pumpQueue() {
    while (queue.length && host && peers.size < room.max) { const q = queue.shift(); if (q.ws.readyState === 1) admit(q.ws, q.hello, q.ip); }
    queue.forEach((q, i) => send(q.ws, { t: 'queue', pos: i + 1, of: queue.length }));
  }

  function onHello(ws, h, req) {
    const ip = clientIp(req);
    if (!h || h.t !== 'hello' || (h.ver && h.ver !== PROTO)) return refuse(ws, h && h.ver && h.ver !== PROTO ? 'version' : 'bad_hello');
    if (h.role === 'host') {
      if (!isLocal(req)) return refuse(ws, 'bad_hello', 'host hanya boleh dari server sendiri');
      if (host) return refuse(ws, 'host_exists');
      const i = h.info || {};
      password = String(h.pw || '');
      room = { id: 'main', name: String(i.name || 'MiniDayZ server'), max: Math.max(2, Number(i.max) || 10), pvp: !!i.pvp, locked: !!password,
        lan: !!i.lan, entry: i.entry, region: i.region, ded: !!i.ded, gv: h.gv || '' };
      host = { ws, id: 'h', name: String(h.name || 'Server'), uid: String(h.uid || ''), info: i };
      ws.mdz = host; ws.mdzHost = true;
      send(ws, { t: 'welcome', id: 'h', host: true, room, players: [], now: Date.now() });
      log(`HOST aktif: "${room.name}" max=${room.max} pvp=${room.pvp} locked=${room.locked}`);
      return pumpQueue();
    }
    // klien
    if (!host) return refuse(ws, 'no_host');
    if (room.locked && String(h.pw || '') !== password) return refuse(ws, 'password');
    if (peers.size >= room.max) { queue.push({ ws, hello: h, ip }); ws.queued = true; return pumpQueue(); }
    admit(ws, h, ip);
  }

  function refuse(ws, reason, text) { send(ws, { t: 'refused', reason, text }); setTimeout(() => { try { ws.close(); } catch (e) {} }, 50); }

  function onMessage(ws, m) {
    const me = ws.mdz; if (!me) return;
    if (m.t === 'ping') return send(ws, { t: 'pong', ts: m.ts });
    if (m.t === 'msg') {
      const out = { t: 'msg', from: me.id, tag: m.tag, data: m.data };
      const to = m.to;
      if (to === 'all') everyone().forEach(x => { if (x.ws !== ws) send(x.ws, out); });
      else if (to === 'host' || to === 'h') { if (host && host.ws !== ws) send(host.ws, out); }
      else { const p = peers.get(String(to)); if (p) send(p.ws, out); }
      return;
    }
    // pesan lain dari host (state panel admin, dll.) belum dipakai: diabaikan
  }

  function onClose(ws) {
    const i = queue.findIndex(q => q.ws === ws); if (i >= 0) { queue.splice(i, 1); return pumpQueue(); }
    const me = ws.mdz; if (!me) return;
    if (ws.mdzHost) {
      log('HOST putus: semua pemain dikeluarkan');
      peers.forEach(p => { send(p.ws, { t: 'host_left' }); try { p.ws.close(); } catch (e) {} });
      queue.forEach(q => { send(q.ws, { t: 'refused', reason: 'no_host' }); try { q.ws.close(); } catch (e) {} });
      peers.clear(); queue.length = 0; host = null; room = null; return;
    }
    peers.delete(me.id);
    everyone().forEach(x => send(x.ws, { t: 'left', id: me.id }));
    log(`- ${me.name} (${me.id})  [${peers.size}]`);
    pumpQueue();
  }

  function serveStatic(req, res) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ online: !!host, name: room && room.name, players: peers.size, max: room && room.max, queue: queue.length, pvp: room && room.pvp, locked: room && room.locked }));
    }
    // file game hanya untuk browser host lokal (supaya game tidak tersebar ke publik)
    if (!isLocal(req)) { res.writeHead(404); return res.end('MiniDayZ server'); }
    let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[\/\\])+/, '');
    if (p === '/' || p === '\\') p = '/index.html';
    const file = path.join(GAME_DIR, p);
    if (!file.startsWith(GAME_DIR)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(buf);
    });
  }

  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 * 1024 });
  wss.on('connection', (ws, req) => {
    const t = setTimeout(() => { if (!ws.mdz && !ws.queued) ws.terminate(); }, 8000);
    ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
    let first = true;
    ws.on('message', (data) => {
      let m; try { m = JSON.parse(data.toString()); } catch (e) { return; }
      if (first) { first = false; clearTimeout(t); return onHello(ws, m, req); }
      onMessage(ws, m);
    });
    ws.on('close', () => { clearTimeout(t); onClose(ws); });
    ws.on('error', () => {});
  });
  // buang koneksi mati (proxy Railway bisa memutus koneksi diam)
  const hb = setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; try { ws.ping(); } catch (e) {} }), 25000);
  server.on('close', () => clearInterval(hb));
  return { server, wss, state: () => ({ host: !!host, peers: peers.size, queue: queue.length }) };
}

module.exports = { createHub, PROTO };
if (require.main === module) {
  const port = Number(process.env.PORT) || 7777;
  createHub().server.listen(port, '0.0.0.0', () => console.log('hub di port', port));
}
