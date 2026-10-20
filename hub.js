// Hub relay MiniDayZ+ (protokol "np1"): hanya meneruskan pesan JSON antar game.
// Host (game dedicated di browser headless) dan semua pemain adalah klien WebSocket.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PROTO = 'np1';

// Aturan dunia yang bisa diatur dari halaman admin (kunci sama dengan panel host di game).
// type: 'b' = mati/nyala (0/1), 'n' = angka (min-max)
const RULE_DEFS = [
  ['perk_wxnj','Senjata / barang tidak aus','b'], ['perk_cybb','Barang tanpa batas','b'], ['perk_pz','Batas nyawa ganda','b'],
  ['perk_byt','Zombie lebih kuat','b'], ['perk_xgzz','Bulan Darah','b'], ['perk_qldy','NPC menembak dengan senjata otomatis','b'],
  ['perk_djjh','Pertukaran setara','b'], ['perk_jtcl','Slot inventaris tambahan','b'], ['perk_jzs','Mode bangun','b'], ['perk_exp','Toko barang XP','b'],
  ['mp_map_all','Semua melihat pemain di peta','b'], ['mp_team_ff','Tembak kawan satu tim','b'], ['mp_los_required','Butuh garis pandang (LOS)','b'],
  ['mp_los_darkness','Gelap LOS','n',0.05,1], ['mp_los_range','Jarak pandang LOS','n',0.3,3],
  ['mp_no_bunker','Bunker-bunker ditutup','b'], ['mp_no_travel','Perjalanan pulau ditutup','b'],
  ['mp_bk_every','Bunker: menit di antara pembukaan','n',5,600], ['mp_bk_open','Bunker: menit terbuka','n',1,60], ['mp_bk_gas','Bunker: menit gas saat ditutup','n',0,10],
  ['mp_ferry_wait','Perjalanan pulau: menit sebelum perahu berangkat','n',0,30],
  ['perk_keepinv','Simpan inventaris','b'], ['mp_team_style_admin','Hanya admin yang mengganti warna tim dan tag klan','b'],
  ['mp_npc_budget','Anggaran NPC per area','n',10,200], ['mp_vehicle_budget','Batas kendaraan (0 = tanpa batas)','n',0,200],
  ['mp_bring_own','Pendatang baru membawa penyintas mode pemain tunggal','b'], ['mp_no_return_boat','Pulau radiasi: tanpa perahu kembali','b'],
  ['mp_no_raid','Penyerbuan mati (C-4, molotov, rebut tiang bendera)','b'],
  ['mp_item_life','Barang di tanah: menit sebelum menghilang (0 = tidak pernah)','n',0,1440],
  ['mp_crate_respawn','Peti: menit tanpa pemain sebelum terisi lagi (0 = tidak pernah)','n',0,1440],
  ['mp_raid_walls','Penyerbuan: C-4 dan molotov juga menghancurkan dinding, tenda, bangunan lain','b'],
];

// Buffer log terakhir (dibaca halaman /admin/logs). start.js mengisinya dari console.log.
const LOGBUF = [];
function pushLog(line) { LOGBUF.push({ t: Date.now(), s: String(line).slice(0, 400) }); if (LOGBUF.length > 600) LOGBUF.splice(0, LOGBUF.length - 600); }
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
  let rulesNow = {};               // aturan dunia terakhir yang diumumkan host (tag 'ru')

  // ---- fitur admin: hak admin per UID perangkat (disimpan di file), diberikan lewat host ----
  const ADMIN_KEY = process.env.ADMIN_KEY || '';
  const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(__dirname, '.data'));
  const ADMIN_FILE = path.join(DATA_DIR, 'hub-admins.json');
  const adminUids = new Set(String(process.env.ADMIN_UIDS || '').split(',').map(x => x.trim()).filter(Boolean));
  try { JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')).forEach(u => adminUids.add(String(u))); } catch (e) {}
  function saveAdmins() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(ADMIN_FILE, JSON.stringify([...adminUids])); } catch (e) { log('gagal simpan admin: ' + e.message); } }
  // perintah ke host dari hub ("srv"): host menjalankannya sebagai perintah admin
  function sendAc(c, a) { if (host) send(host.ws, { t: 'msg', from: 'srv', tag: 'ac', data: JSON.stringify({ c, a }) }); }
  function kickPeer(id, reason, text) {
    const p = peers.get(String(id)); if (!p) return false;
    send(p.ws, { t: 'refused', reason: reason === 'banned' ? 'banned' : 'kicked', text: String(text || '') });
    setTimeout(() => { try { p.ws.close(); } catch (e) {} }, 80);
    return true;
  }
  function keyOk(k) {
    if (!ADMIN_KEY || typeof k !== 'string' || k.length !== ADMIN_KEY.length) return false;
    let d = 0; for (let i = 0; i < k.length; i++) d |= k.charCodeAt(i) ^ ADMIN_KEY.charCodeAt(i); return d === 0;
  }
  function adminDo(c, id, on) {
    const p = peers.get(String(id)); if (!p || !host) return { ok: false, error: 'pemain tidak ada' };
    log(`admin: ${c}${c === 'admin' ? (on ? ' ON' : ' OFF') : ''} -> ${p.name} (${p.id})`);
    if (c === 'admin') {
      if (!p.uid) return { ok: false, error: 'pemain tanpa UID' };
      if (on) adminUids.add(p.uid); else adminUids.delete(p.uid);
      saveAdmins(); sendAc('admin', { peer: p.id, on: !!on }); return { ok: true };
    }
    if (c === 'kick') { sendAc('kick', { peer: p.id, text: 'Dikeluarkan admin' }); return { ok: true }; }
    return { ok: false, error: 'perintah tidak dikenal' };
  }
  const LOG_PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Log</title>
<style>body{font:13px ui-monospace,monospace;background:#111;color:#ddd;margin:10px}a{color:#8cf}label{margin-left:12px}#o{white-space:pre-wrap;word-break:break-word;margin-top:8px}.t{color:#777}.e{color:#f88}</style>
<a id=bk>Kembali ke admin</a><label><input type=checkbox id=hm checked> sembunyikan [mem]</label><div id=o>memuat...</div>
<script>
const K=new URLSearchParams(location.search).get('key')||'';bk.href='/admin?key='+encodeURIComponent(K);
async function load(){try{const r=await fetch('/admin/logdata?key='+encodeURIComponent(K));if(!r.ok){o.textContent='Kunci salah';return}
const j=await r.json();const near=innerHeight+scrollY>=document.body.scrollHeight-60;o.textContent='';
j.lines.filter(x=>!(hm.checked&&x.s.startsWith('[mem]'))).slice(-250).forEach(x=>{const d=document.createElement('div');
const t=document.createElement('span');t.className='t';t.textContent=new Date(x.t).toLocaleTimeString()+'  ';d.appendChild(t);
const m=document.createElement('span');m.textContent=x.s;if(/crash|gagal|error|putus/i.test(x.s))m.className='e';d.appendChild(m);o.appendChild(d);});
if(near)scrollTo(0,document.body.scrollHeight);}catch(e){o.textContent='Gagal memuat';}}
load();setInterval(load,4000);
</script>`;
  const RULES_PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Aturan dunia</title>
<style>body{font:16px system-ui;background:#111;color:#eee;margin:12px}a{color:#8cf}h3,h4{margin:14px 0 6px}.r{border-top:1px solid #333;padding:8px 0}small{color:#999}
select,input{font:inherit;padding:6px;background:#222;color:#eee;border:1px solid #555;border-radius:6px}input[type=number]{width:90px}button{font:inherit;margin:4px 6px 0 0;padding:6px 10px;border-radius:6px;border:0;background:#2d6a2d;color:#fff}button.g{background:#555}</style>
<a id=bk>Kembali ke admin</a><h3>Aturan dunia</h3><small id=st>memuat...</small><div id=l></div>
<h3>Perlengkapan awal (pendatang baru)</h3><div class=r>
<label><input type=checkbox id=ko checked> berikan</label> <label><input type=checkbox id=kr> juga setelah mati</label><br>
kondisi <input type=number id=kc value=100 min=1 max=100>%<br>ID barang (pisahkan koma, maks 20) <input id=ki placeholder="6,39,40" style="width:90%;margin-top:6px"><br>
<small>ID barang dilihat di panel Admin game, daftar Barang: [ID: 6] Apple. Nilai sekarang tidak bisa dibaca, jadi isi ulang lengkap setiap kali.</small><br><button id=ks>Simpan perlengkapan</button></div>
<script>
const K=new URLSearchParams(location.search).get('key')||'';bk.href='/admin?key='+encodeURIComponent(K);
const Q=(p)=>'/admin/'+p+(p.includes('?')?'&':'?')+'key='+encodeURIComponent(K);
async function call(p){const r=await fetch(Q(p));const j=await r.json();if(!j.ok)alert(j.error||'gagal');return j;}
function btn(t,c,f){const b=document.createElement('button');b.textContent=t;if(c)b.className=c;b.onclick=f;return b;}
let built=false;
async function load(){try{const r=await fetch(Q('rulesdata'));if(!r.ok){st.textContent='Kunci salah';return}const j=await r.json();
st.textContent=j.online?'Host aktif. Nilai kosong = bawaan game.':'Host offline.';if(built)return;built=true;
j.defs.forEach(d=>{const row=document.createElement('div');row.className='r';const n=document.createElement('div');n.textContent=d.label;row.appendChild(n);
const v=j.values[d.k];let el;
if(d.type==='b'){el=document.createElement('select');[['','bawaan'],['0','mati'],['1','nyala']].forEach(o=>{const op=document.createElement('option');op.value=o[0];op.textContent=o[1];el.appendChild(op);});el.value=v===undefined?'':String(v);}
else{el=document.createElement('input');el.type='number';el.step='any';el.min=d.min;el.max=d.max;el.placeholder=d.min+'-'+d.max;el.value=v===undefined?'':v;}
row.appendChild(el);row.appendChild(btn('Simpan','',async()=>{const x=await call('setrule?k='+d.k+'&v='+encodeURIComponent(el.value));if(x.ok)alert('Tersimpan');}));
row.appendChild(btn('Bawaan','g',async()=>{const x=await call('setrule?k='+d.k+'&v=');if(x.ok){el.value='';alert('Dikembalikan ke bawaan');}}));l.appendChild(row);});}catch(e){st.textContent='Gagal memuat';}}
ks.onclick=async()=>{const x=await call('setkit?on='+(ko.checked?1:0)+'&respawn='+(kr.checked?1:0)+'&cond='+encodeURIComponent(kc.value)+'&items='+encodeURIComponent(ki.value));if(x.ok)alert('Perlengkapan tersimpan');};
load();
</script>`;
  const ADMIN_PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Admin</title>
<style>body{font:16px system-ui;background:#111;color:#eee;margin:12px}h3{margin:0 0 8px}.p{border:1px solid #444;border-radius:8px;padding:8px;margin:8px 0}
small{color:#999;word-break:break-all}button{font:inherit;margin:6px 6px 0 0;padding:8px 12px;border-radius:6px;border:0;background:#2d6a2d;color:#fff}button.r{background:#8a2b2b}button.g{background:#555}</style>
<h3 id=t>Pemain</h3><a id=lg style="color:#8cf">Lihat log server</a> &nbsp; <a id=rl style="color:#8cf">Aturan dunia</a><div id=l>memuat...</div>
<script>
const K=new URLSearchParams(location.search).get('key')||'';lg.href='/admin/logs?key='+encodeURIComponent(K);rl.href='/admin/rules?key='+encodeURIComponent(K);
async function go(c,id,on){const r=await fetch('/admin/do?key='+encodeURIComponent(K)+'&c='+c+'&peer='+encodeURIComponent(id)+'&on='+(on?1:0));const j=await r.json();if(!j.ok)alert(j.error||'gagal');load();}
function btn(txt,cls,fn){const b=document.createElement('button');b.textContent=txt;if(cls)b.className=cls;b.onclick=fn;return b;}
async function load(){try{const r=await fetch('/admin/players?key='+encodeURIComponent(K));if(!r.ok){l.textContent='Kunci salah';return}const j=await r.json();
t.textContent='Pemain: '+j.players.length+'/'+j.max+(j.online?'':' (host offline)');l.textContent='';
if(!j.players.length)l.textContent='Belum ada pemain.';
j.players.forEach(p=>{const d=document.createElement('div');d.className='p';const n=document.createElement('b');n.textContent=p.name+(p.admin?'  [ADMIN]':'');d.appendChild(n);d.appendChild(document.createElement('br'));
const u=document.createElement('small');u.textContent='UID: '+p.uid;d.appendChild(u);d.appendChild(document.createElement('br'));
d.appendChild(p.admin?btn('Cabut admin','g',()=>go('admin',p.id,0)):btn('Jadikan admin','',()=>go('admin',p.id,1)));
d.appendChild(btn('Kick','r',()=>{if(confirm('Kick '+p.name+'?'))go('kick',p.id,0)}));l.appendChild(d);});}catch(e){l.textContent='Gagal memuat';}}
load();setInterval(load,5000);
</script>`;

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
    log(`+ ${p.name} (${id}) uid=${p.uid || '-'} ${ip}  [${peers.size}/${room.max}]`);
    if (p.uid && adminUids.has(p.uid)) setTimeout(() => { if (peers.has(id)) sendAc('admin', { peer: id, on: true }); }, 1500);
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
    if (m.t === 'kick' && ws.mdzHost) { kickPeer(m.id, m.reason, m.text); return; }
    if (m.t === 'msg') {
      if (ws.mdzHost && m.tag === 'ru') { try { const o = JSON.parse(String(m.data)); if (o && typeof o === 'object') rulesNow = o; } catch (e) {} }
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
      peers.clear(); queue.length = 0; host = null; room = null; rulesNow = {}; return;
    }
    peers.delete(me.id);
    everyone().forEach(x => send(x.ws, { t: 'left', id: me.id }));
    log(`- ${me.name} (${me.id})  [${peers.size}]`);
    pumpQueue();
  }

  function serveStatic(req, res) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/admin')) {
      if (!ADMIN_KEY) { res.writeHead(404); return res.end('admin nonaktif'); }
      if (!keyOk(url.searchParams.get('key') || '')) { return setTimeout(() => { res.writeHead(403); res.end('kunci salah'); }, 800); }
      if (url.pathname === '/admin') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(ADMIN_PAGE); }
      if (url.pathname === '/admin/rules') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(RULES_PAGE); }
      if (url.pathname === '/admin/logs') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(LOG_PAGE); }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      if (url.pathname === '/admin/rulesdata') return res.end(JSON.stringify({ online: !!host, values: rulesNow, defs: RULE_DEFS.map(d => ({ k: d[0], label: d[1], type: d[2], min: d[3], max: d[4] })) }));
      if (url.pathname === '/admin/setrule') {
        const def = RULE_DEFS.find(d => d[0] === url.searchParams.get('k')); const v = url.searchParams.get('v');
        if (!host) return res.end('{"ok":false,"error":"host offline"}');
        if (!def) return res.end('{"ok":false,"error":"aturan tidak dikenal"}');
        if (v !== '' && !isFinite(Number(v))) return res.end('{"ok":false,"error":"nilai harus angka"}');
        log(`admin: aturan ${def[0]} = ${v === '' ? 'bawaan' : v}`); sendAc('rule', { key: def[0], value: v === '' ? '' : Number(v) });
        return res.end('{"ok":true}');
      }
      if (url.pathname === '/admin/setkit') {
        if (!host) return res.end('{"ok":false,"error":"host offline"}');
        const items = String(url.searchParams.get('items') || '').split(',').map(x => Number(x.trim())).filter(x => x > 0).slice(0, 20);
        const kit = { on: url.searchParams.get('on') === '1', respawn: url.searchParams.get('respawn') === '1', cond: Math.max(1, Math.min(100, Number(url.searchParams.get('cond')) || 100)), items };
        log(`admin: perlengkapan awal ${kit.on ? 'ON' : 'OFF'} (${items.length} barang)`); sendAc('kit', kit);
        return res.end('{"ok":true}');
      }
      if (url.pathname === '/admin/logdata') return res.end(JSON.stringify({ lines: LOGBUF.slice(-400) }));
      if (url.pathname === '/admin/players')
        return res.end(JSON.stringify({ online: !!host, max: room ? room.max : 0, players: [...peers.values()].map(p => ({ id: p.id, name: p.name, uid: p.uid, admin: adminUids.has(p.uid) })) }));
      if (url.pathname === '/admin/do')
        return res.end(JSON.stringify(adminDo(url.searchParams.get('c'), url.searchParams.get('peer'), url.searchParams.get('on') === '1')));
      return res.end('{"ok":false}');
    }
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

module.exports = { createHub, PROTO, pushLog };
if (require.main === module) {
  const port = Number(process.env.PORT) || 7777;
  createHub().server.listen(port, '0.0.0.0', () => console.log('hub di port', port));
}
