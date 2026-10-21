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
  name: env.SERVER_NAME || 'MiniDayZ Server',
  pw: env.SERVER_PASSWORD || '',
  max: Number(env.MAX_PLAYERS) || 10,
  pvp: env.PVP === '0' ? 0 : 1,
  save: Number(env.SAVE_MINUTES) || 5,
  region: env.REGION || '',
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

const hub = createHub();
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
    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') console.log('[game]', m.text().slice(0, 200)); });
    page.on('pageerror', e => console.log('[pageerror]', String(e.message || e).slice(0, 200)));
    page.on('crash', () => { console.log('halaman crash', readMem()); ctx.close().catch(() => {}); });
    ctx.on('close', () => restart('browser tertutup'));
    await page.goto(url);
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
