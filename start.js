// Menjalankan hub + host dedicated (Chromium headless membuka game dengan ?dedicated=1).
const path = require('path');
const fs = require('fs');
const { createHub } = require('./hub');

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

if (!fs.existsSync(path.join(__dirname, '..', 'game', 'index.html'))) {
  console.error('game/index.html tidak ada. Jalankan scripts/extract-apk.sh dulu (lihat README).'); process.exit(1);
}

const hub = createHub();
hub.server.listen(PORT, '0.0.0.0', () => { console.log('hub siap di port', PORT); launch(); });

let failures = 0;
async function launch() {
  const { chromium } = require('playwright');
  const profile = path.join(fs.existsSync(DATA_DIR) ? DATA_DIR : path.join(__dirname, '..', '.data'), 'profile');
  fs.mkdirSync(profile, { recursive: true });
  const q = new URLSearchParams({ dedicated: '1', name: cfg.name, pw: cfg.pw, max: cfg.max, pvp: cfg.pvp, lan: '0', port: PORT, save: cfg.save, region: cfg.region });
  const url = `http://127.0.0.1:${PORT}/index.html?${q}`;
  try {
    const ctx = await chromium.launchPersistentContext(profile, {
      headless: true, viewport: { width: 1280, height: 720 },
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') console.log('[game]', m.text().slice(0, 200)); });
    page.on('crash', () => { console.log('halaman crash'); ctx.close().catch(() => {}); });
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
process.on('SIGTERM', () => process.exit(0));
