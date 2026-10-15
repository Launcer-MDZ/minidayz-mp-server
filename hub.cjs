'use strict';
// Minimal WebSocket relay hub for the MDZ-Reimagined 2.3.8-mp24 client.
// This relays game messages; it does not simulate or host the game world.
const http = require('node:http');
const crypto = require('node:crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 7777);
const PROTOCOL_VERSION = process.env.MDZ_PROTOCOL || 'np1';
const GAME_VERSION = process.env.MDZ_GAME_VERSION || '2.3.8-mp24';
const MAX_MESSAGE_BYTES = 1024 * 1024;
const rooms = new Map(); // one room per hub instance
const clients = new Map();

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/' || req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, service: 'mdz-mp-hub', protocol: PROTOCOL_VERSION, game: GAME_VERSION }));
  }
  if (req.url === '/rooms') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify([...rooms.values()].filter(r => r.host && r.host.readyState === WebSocket.OPEN).map(r => ({
      id: r.id, name: r.name, players: r.members.size, max: r.max, pvp: r.pvp,
      locked: r.locked, since: r.since, region: process.env.REGION || 'Asia',
      lvl: 0, rows: 0, time: Date.now()
    }))));
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

const wss = new WebSocket.Server({ server, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(room, obj, except = null) {
  for (const peer of room.members.values()) if (peer !== except) send(peer, obj);
}
function cleanName(v, fallback) { return String(v || fallback).trim().slice(0, 24) || fallback; }
function refuse(ws, reason, text) { send(ws, { t: 'refused', reason, ...(text ? { text } : {}) }); try { ws.close(1008, reason); } catch {} }
function removePeer(ws) {
  const p = clients.get(ws);
  if (!p) return;
  clients.delete(ws);
  const room = p.room;
  if (!room) return;
  room.members.delete(p.id);
  if (p.role === 'host') {
    broadcast(room, { t: 'host_left' }, ws);
    for (const member of room.members.values()) { const info = clients.get(member); if (info) info.room = null; }
    rooms.delete(room.id);
  } else {
    broadcast(room, { t: 'left', id: p.id }, ws);
  }
}
function onHello(ws, m) {
  if (!m || m.t !== 'hello' || !['host', 'client'].includes(m.role)) return refuse(ws, 'bad_hello');
  if (String(m.ver || '') !== PROTOCOL_VERSION || String(m.gv || '') !== GAME_VERSION) return refuse(ws, 'version', `expected ${PROTOCOL_VERSION}/${GAME_VERSION}`);
  if (clients.has(ws)) return refuse(ws, 'bad_hello');
  const role = m.role;
  let room;
  if (role === 'host') {
    if (rooms.size) return refuse(ws, 'host_exists', 'This starter hub supports one room at a time.');
    const info = m.info && typeof m.info === 'object' ? m.info : {};
    const id = crypto.randomBytes(6).toString('hex');
    room = {
      id, name: cleanName(info.name || m.name, 'MiniDayZ Server'),
      max: Math.max(2, Math.min(120, Number(info.max) || 20)),
      pvp: !!info.pvp, locked: !!info.locked, pw: String(m.pw || ''),
      since: Date.now(), host: ws, members: new Map()
    };
    room.members.set('h', ws); rooms.set(id, room);
    clients.set(ws, { id: 'h', name: cleanName(m.name, 'Host'), role, room });
    send(ws, { t: 'welcome', id: 'h', host: true, now: Date.now(), room: { id, name: room.name, max: room.max, pvp: room.pvp, locked: room.locked }, players: [] });
    console.log(`Host started room ${id} (${room.name})`);
    return;
  }
  const requestedRoom = String(m.room || '');
  room = requestedRoom ? rooms.get(requestedRoom) : [...rooms.values()][0];
  if (!room || !room.host || room.host.readyState !== WebSocket.OPEN) return refuse(ws, 'no_host');
  if (room.members.size >= room.max) return refuse(ws, 'full');
  if (room.pw !== String(m.pw || '')) return refuse(ws, 'password');
  let id;
  do { id = crypto.randomBytes(5).toString('hex'); } while (room.members.has(id));
  const name = cleanName(m.name, 'Survivor');
  clients.set(ws, { id, name, role, room }); room.members.set(id, ws);
  const players = [...room.members.entries()].filter(([pid]) => pid !== id).map(([pid, peer]) => {
    const pi = clients.get(peer); return { id: pid, name: pi ? pi.name : (pid === 'h' ? 'Host' : 'Survivor') };
  });
  send(ws, { t: 'welcome', id, host: false, now: Date.now(), room: { id: room.id, name: room.name, max: room.max, pvp: room.pvp, locked: room.locked }, players });
  broadcast(room, { t: 'joined', id, name }, ws);
  console.log(`${name} joined room ${room.id}`);
}

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!clients.has(ws)) return onHello(ws, m);
    const p = clients.get(ws), room = p.room;
    if (!room) return;
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'ping') return send(ws, { t: 'pong', ts: m.ts });
    if (m.t === 'msg') {
      const to = String(m.to || 'all');
      const out = { t: 'msg', from: p.id, tag: String(m.tag || '').slice(0, 32), data: m.data };
      if (to === 'all') return broadcast(room, out, ws);
      if (to === 'host') return send(room.host, out);
      if (to === 'srv') return; // reserved server-side destination
      const target = room.members.get(to);
      if (target) send(target, out);
    }
  });
  ws.on('close', () => removePeer(ws));
  ws.on('error', () => removePeer(ws));
  ws.on('messageerror', () => {});
  ws.on('unexpected-response', () => {});
  console.log(`WebSocket connected: ${req.socket.remoteAddress || 'unknown'}`);
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false; try { ws.ping(); } catch { ws.terminate(); }
  }
}, 30000);
server.listen(PORT, '0.0.0.0', () => console.log(`MDZ MP hub listening on 0.0.0.0:${PORT}`));
server.on('close', () => clearInterval(heartbeat));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
