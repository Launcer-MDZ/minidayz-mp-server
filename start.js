// Menjalankan hub + host dedicated (Chromium headless membuka game dengan ?dedicated=1).
const path = require('path');
const fs = require('fs');
const { createHub, pushLog } = require('./hub');

// semua log ikut disimpan di buffer hub supaya bisa dibaca dari /admin/logs
for (const k of ['log', 'error']) { const orig = console[k].bind(console); console[k] = (...a) => { orig(...a); try { pushLog(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); } catch (e) {} }; }

const env = process.env;
const PORT = Number(env.PORT) || 7777;
const DATA_DIR = env.DATA_DIR || '/data';          // pasang Railway Volume di /data supaya dunia tersimpan
const cfg = {
  name: env.SERVER_NAME || 'MiniDayZ+ Reimagined 2.3.8 Indonesia Server | BaseB,PvP,PvE,Bunker,IslandTravel',
  pw: env.SERVER_PASSWORD || '',
  max: Number(env.MAX_PLAYERS) || 20,
  pvp: env.PVP === '1' ? 0 : 1,
  save: Math.max(1, Number(env.SAVE_MINUTES) || 10),   // jeda minimal simpan otomatis (menit); tiap simpan membuat game membeku sesaat
  region: env.REGION || 'Indonesia/Asia',
};

// Sumber game: GAME_URL (default: situs GitHub Pages milikmu) atau folder game/ lokal bila ada.
const GAME_URL = env.GAME_URL || 'https://launcer-mdz.github.io/ReimaginedMP/';
const hasLocal = fs.existsSync(path.join(__dirname, 'game', 'index.html'));

// Tingkat kesulitan dunia BARU (DIFFICULTY): game selalu mengisi "Regular" saat server membuat dunia baru.
const DIFF_MAP = { novice: 'Novice', pemula: 'Novice', regular: 'Regular', reguler: 'Regular', biasa: 'Regular', veteran: 'Veteran', legend: 'Legend', legendaris: 'Legend' };
const DIFF = env.DIFFICULTY ? DIFF_MAP[String(env.DIFFICULTY).trim().toLowerCase()] : null;
if (env.DIFFICULTY && !DIFF) console.log('DIFFICULTY tidak dikenal:', env.DIFFICULTY, '(pilih: pemula, biasa, veteran, legendaris)');

// Event dunia BARU (EVENTS=natal,halloween): variabel game dlc_1 = Natal, dlc_2 = Halloween (tombol di layar dunia baru).
const EVT = { natal: 'dlc_1', christmas: 'dlc_1', xmas: 'dlc_1', halloween: 'dlc_2', helloween: 'dlc_2' };
const WANT_VARS = {};
String(env.EVENTS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean).forEach(n => { if (EVT[n]) WANT_VARS[EVT[n]] = 1; else console.log('EVENTS tidak dikenal:', n, '(pilih: natal, halloween)'); });
if (DIFF) WANT_VARS.Difficulty = DIFF;

// DIFF_FN_START  (dijalankan di dalam halaman game host)
// Mengisi variabel game yang diatur event "kesulitan" (dingin, damage zombi/serigala, pemulihan, dll.) pada dunia yang SUDAH berjalan.
// Tidak mengubah isi dunia yang sudah dibuat (jumlah zombi per pangkalan, desa, flag spawn).
const DIFF_PROFILES = {
  Novice:  { Difficulty: 'Novice',  Night_cold: 1, Rain_cold: 1, Day_cold: 6, Starving_current: 'Novice_starving',  Thirsty_current: 'Novice_thirsty',  Weathercold_current: 'Novice_weathercold',  Regeneration_current: 'Novice_regeneration',  Zed_dmg: 6,  Zed_fast_dmg: 6, Zed_army_dmg: 8,  Wolf_dmg: 8,  Difficulty_damage_reducer: 8 },
  Regular: { Difficulty: 'Regular', Night_cold: 2, Rain_cold: 2, Day_cold: 7, Starving_current: 'Regular_starving', Thirsty_current: 'Regular_thirsty', Weathercold_current: 'Regular_weathercold', Regeneration_current: 'Regular_regeneration', Zed_dmg: 9,  Zed_fast_dmg: 7, Zed_army_dmg: 13, Wolf_dmg: 8,  Difficulty_damage_reducer: 5 },
  Veteran: { Difficulty: 'Veteran', Night_cold: 3, Rain_cold: 3, Day_cold: 8, Starving_current: 'Veteran_starving', Thirsty_current: 'Veteran_thirsty', Weathercold_current: 'Veteran_weathercold', Regeneration_current: 'Veteran_regeneration', Zed_dmg: 10, Zed_fast_dmg: 8, Zed_army_dmg: 15, Wolf_dmg: 10, Difficulty_damage_reducer: 3 },
  Legend:  { Difficulty: 'Legend',  Night_cold: 3, Rain_cold: 3, Day_cold: 9, Starving_current: 'Veteran_starving', Thirsty_current: 'Veteran_thirsty', Weathercold_current: 'Veteran_weathercold', Regeneration_current: 'Veteran_regeneration', Zed_dmg: 10, Zed_fast_dmg: 8, Zed_army_dmg: 15, Wolf_dmg: 10, Difficulty_damage_reducer: 3 },
};
function pageDifficulty(a) {
  const rt = window.cr_getC2Runtime && window.cr_getC2Runtime();
  if (!rt || !rt.tD) return { ok: false, error: 'game belum siap' };
  const g = n => rt.tD.find(x => x && x.name === n);
  if (!a.vars) { const d = g('Difficulty'); return { ok: !!d, level: d ? String(d.data) : null }; }
  let set = 0, missing = [];
  for (const k in a.vars) { const v = g(k); if (v) { v.data = a.vars[k]; set++; } else missing.push(k); }
  return { ok: set > 0, set, missing, level: String(g('Difficulty') ? g('Difficulty').data : '') };
}
// DIFF_FN_END

// WEATHER_FN_START  (dijalankan di dalam halaman game host)
// Mengisi variabel cuaca game: Rain (0/1) dan rains_level (1 = hujan, 2 = badai/blizzard). Percobaan: efek visual dan suara
// dimulai oleh event cuaca game sendiri, jadi hasilnya perlu diuji. lock = diisi ulang tiap detik agar tidak diganti game.
function pageWeather(a) {
  const rt = window.cr_getC2Runtime && window.cr_getC2Runtime();
  if (!rt || !rt.tD) return { ok: false, error: 'game belum siap' };
  const g = n => rt.tD.find(x => x && x.name === n);
  const apply = v => { for (const k in v) { const x = g(k); if (x) x.data = v[k]; } };
  if (a.vars) { apply(a.vars); window.__mdzWeather = a.lock ? a.vars : null;
    if (a.lock && !window.__mdzWeatherT) window.__mdzWeatherT = setInterval(() => { const w = window.__mdzWeather; if (w) apply(w); }, 1000); }
  else if (a.free) window.__mdzWeather = null;
  const r = g('Rain'), l = g('rains_level');
  if (!r || !l) return { ok: false, error: 'variabel cuaca tidak ditemukan' };
  return { ok: true, rain: Number(r.data), level: Number(l.data), locked: !!window.__mdzWeather };
}
// WEATHER_FN_END

// SAVE_FN_START  (dijalankan di dalam halaman game host)
// Membungkus dedSave() milik game: simpan otomatis hanya bila sudah lewat jeda minimal DAN ada pemain online.
// Simpan paksa (tombol admin, cadangan, pemain terakhir keluar) lewat window.__mdzForceSave = true.
function pageThrottleSave(a) {
  const rt = window.cr_getC2Runtime && window.cr_getC2Runtime();
  if (!rt || !rt.S) return false;
  if (window.__mdzSaveHook) return true;
  window.__mdzOnline = a.online;
  for (const t of rt.S) {
    if (!t || !t.q) continue;
    for (const inst of t.q) {
      if (inst && typeof inst.dedSave === 'function') {
        const orig = inst.dedSave; let last = Date.now();
        inst.dedSave = function () {
          const now = Date.now(), forced = !!window.__mdzForceSave;
          if (!forced && (now - last < a.minMs || !(window.__mdzOnline > 0))) return false;      // lewati: hemat lag
          window.__mdzForceSave = false; last = now;
          return orig.apply(this, arguments);
        };
        window.__mdzSaveHook = true; return true;
      }
    }
  }
  return false;
}
// SAVE_FN_END

// VEHICLE_FN_START  (dijalankan di dalam halaman game host; pola sama dengan moveMe / trunkPin milik game)
function pageFindTeleportVehicle(a) {
  const rt = window.cr_getC2Runtime && window.cr_getC2Runtime();
  if (!rt || !rt.S) return { ok: false, error: 'game belum siap' };
  const t = rt.S.filter(o => o && o.name === a.type)[0];
  if (!t) return { ok: false, error: 'tipe ' + a.type + ' tidak ada di game' };
  const fam = rt.S[1067];                                        // keluarga semua kendaraan (vehicleType() di game)
  if (!(fam && fam.fg && fam.fg.indexOf(t) >= 0)) return { ok: false, error: a.type + ' bukan tipe kendaraan, ditolak' };
  const list = (t.q || []).filter(i => i && isFinite(i.x) && isFinite(i.y));
  if (!list.length) return { ok: false, error: 'belum ada ' + a.type + ' di area yang sedang dimuat game' };
  list.sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
  const m = list[0], from = { x: Math.round(m.x), y: Math.round(m.y) };
  m.x = a.x; m.y = a.y; if (typeof m.P === 'function') m.P();
  return { ok: true, from, found: list.length };
}
// VEHICLE_FN_END

const hub = createHub();
const onlineNow = () => hub.state().peers;
hub.onPlayers = (n) => {                       // dipanggil hub tiap pemain masuk / keluar
  if (!cur) return;
  cur.page.evaluate((n) => { window.__mdzOnline = n; }, n).catch(() => {});
  if (n === 0 && hadPlayers) { forceSaveNow().then(() => hub.sendSave()).catch(() => {}); }   // pemain terakhir keluar: simpan sekali
  if (n > 0) hadPlayers = true;
};
let hadPlayers = false;
const forceSaveNow = async () => { if (cur) await cur.page.evaluate(() => { window.__mdzForceSave = true; }).catch(() => {}); };
hub.forceSave = forceSaveNow;
hub.difficultyFn = async (level) => {
  if (!cur) throw new Error('game host belum siap');
  if (level === null) { const r = await cur.page.evaluate(pageDifficulty, {}); if (!r.ok) throw new Error(r.error || 'variabel Difficulty tidak ditemukan'); return { level: r.level }; }
  const name = DIFF_MAP[String(level).trim().toLowerCase()];
  if (!name) throw new Error('tingkat tidak dikenal: ' + level);
  const r = await cur.page.evaluate(pageDifficulty, { vars: DIFF_PROFILES[name] });
  if (!r.ok) throw new Error(r.error || 'tidak ada variabel yang bisa diubah');
  console.log('kesulitan diubah ke', name, '(' + r.set + ' variabel' + (r.missing && r.missing.length ? ', tidak ditemukan: ' + r.missing.join(',') : '') + ')');
  return { level: r.level, set: r.set, missing: r.missing };
};
hub.weatherFn = async (vars, lock, free) => {
  if (!cur) throw new Error('game host belum siap');
  const r = await cur.page.evaluate(pageWeather, { vars, lock, free });
  if (!r.ok) throw new Error(r.error);
  if (vars) console.log('cuaca diubah:', JSON.stringify(vars), lock ? '(dikunci)' : '');
  return r;
};
hub.vehicleFn = async (code, x, y) => {
  if (!cur) throw new Error('game host belum siap');
  const r = await cur.page.evaluate(pageFindTeleportVehicle, { type: code, x, y });
  if (!r.ok) throw new Error(r.error);
  console.log(`kendaraan ${code} dipindahkan dari (${r.from.x}, ${r.from.y}) ke (${x}, ${y})`);
  return r;
};

// ---- cadangan dunia (backup.js): ekspor data game host, simpan di backups/, push ke GitHub, dan pulihkan ----
let B = null; try { B = require('./backup'); } catch (e) { console.log('backup.js tidak ada: fitur cadangan nonaktif'); }
let cur = null;                 // { ctx, page } game host yang sedang berjalan
let pendingRestore = null;      // data cadangan yang akan ditulis sebelum game dimuat
const control = B ? {
  busy: false, last: null,
  list: () => B.listBackups(),
  async backup(label, push) {
    if (!cur) throw new Error('game host belum siap');
    control.busy = true;
    try {
      await forceSaveNow(); hub.sendSave(); await new Promise(r => setTimeout(r, 4000));          // minta game menyimpan dunia dulu
      const data = await B.exportFromPage(cur.page);
      if (!data.saves.length) throw new Error('belum ada dunia tersimpan di host (tunggu simpan otomatis atau mulai dunia dulu)');
      const f = B.saveBackup(data, label); B.prune();
      let git = { pushed: false };
      if (push && env.BACKUP_PUSH !== '0') { try { git = await B.gitPush('cadangan dunia ' + f.name); } catch (e) { git = { pushed: false, error: e.message }; } }
      control.last = { at: Date.now(), name: f.name, size: f.size, pushed: !!git.pushed, error: git.error || null };
      console.log('cadangan dibuat:', f.name, (f.size / 1024).toFixed(0) + ' KB', git.pushed ? '(di-push ke GitHub)' : git.error ? '(push gagal: ' + git.error + ')' : '(tanpa push)');
      return { name: f.name, size: f.size, pushed: !!git.pushed, gitError: git.error || null };
    } finally { control.busy = false; }
  },
  async restore(name) {
    if (!cur) throw new Error('game host belum siap');
    const data = B.loadBackup(name);                                          // validasi dulu
    control.busy = true;
    try {
      try { const d0 = await B.exportFromPage(cur.page); if (d0.saves.length) B.saveBackup(d0, 'sebelum-restore'); } catch (e) {}   // cadangan pengaman
      pendingRestore = data; console.log('memulihkan cadangan:', name);
      await cur.ctx.close().catch(() => {});                                  // memicu restart otomatis, lalu data ditulis sebelum game dimuat
      return { restarting: true };
    } finally { control.busy = false; }
  },
} : null;
hub.control = control;
if (control && env.RESTORE) { try { pendingRestore = B.loadBackup(env.RESTORE); console.log('akan memulihkan cadangan saat start:', env.RESTORE); } catch (e) { console.log('RESTORE gagal:', e.message); } }
const everyMin = Number(env.BACKUP_EVERY_MIN) || 0;
if (control && everyMin > 0) setInterval(() => { if (cur && !control.busy) control.backup('auto', true).catch(e => console.log('cadangan otomatis gagal:', e.message)); }, everyMin * 60000);

hub.server.listen(PORT, '0.0.0.0', () => { console.log('hub siap di port', PORT); launch(); });

let failures = 0;
async function launch() {
  const { chromium } = require('playwright');
  const profile = path.join(fs.existsSync(DATA_DIR) ? DATA_DIR : path.join(__dirname, '.data'), 'profile');
  fs.mkdirSync(profile, { recursive: true });
  const qs = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');   // game memakai decodeURIComponent: spasi harus %20, bukan +
  const q = ({ dedicated: '1', name: cfg.name, pw: cfg.pw, max: cfg.max, pvp: cfg.pvp, lan: '0', port: PORT, save: cfg.save, region: cfg.region });
  q.island = env.ISLAND || '1';                       // pulau 1-9
  if (env.BIG_MAP === '1') q.big = '1';               // peta besar 33x32 (hanya untuk dunia baru)
  if (env.LOCATIONS) q.loc = env.LOCATIONS;           // pengali lokasi 1-4 (hanya berlaku bila BIG_MAP=1)
  if (env.ENTRY_SECONDS) q.entry = env.ENTRY_SECONDS;  // hitung mundur pemain masuk (detik, 0-120)
  const base = (hasLocal && !env.GAME_URL) ? `http://127.0.0.1:${PORT}/` : GAME_URL.replace(/\/?$/, '/');
  const url = `${base}index.html?${qs(q)}`;
  console.log('memuat game dari', base);
  try {
    const ctx = await chromium.launchPersistentContext(profile, {
      headless: true, viewport: { width: Number(env.VIEW_W) || 640, height: Number(env.VIEW_H) || 360 },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows', ...(env.DISABLE_GPU === '1' ? ['--disable-gpu', '--disable-software-rasterizer'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--in-process-gpu']),
        '--disable-extensions', '--disable-features=site-per-process,TranslateUI', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--allow-running-insecure-content'],
    });
    if (Object.keys(WANT_VARS).length) {
      // Mengisi variabel global setelah event menu menimpanya (Difficulty = "Regular", dlc_* = 0), dan sebelum dunia dimulai.
      await ctx.addInitScript((want) => {
        let rt = null;
        setInterval(() => {
          try {
            if (!rt) { if (typeof window.cr_getC2Runtime !== 'function') return; rt = window.cr_getC2Runtime(); if (!rt) return; }
            const wa = rt.wa; if (!wa || !rt.tD) return;
            if (wa.name !== 'Menu' && wa.name !== 'Loading' && wa.name !== 'Login') return;      // dunia sudah berjalan: jangan diubah
            const ded = rt.tD.find(x => x && x.name === 'mp_ded_new'); if (!ded || Number(ded.data) !== 1) return;
            for (const k in want) { const g = rt.tD.find(x => x && x.name === k); if (g && g.data !== want[k]) { g.data = want[k]; console.error('[dunia baru] ' + k + ' = ' + want[k]); } }
          } catch (e) {}
        }, 20);
      }, WANT_VARS);
      console.log('pengaturan dunia baru:', JSON.stringify(WANT_VARS));
    }
    if (pendingRestore && B) {
      // tulis data cadangan ke penyimpanan game (origin yang sama) sebelum game dimuat
      const origin = new URL(base).origin, rp = ctx.pages()[0] || await ctx.newPage();
      await ctx.route(origin + '/__restore__', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>restore</title>' }));
      await rp.goto(origin + '/__restore__');
      console.log('cadangan dipulihkan:', JSON.stringify(await B.restoreToPage(rp, pendingRestore)));
      pendingRestore = null; await ctx.unroute(origin + '/__restore__');
    }
    const page = ctx.pages()[0] || await ctx.newPage();
    cur = { ctx, page };
    page.on('console', m => { if (m.type() === 'error') console.log('[game]', m.text().slice(0, 200)); });
    page.on('pageerror', e => console.log('[pageerror]', String(e.message || e).slice(0, 200)));
    page.on('crash', () => { console.log('halaman crash', readMem()); ctx.close().catch(() => {}); });
    ctx.on('close', () => { if (cur && cur.ctx === ctx) cur = null; restart('browser tertutup'); });
    await page.goto(url);
    let tries = 0;
    const hookT = setInterval(async () => {
      if (++tries > 120 || !cur || cur.page !== page) return clearInterval(hookT);
      try { if (await page.evaluate(pageThrottleSave, { minMs: cfg.save * 60000, online: onlineNow() })) { clearInterval(hookT); console.log('simpan otomatis dibatasi: minimal ' + cfg.save + ' menit, hanya saat ada pemain'); } } catch (e) {}
    }, 1000);
    console.log('game dedicated dibuka:', cfg.name);
    failures = 0;
  } catch (e) { console.error('gagal membuka game:', e.message); restart('error'); }
}
function restart(why) {
  failures++; const wait = Math.min(60000, 3000 * failures);
  console.log(`restart host (${why}) dalam ${wait / 1000}s`); setTimeout(launch, wait);
}
// log pemakaian memori container tiap 10 detik (untuk mendiagnosis crash)
function readMem() {
  const rd = (p) => { try { return Number(fs.readFileSync(p, 'utf8').trim()); } catch (e) { return NaN; } };
  let cur = rd('/sys/fs/cgroup/memory.current'), max = rd('/sys/fs/cgroup/memory.max');
  if (isNaN(cur)) { cur = rd('/sys/fs/cgroup/memory/memory.usage_in_bytes'); max = rd('/sys/fs/cgroup/memory/memory.limit_in_bytes'); }
  const mb = (n) => isNaN(n) ? '?' : Math.round(n / 1048576) + 'MB';
  return `[mem] ${mb(cur)} / ${max > 1e13 || isNaN(max) ? 'tanpa batas' : mb(max)}`;
}
setInterval(() => console.log(readMem()), 10000);
process.on('SIGTERM', () => process.exit(0));
