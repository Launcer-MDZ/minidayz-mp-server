// Cadangan dunia server: data game host (IndexedDB "_C2SaveStates" + localStorage) disimpan sebagai backups/*.json.gz,
// lalu (opsional) di-commit dan di-push ke GitHub supaya bisa dimuat lagi dari Codespace mana pun.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');

const DIR = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 10);
const NAME_RE = /^[A-Za-z0-9._-]+\.json\.gz$/;

const run = (cmd, args, cwd) => new Promise((res, rej) => execFile(cmd, args, { cwd: cwd || __dirname, timeout: 90000, maxBuffer: 10 * 1024 * 1024 },
  (e, so, se) => e ? rej(new Error(String(se || e.message).trim().slice(0, 300))) : res(String(so))));

// ---- di dalam halaman game (page.evaluate) ----
async function exportFromPage(page) {
  return page.evaluate(async () => {
    const out = { v: 1, at: Date.now(), saves: [], local: {} };
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.local[k] = localStorage.getItem(k); }
    try {
      // jangan membuat database kosong bila belum ada (akan merusak penyimpanan game)
      const dbs = indexedDB.databases ? await indexedDB.databases() : [{ name: '_C2SaveStates' }];
      if (dbs.some(d => d.name === '_C2SaveStates')) {
        out.saves = await new Promise((resolve) => {
          const q = indexedDB.open('_C2SaveStates');
          q.onerror = () => resolve([]);
          q.onsuccess = () => {
            try {
              const db = q.result; if (!db.objectStoreNames.contains('saves')) { db.close(); return resolve([]); }
              const g = db.transaction('saves').objectStore('saves').getAll();
              g.onsuccess = () => { db.close(); resolve(g.result || []); }; g.onerror = () => { db.close(); resolve([]); };
            } catch (e) { resolve([]); }
          };
        });
      }
    } catch (e) {}
    return out;
  });
}

async function restoreToPage(page, data) {
  return page.evaluate(async (d) => {
    localStorage.clear();
    for (const k in (d.local || {})) localStorage.setItem(k, d.local[k]);
    const open = () => new Promise((resolve, reject) => {
      const q = indexedDB.open('_C2SaveStates');
      q.onupgradeneeded = (ev) => { if (!ev.target.result.objectStoreNames.contains('saves')) ev.target.result.createObjectStore('saves', { keyPath: 'slot' }); };
      q.onerror = () => reject(q.error); q.onsuccess = () => resolve(q.result);
    });
    let db = await open();
    if (!db.objectStoreNames.contains('saves')) {     // database lama tanpa toko "saves": hapus lalu buat ulang
      db.close(); await new Promise((r) => { const x = indexedDB.deleteDatabase('_C2SaveStates'); x.onsuccess = x.onerror = x.onblocked = () => r(); });
      db = await open();
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction('saves', 'readwrite'), st = tx.objectStore('saves');
      st.clear(); (d.saves || []).forEach(r => st.put(r)); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close(); return { saves: (d.saves || []).length, local: Object.keys(d.local || {}).length };
  }, data);
}

// ---- berkas ----
const stamp = () => { const d = new Date(), p = (n) => ('0' + n).slice(-2); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); };

function saveBackup(data, label) {
  fs.mkdirSync(DIR, { recursive: true });
  const lb = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  const name = 'world-' + stamp() + (lb ? '-' + lb : '') + '.json.gz';
  fs.writeFileSync(path.join(DIR, name), zlib.gzipSync(Buffer.from(JSON.stringify(data)), { level: 9 }));
  return { name, size: fs.statSync(path.join(DIR, name)).size };
}

function listBackups() {
  try {
    return fs.readdirSync(DIR).filter(n => NAME_RE.test(n)).sort().reverse()
      .map(n => { const st = fs.statSync(path.join(DIR, n)); return { name: n, size: st.size, at: st.mtimeMs }; });
  } catch (e) { return []; }
}

function loadBackup(nameOrPath) {
  const n = path.basename(String(nameOrPath || ''));
  if (!NAME_RE.test(n)) throw new Error('nama cadangan tidak valid');
  const file = path.join(DIR, n);
  if (!fs.existsSync(file)) throw new Error('cadangan tidak ditemukan: ' + n);
  const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
  if (!d || d.v !== 1 || !Array.isArray(d.saves) || typeof d.local !== 'object') throw new Error('isi cadangan tidak valid');
  return d;
}

function prune() {          // simpan hanya BACKUP_KEEP cadangan terbaru
  const old = listBackups().slice(KEEP); old.forEach(b => { try { fs.unlinkSync(path.join(DIR, b.name)); } catch (e) {} });
  return old.map(b => b.name);
}

// ---- git: commit + push ke GitHub (di Codespace, kredensial sudah tersedia) ----
async function gitPush(message) {
  const root = await run('git', ['rev-parse', '--show-toplevel']).then(s => s.trim());
  const rel = path.relative(root, DIR) || '.';
  await run('git', ['add', '-A', '--', rel], root);
  const st = await run('git', ['status', '--porcelain', '--', rel], root);
  if (!st.trim()) return { pushed: false, note: 'tidak ada perubahan' };
  const ID = ['-c', 'user.name=mdz-server', '-c', 'user.email=mdz-server@users.noreply.github.com'];      // rebase juga butuh identitas
  await run('git', [...ID, 'commit', '-m', message, '--', rel], root);
  try { await run('git', [...ID, 'pull', '--rebase', '--autostash'], root); }
  catch (e) {                                       // rebase gagal: batalkan, lalu coba gabung biasa
    try { await run('git', ['rebase', '--abort'], root); } catch (x) {}
    try { await run('git', [...ID, 'pull', '--no-rebase', '--no-edit'], root); } catch (x) { /* tanpa remote / konflik: tetap coba push */ }
  }
  try { await run('git', ['push'], root); }
  catch (e) { if (/upstream/i.test(e.message)) await run('git', ['push', '-u', 'origin', 'HEAD'], root); else throw e; }
  return { pushed: true };
}

module.exports = { exportFromPage, restoreToPage, saveBackup, listBackups, loadBackup, prune, gitPush, DIR, KEEP, NAME_RE };

if (require.main === module) {          // node backup.js list
  const cmd = process.argv[2];
  if (cmd === 'list') { const l = listBackups(); console.log(l.length ? l.map(b => `${b.name}  ${(b.size / 1024).toFixed(0)} KB`).join('\n') : 'Belum ada cadangan di ' + DIR); }
  else console.log('Pemakaian: node backup.js list\nMemuat cadangan: RESTORE=backups/NAMA.json.gz ADMIN_KEY=... PORT=8080 node start.js');
}
