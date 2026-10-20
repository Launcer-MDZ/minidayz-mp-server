// Hub relay MiniDayZ+ (protokol "np1"): hanya meneruskan pesan JSON antar game.
// Host (game dedicated di browser headless) dan semua pemain adalah klien WebSocket.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PROTO = 'np1';

// Aturan dunia yang bisa diatur dari halaman admin (kunci sama dengan panel host di game).
// type: 'b' = mati/nyala (0/1), 'n' = angka (min-max)
const ACT_OK = new Set(['kick', 'ban', 'banid', 'unban', 'admin', 'heal', 'god', 'tp', 'item', 'time', 'pvp', 'say', 'bunker', 'ferry', 'island', 'save',
  'accfg', 'rule', 'rules', 'kit', 'announce', 'announce_now', 'teamstyle', 'pvp_reset', 'closedmsg', 'nobuild']);
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

// Daftar nama barang cadangan (id, nama) bila host belum mengirim daftarnya
const ITEMS_FALLBACK = [[1,"Canned Beans"],[2,"Canned Tuna"],[3,"Tactical Bacon"],[4,"Rice"],[5,"Tomato"],[6,"Apple"],[7,"Banana"],[8,"Pipsi"],[9,"Spite"],[10,"Kvas"],[11,"5.56x45 Ammo"],[12,".45 ACP Ammo"],[13,"7.62x54R Ammo"],[14,"7.62x39 Ammo"],[15,"5.45x39 Ammo"],[16,".357 M Ammo"],[17,"12 Cal Ammo"],[18,"Bandage"],[19,"IV Blood Bag"],[20,"Flare"],[21,"F1 Grenade"],[22,"9V Battery"],[23,"Campfire Kit"],[24,"Matches"],[25,"Whiskey"],[26,"Rags"],[27,"Cranberries"],[28,"IV Saline Bag"],[29,"Vitamins"],[30,"Nota-Cola"],[31,"Zucchini"],[32,"Bell Pepper"],[33,"Orange"],[34,"Heatpack"],[35,"Sewing Kit"],[36,"Gun Cleaning Kit"],[37,"Ashwood Stick"],[38,"Wooden Sticks"],[39,"Duct Tape"],[40,"Burlap Sack"],[41,"Rope"],[42,"Hunting Knife"],[43,"Army Knife"],[44,"Butcher Knife"],[45,"Adrenaline"],[46,"Tetracycline"],[47,"Tomato Seeds Pack"],[48,"Bell Pepper Seeds Pack"],[49,"Newspapers"],[50,"Woodpiles"],[51,"Crafted Arrow"],[52,"Composite Arrow"],[53,"Gasoline Can"],[54,"Water Bottle"],[55,"Canteen"],[56,"Landmine"],[57,"Bear Trap"],[58,".22 LR Ammo"],[59,"Car Tool Kit"],[60,"Raw Meat"],[61,"Roasted Meat"],[62,"Nuka-Cola"],[63,"Energy Drink"],[64,"Equivalent Exchange"],[65,"Item Carryover"],[66,"Build Mode"],[67,"Experience Shop"],[68,"Zucchini Seeds Pack"],[69,"9x19 P Ammo"],[70,"Barbed Wire"],[71,"Raw Rabbit"],[72,"Roasted Rabbit"],[73,"Cloudberries"],[74,"Bilberries"],[75,"Radio"],[76,"RDS"],[77,"PU Scope"],[78,"PSO-1 Scope"],[79,"ACOG Scope"],[80,"5.45 Suppressor"],[81,"5.56 Suppressor"],[82,"Hacksaw"],[83,"Bandolier"],[85,"MRE"],[86,"Spinning Fishing Rod"],[87,"Simple Fishing Rod"],[88,"Protective Case"],[89,"Magpul"],[90,"Choke"],[91,"Herring"],[92,"Salmon"],[93,"Ruffe"],[94,"Perch"],[95,"Small Grilled Fillet"],[96,"Large Grilled Fillet"],[97,"Psilocybin🍄"],[98,"Long Range Scope"],[99,"Claymore"],[100,"9x18 M Ammo"],[101,"9x39 Ammo"],[102,"Molotov Cocktail"],[103,"Flare Gun"],[104,"50 BMG Ammo Can"],[105,"40mm Grenade Shot"],[106,"VOG-25 Grenade Shot"],[107,"M203 Grenade Launcher"],[108,"GP-25 Grenade Launcher"],[109,"IV Kit"],[110,"Whetstone"],[111,"AK Grip"],[112,"Rail Grip"],[113,"Map Notes"],[114,"Elderberries"],[115,"Binoculars"],[116,"Scout Handbook"],[117,"Canvas"],[118,"Adhesive Plaster"],[119,"M18 Smoke Grenade"],[120,"Soviet Cigarettes"],[121,"Beer"],[122,"Epoxy Glue"],[123,"Fertilizer"],[124,"Laser Sight"],[125,"Lighter"],[126,"Keycard"],[127,"Makeshift Suppressor"],[128,"AN/PVS-4 Scope"],[129,"1PN51 Scope"],[130,"C-MAG 5.56 Drum"],[131,"7.62x39 Drum Mag"],[132,"Frying Pan"],[133,"Gas Mask"],[134,"Balaclava"],[135,"GP-5 Gas Mask"],[136,"Clown Mask"],[137,"Combat Gloves"],[138,".308 Win Ammo"],[139,"Sneakers"],[140,"Woodland Boots"],[141,"Assault Boots"],[142,"Rifle Sling"],[143,"Charcoal Tablets"],[144,"Blowtorch"],[145,"Ghillie Suit"],[146,"Underbarrel Flashlight"],[147,"Laser AK Grip"],[148,"Laser Rail Grip"],[700,"NBC Boots"],[701,"NBC Gloves"],[702,"Chem Suit"],[703,"Hazmat Suit"],[704,"12 Cal Drum Mag"],[705,"Dye Bucket🎨"],[706,"Headlamp"],[707,"NVG"],[708,"AI-2 Medkit"],[709,"Dog Kennel"],[710,"Stimulants"],[711,"CBRN Suit"],[712,"Nautical Chart"],[713,"NBC Suit"],[714,"Deerskin"],[715,"C-MAG 5.45 Drum"],[716,"Spiked Collar"],[717,"Saddlebag"],[718,"Egg"],[719,"Raw Chicken"],[720,"Cooked Chicken"],[721,"Mini Sights"],[722,"Pistol Suppressor"],[723,"Pistol Flashlight"],[724,"Fried Eggs"],[725,"Pepper Steak"],[726,"Shakshuka"],[727,"Searchlight"],[728,"Earthworm"],[729,"VOG-25 Khatabka"],[730,"FNX 45"],[731,"Colt 1911"],[732,"Magnum Revolver"],[733,"Amphibia S"],[734,"Glock 17"],[735,"Sawn-Off IZh-43"],[736,"Mosin Obrez"],[737,"Engraved Colt"],[738,"Mare's Leg"],[739,"PM"],[740,"PB"],[741,"Desert Eagle"],[742,"M79"],[743,"Obrez Blaze"],[744,"Longhorn"],[745,"MAC-10"],[746,"Mini-UZI"],[747,"C-4"],[748,"Santa Hat"],[749,"Christmas Presents"],[750,"Human Meat"],[751,"Cooked Human Meat"],[752,"Satchel"],[753,"Army Satchel"],[754,"Medical Satchel"],[755,"Weapon Case"],[756,"Pistol Holster"],[757,"Work Gloves"],[758,"12.7x108 Ammo"],[759,"Water Filter (Good)"],[760,"Water Filter (empty)"],[761,"Ammo Box"],[762,"Ammo Box"],[763,"Ammo Box"],[764,"Ammo Box"],[765,"Ammo Box"],[766,"Ammo Box"],[767,"Ammo Box"],[768,"Ammo Box"],[769,"Ammo Box"],[770,"Ammo Box"],[771,"Ammo Box"],[772,"Ammo Box"],[773,"Ammo Box"],[774,"Ammo Box"],[775,"Ammo Box"],[776,"Ammo Box"],[777,"Pear"],[778,"Burlap Sack (Chicken)"],[779,"Burlap Sack (Pig)"],[780,"Raw Wolf Meat"],[781,"Roasted Wolf Meat"],[782,"Raw Bear Meat"],[783,"Roasted Bear Meat"],[784,"Bear Hide"],[785,"Romero 77 Hatchet"],[786,"Jack o' Lantern"],[787,"Witch Hat"],[788,"Christmas Lights"],[151,"FNX 45"],[152,"Colt 1911"],[153,"Magnum Revolver"],[154,"IZh-43"],[155,"Remington 870"],[156,"Mosin-Nagant"],[157,"SKS"],[158,"M4A1"],[159,"AKM"],[160,"AK-74"],[161,"AKs-74u"],[162,"L85A2"],[163,"Improvised Bow"],[164,"Hunting Crossbow"],[165,"Amphibia S"],[166,"Ruger 10/22 Sporter"],[167,"M92 Repeater"],[168,"SVD Dragunov"],[169,"MP5K"],[170,"Glock 17"],[171,"Sawn-Off IZh-43"],[172,"Mosin Obrez"],[173,"UMP-45"],[174,"RPK"],[175,"FN-FAL"],[176,"Engraved Colt"],[177,"AUG A1"],[178,"Saiga-12K"],[179,"MAC-10"],[180,"Mare's Leg"],[181,"PM"],[182,"PB"],[183,"PP-19 Bizon"],[184,"OTs-14 Groza"],[185,"VSS Vintorez"],[186,"SV-98"],[187,"Madsen"],[188,"AN-94"],[189,"Desert Eagle"],[190,"Silenced Remington"],[191,"Colt M16A2"],[192,"KRISS Vector"],[193,"M4A1"],[194,"AKM"],[195,"M70 Tundra"],[196,"Saiga-12K"],[197,"RPK"],[198,"M16A2"],[199,"AUG A1"],[230,"Milkor MGL"],[231,"Blaze"],[232,"FAMAS F1"],[233,"Mini-14"],[234,"M79"],[235,"Obrez Blaze"],[236,"Longhorn"],[237,"AK-74"],[238,"AKs-74u"],[239,"Mini-UZI"],[240,"AS-VAL"],[241,"M249 SAW"],[242,"OSV-96"],[243,"M-40 Flamethrower"],[244,"Romero 77 Hatchet"],[245,"M134 Minigun"],[246,"PKM"],[200,"Pipe Wrench"],[201,"Shovel"],[202,"Hatchet"],[203,"Baseball Bat"],[204,"Fire Axe"],[205,"Crowbar"],[206,"Pickaxe"],[207,"Pitchfork"],[208,"Sledgehammer"],[209,"Crusader Sword"],[210,"Pan"],[211,"Katana"],[212,"Barbed Bat"],[213,"Chainsaw"],[214,"Generator"],[215,"Metal Sheet"],[216,"Torch"],[250,"Gas Mask"],[251,"Army Helmet"],[252,"Moto Helmet"],[253,"Moto Helmet"],[254,"Warm Hat"],[255,"Beret"],[256,"Cap"],[257,"Balaclava"],[258,"Ushanka"],[259,"Hard Hat"],[260,"Headlamp"],[261,"Cowboy Hat"],[262,"Welding Mask"],[263,"Gorka Helmet"],[264,"Police Hat"],[265,"NVG"],[266,"Bandana"],[267,"Crusader Helm"],[268,"Pilot Helmet"],[269,"Altyn Helmet"],[270,"Rys-T Helmet"],[271,"GP-5 Gas Mask"],[272,"Clown Mask"],[273,"Assault Helmet"],[274,"Assault Helmet"],[275,"Assault Helmet"],[276,"Assault Helmet"],[277,"NV Altyn Helmet"],[300,"Jeans"],[301,"Worker Pants"],[302,"Tracksuit Pants"],[303,"Gorka Pants"],[304,"Orel Pants"],[305,"Paramedic Pants"],[306,"Hunter Pants"],[307,"Firefighter Pants"],[350,"T-shirt"],[351,"Shirt"],[352,"Shirt"],[353,"Raincoat"],[354,"Jacket"],[355,"Gorka Jacket"],[356,"Hoodie"],[357,"Hoodie"],[358,"Trench Coat"],[359,"Paramedic Jacket"],[360,"Orel Jacket"],[361,"Tracksuit Jacket"],[362,"Dress"],[363,"Down Jacket"],[364,"Hunter Jacket"],[365,"Sweater"],[366,"Awesome Hoodie"],[367,"Firefighter Jacket"],[368,"Crusader Armor"],[400,"Ballistic Vest"],[401,"Press Vest"],[402,"Assault Vest"],[403,"High Capacity Vest"],[404,"Kevlar Vest"],[405,"Soviet Vest"],[406,"Apron"],[407,"Ghillie Suit"],[408,"M Heavy Armor Vest"],[409,"Chem Suit"],[410,"M Kevlar CBRN Suit"],[411,"M Heavy CBRN Suit"],[412,"M Ghillie CBRN Suit"],[413,"Hazmat Suit"],[414,"NBC Suit"],[415,"CBRN Suit"],[450,"Taloon Backpack"],[451,"Hunting Backpack"],[452,"Mountain Backpack"],[453,"School Backpack"],[454,"Improvised Sling Bag"],[455,"Improvised Backpack"],[456,"Civilian Tent"],[457,"Tortilla Backpack"],[458,"Satchel"],[459,"Army Satchel"],[460,"Medical Satchel"],[461,"Supplies Stash"],[462,"Fuel Pack"],[789,"NVG P45"],[790,"NVG P45"],[791,"Assault Helmet P45"],[792,"Assault Helmet P45"],[793,"Pox Vial"],[794,"40mm Pox Grenade"]];

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
  let hostState = null, hostStateAt = 0, itemsLive = null;   // status host yang dikirim tiap 2 detik ({t:'state'})
  let gifts = [];                                            // antrean hadiah: diberikan saat pemain muncul lagi / respawn

  // ---- fitur admin: hak admin per UID perangkat (disimpan di file), diberikan lewat host ----
  const ADMIN_KEYS = String(process.env.ADMIN_KEY || '').split(',').map(x => x.trim()).filter(x => x.length >= 6);   // beberapa kunci dipisah koma: satu per admin
  const ADMIN_KEY = ADMIN_KEYS.length ? ADMIN_KEYS[0] : '';
  const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(__dirname, '.data'));
  const ADMIN_FILE = path.join(DATA_DIR, 'hub-admins.json');
  const adminUids = new Set(String(process.env.ADMIN_UIDS || '').split(',').map(x => x.trim()).filter(Boolean));
  try { JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')).forEach(u => adminUids.add(String(u))); } catch (e) {}
  const GIFT_FILE = path.join(DATA_DIR, 'hub-gifts.json');
  try { const g = JSON.parse(fs.readFileSync(GIFT_FILE, 'utf8')); if (Array.isArray(g)) gifts = g; } catch (e) {}
  function saveGifts() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(GIFT_FILE, JSON.stringify(gifts)); } catch (e) {} }
  // Dipanggil tiap status host masuk: kirim hadiah bila pemainnya sudah punya posisi lagi (hidup) setelah mati / keluar.
  function runGifts() {
    if (!host || !hostState || !gifts.length) return;
    const ps = hostState.players || []; let changed = false;
    gifts = gifts.filter(g => {
      const p = ps.find(x => x.uid === g.uid && peers.has(x.id));
      if (!p) { if (!g.off) { g.off = true; changed = true; } return true; }
      if (p.x == null || p.y == null) { if (!g.nul) { g.nul = true; changed = true; } return true; }
      const moved = g.ref ? Math.hypot(p.x - g.ref.x, p.y - g.ref.y) : 1e9;
      if (!(g.nul || g.off || !g.ref || moved > 400)) return true;
      sendAc('item', { peer: p.id, itemId: g.itemId, qty: g.qty, cond: g.cond });
      log(`hadiah: ${g.qty}x #${g.itemId} -> ${p.name}`); changed = true; return false;
    });
    if (changed) saveGifts();
  }
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
    if (typeof k !== 'string') return false;
    let okAny = false;
    for (const key of ADMIN_KEYS) {                       // bandingkan semua kunci (waktu tetap) agar tidak bocor lewat waktu
      let d = key.length ^ k.length; for (let i = 0; i < k.length && i < key.length; i++) d |= k.charCodeAt(i) ^ key.charCodeAt(i);
      if (d === 0) okAny = true;
    }
    return okAny;
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
    if (ws.mdzHost && (m.t === 'state' || m.t === 'meta' || m.t === 'icons')) {
      if (m.t === 'state' && m.data && typeof m.data === 'object') {
        hostState = m.data; hostStateAt = Date.now();
        if (Array.isArray(m.data.items) && m.data.items.length) itemsLive = m.data.items;
        if (m.data.rules && typeof m.data.rules === 'object') rulesNow = m.data.rules;
        runGifts();
      }
      return;
    }
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
      peers.clear(); queue.length = 0; host = null; room = null; rulesNow = {}; hostState = null; return;
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
      if (url.pathname === '/admin') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        try { return res.end(fs.readFileSync(path.join(__dirname, 'admin.html'))); } catch (e) { return res.end(ADMIN_PAGE); }
      }
      if (url.pathname === '/admin/rules') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(RULES_PAGE); }
      if (url.pathname === '/admin/logs') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(LOG_PAGE); }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      if (url.pathname === '/admin/items') return res.end(JSON.stringify({ items: (itemsLive || ITEMS_FALLBACK.map(x => ({ id: x[0], name: x[1] }))).map(i => Array.isArray(i) ? i : [i.id, i.name]) }));
      if (url.pathname === '/admin/state') {
        const S = hostState || {}; const out = { online: !!host && !!hostState, age: hostStateAt ? Date.now() - hostStateAt : null, gifts };
        ['name', 'closedMsg', 'fps', 'mem', 'island', 'world', 'players', 'bans', 'kit', 'rules', 'pvp', 'ac', 'bunker', 'ferry', 'chat', 'kills', 'announce', 'lastSave', 'dedicated'].forEach(k => { if (S[k] !== undefined) out[k] = S[k]; });
        if (!out.players) out.players = [...peers.values()].map(p => ({ id: p.id, name: p.name, uid: p.uid, ip: p.ip, admin: adminUids.has(p.uid), x: null, y: null, pvpKills: 0, pvpDeaths: 0 }));
        return res.end(JSON.stringify(out));
      }
      if (url.pathname === '/admin/act') {
        const c = String(url.searchParams.get('c') || ''); let a = {};
        try { a = JSON.parse(url.searchParams.get('a') || '{}'); } catch (e) { return res.end('{"ok":false,"error":"argumen rusak"}'); }
        if (!ACT_OK.has(c)) return res.end('{"ok":false,"error":"perintah tidak diizinkan"}');
        if (!host) return res.end('{"ok":false,"error":"host offline"}');
        if (!a || typeof a !== 'object' || Array.isArray(a) || JSON.stringify(a).length > 4000) return res.end('{"ok":false,"error":"argumen salah"}');
        if (c === 'admin') return res.end(JSON.stringify(adminDo('admin', a.peer, !!a.on)));
        log(`admin: ${c} ${JSON.stringify(a).slice(0, 120)}`); sendAc(c, a); return res.end('{"ok":true}');
      }
      if (url.pathname === '/admin/gift') {
        const uid = String(url.searchParams.get('uid') || ''), itemId = Math.round(Number(url.searchParams.get('itemId')));
        const qty = Math.max(1, Math.min(50, Math.round(Number(url.searchParams.get('qty')) || 1))), cond = Math.max(1, Math.min(100, Math.round(Number(url.searchParams.get('cond')) || 100)));
        if (!uid || !(itemId > 0)) return res.end('{"ok":false,"error":"pemain atau barang tidak valid"}');
        if (gifts.length >= 100) return res.end('{"ok":false,"error":"antrean penuh"}');
        const p = ((hostState && hostState.players) || []).find(x => x.uid === uid && peers.has(x.id));
        gifts.push({ uid, name: String(url.searchParams.get('name') || '').slice(0, 30), itemId, qty, cond, ref: p && p.x != null ? { x: p.x, y: p.y } : null, off: !p, nul: !!p && p.x == null, at: Date.now() });
        saveGifts(); return res.end('{"ok":true}');
      }
      if (url.pathname === '/admin/giftdel') { const i = Number(url.searchParams.get('i')); if (i >= 0 && i < gifts.length) { gifts.splice(i, 1); saveGifts(); } return res.end('{"ok":true}'); }
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
