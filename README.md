# Server MiniDayZ+ Reimagined (versi sendiri)

Server multiplayer untuk game MiniDayZ+ Reimagined, dijalankan dari GitHub Codespace. Sudah disesuaikan untuk versi **2.3.9-mp27c** (protokol `np1`; pemain dan server harus memakai build yang sama).
Kode ini ditulis sendiri (bukan salinan berkas pihak lain). Agar cocok dengan game, hub mengikuti protokol `np1`
yang dipakai game; tabel nama barang dan nilai kesulitan diambil dari data game karena dibutuhkan agar perintah admin tepat.

## Isi paket
| Berkas | Fungsi |
|---|---|
| `start.js` | Menjalankan hub dan membuka game sebagai host dedicated di Chromium (Playwright) |
| `hub.js` | Relay WebSocket antar pemain + API menu admin |
| `panel.html` | Menu admin web (Pemain, Barang & kit, Dunia, Spawn, Alat, Cadangan, Aturan, Keamanan, Log) |
| `backup.js` | Cadangan dunia ke folder `backups/` dan push ke GitHub |
| `setup-game.sh` | Mengambil file game dari APK ke folder `game/` (wajib, sekali tiap ganti versi APK) |
| `package.json`, `.gitignore` | Paket dan daftar berkas yang diabaikan git |
| `Dockerfile`, `railway.json` | Hanya untuk Railway (tidak dipakai di Codespace) |

## Pertama kali (di terminal Codespace)
```bash
npm install
npx playwright install --with-deps chromium
```
Kalau muncul galat 403 dari packages.microsoft.com:
```bash
sudo sh -c 'grep -rl "packages.microsoft.com" /etc/apt/sources.list.d | xargs -r rm -f'
```

## Menyiapkan game dari APK (wajib)
Game host dimuat dari folder `game/` yang diekstrak dari APK yang SAMA dengan milik pemain, sehingga versi dan hash file selalu cocok (anti-cheat dan pengecekan versi).
```bash
# cara 1: upload APK lewat panel Explorer (klik kanan -> Upload...), lalu
bash setup-game.sh NAMA-APK.apk
# cara 2: dari alamat unduhan langsung
bash setup-game.sh https://alamat/langsung/ke/file.apk
```
Folder `game/` diabaikan git, jadi tidak ikut ter-commit. Ganti APK ke versi lain? Jalankan lagi perintah di atas, lalu `rm -rf .data/profile` untuk dunia baru.
Situs Pages (`GAME_URL`) hanya cadangan dan versinya harus sama dengan APK pemain.

## Menjalankan
```bash
SAVE_MINUTES=15 EVENTS=natal DIFFICULTY=veteran BIG_MAP=1 LOCATIONS=2 ISLAND=4 ADMIN_KEY=kunci-kamu PORT=8080 node start.js
```
Setelah muncul `HOST aktif`, buka tab **Pelabuhan** dan ubah port 8080 menjadi **Publik**.
- Cek server: `https://NAMA-CODESPACE-8080.app.github.dev/status`
- Menu admin: `https://NAMA-CODESPACE-8080.app.github.dev/admin?key=KUNCI`
- Sambungan di game (tab Langsung): `wss://NAMA-CODESPACE-8080.app.github.dev`

## Variabel
| Variabel | Fungsi |
|---|---|
| `PORT` | Port server (8080) |
| `SERVER_NAME`, `SERVER_PASSWORD` | Nama dan kata sandi server |
| `MAX_PLAYERS` | Slot total, termasuk host (10 = 9 pemain) |
| `PVP` | `0` = PvP mati |
| `HOST_NAME` | Nama survivor host yang diparkir (bawaan `Server`) |
| `ISLAND`, `BIG_MAP`, `LOCATIONS` | Pulau, peta besar, pengali lokasi (dunia baru) |
| `DIFFICULTY` | `pemula`, `biasa`, `veteran`, `legendaris` (dunia baru) |
| `EVENTS` | `natal`, `halloween` (dunia baru) |
| `SAVE_MINUTES` | Jeda minimal simpan otomatis (bawaan 10) |
| `ADMIN_KEY` | Kunci menu admin, boleh banyak dipisah koma (minimal 6 karakter) |
| `ADMIN_UIDS` | UID yang otomatis jadi admin saat masuk |
| `BACKUP_EVERY_MIN`, `BACKUP_KEEP`, `BACKUP_PUSH` | Cadangan otomatis, jumlah yang disimpan, `0` = tanpa push |
| `RESTORE` | Pulihkan cadangan saat start, mis. `RESTORE=backups/world-....json.gz` |
| `GAME_URL` | Alamat game untuk host. Kosongkan agar memakai folder `game/` (disarankan). Contoh Pages: `https://launcer-mdz.github.io/ReimaginedMP/` (versinya harus sama dengan APK pemain) |
| `RENDER` | `1` = game host menggambar layar. Bawaan mati (`render=0`): jauh lebih hemat CPU dan RAM |
| `REGISTRY_URL` | Alamat daftar server publik (diminta dari pembuat mod). Kosong = tidak mendaftar |
| `PUBLIC_URL` | Alamat publik server untuk pendaftaran. Di Codespaces terisi otomatis dari nama codespace |

## Muncul di daftar server
- Di APK 2.3.9-mp27c alamat daftar publik masih kosong, jadi tidak ada server yang tampil otomatis di daftar internet (termasuk milik orang lain). Server kita siap mendaftar begitu alamatnya ada: isi `REGISTRY_URL` (formatnya sama dengan server resmi).
- Sekarang pemain bisa menambahkan alamat server ke daftar online di lobi. Hub menjawab `/rooms` (nama, jumlah pemain, slot, PvP, kata sandi), dan server yang pernah dimasuki muncul di daftar "terakhir dipakai".
- Cek: `https://NAMA-CODESPACE-8080.app.github.dev/rooms`

## Game host dari situs Pages
Kalau folder `game/` tidak ada, host memuat `GAME_URL` (bawaan: situs Pages). Cek versinya di log: `HOST aktif ... versi game=2.3.9-mp27c`. Kalau tertulis versi lain, isi situs Pages dari APK baru, atau pakai `setup-game.sh`.

## Memperbarui
```bash
pkill -f "node start.js"
pkill -f chrome
git pull
```
lalu jalankan lagi. Untuk dunia baru: `rm -rf .data/profile` sebelum menjalankan.

## Cadangan
Menu **Cadangan**: Cadangkan + push, daftar, dan Muat. Dari terminal: `node backup.js list`.
Cadangan berisi data dunia dan pemain (UID, IP di daftar ban): simpan di repo **Private**.

## Masalah umum
- Halaman minta login GitHub: port 8080 masih Private.
- Bar atau teks profil kosong: pemain keluar lalu masuk lagi setelah server diperbarui.
- Ditolak "server X, this game Y": versi APK pemain berbeda dari versi game host. Jalankan `setup-game.sh` dengan APK yang dipakai pemain.
- Muncul peringatan "folder game/ tidak ada": jalankan `setup-game.sh` dulu.
