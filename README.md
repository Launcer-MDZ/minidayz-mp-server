# Server MP MiniDayZ+ Reimagined 2.3.8-mp25 (Railway)

Isi proyek: `src/hub.js` (relay WebSocket protokol `np1`), `src/start.js` (menjalankan hub + membuka game
sebagai host dedicated di Chromium headless), `Dockerfile`, `railway.json`.

## 1. Siapkan file game (di komputer kamu)
```bash
./scripts/extract-apk.sh MDZ-Reimagined-2_3_8-mp25-Public_sign.apk   # mengisi folder game/
```
Windows: ubah nama APK jadi .zip, ambil isi `assets/www/` lalu salin ke folder `game/`.

## 2. GitHub
Buat repo **PRIVATE** (game milik Civert0 / Bohemia Interactive, jangan dipublikasikan), lalu:
```bash
git init && git add . && git commit -m "server mdz" && git branch -M main
git remote add origin https://github.com/USERNAME/mdz-server.git && git push -u origin main
```
Pastikan folder `game/` ikut ter-commit (file APK sendiri diabaikan oleh .gitignore).

## 3. Railway
1. New Project -> Deploy from GitHub repo -> pilih repo tadi (Railway memakai Dockerfile otomatis).
2. Tab Variables:
   - `SERVER_NAME` (nama server), `SERVER_PASSWORD` (kosong = tanpa password)
   - `MAX_PLAYERS` (default 10), `PVP` (1/0), `SAVE_MINUTES` (default 5)
3. Tab Settings -> Volumes -> tambah volume, mount path `/data` (supaya dunia/save tidak hilang saat redeploy).
4. Settings -> Networking -> Generate Domain.
5. Cek `https://DOMAIN/status` -> `{"online":true,...}` berarti host sudah aktif.

## 4. Join dari game
Menu Multiplayer -> Direct connect -> isi `wss://DOMAIN.up.railway.app` (+ password bila ada).

## Catatan
- Butuh RAM sekitar 1 GB atau lebih (Chromium menjalankan game); pantau pemakaian di Railway.
- Belum ada: panel admin web, daftar server online, beacon LAN.
- Hub ini disusun dari protokol yang terbaca di kode game dan diuji dengan klien tiruan, belum dengan game asli.
