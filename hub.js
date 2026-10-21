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

// Tabel barang dari game: [id, nama, kategori, s (0 = tidak bisa dibuat, 'p'/'d'/angka = cara/target spawn), v (1 = pakai AMMO/CHARGE)]
const ITEMS_META = [[1,"Canned Beans","General","d",0],[2,"Canned Tuna","General","d",0],[3,"Tactical Bacon","General","d",0],[4,"Rice","General","d",0],[5,"Tomato","General","d",0],[6,"Apple","General","d",0],[7,"Banana","General","d",0],[8,"Pipsi","General","d",0],[9,"Spite","General","d",0],[10,"Kvas","General","d",0],[11,"5.56x45 Ammo","General","d",0],[12,".45 ACP Ammo","General","d",0],[13,"7.62x54R Ammo","General","d",0],[14,"7.62x39 Ammo","General","d",0],[15,"5.45x39 Ammo","General","d",0],[16,".357 M Ammo","General","d",0],[17,"12 Cal Ammo","General","d",0],[18,"Bandage","General","d",0],[19,"IV Blood Bag","General","d",0],[20,"Flare","General","d",0],[21,"F1 Grenade","General","d",0],[22,"9V Battery","General","d",0],[23,"Campfire Kit","General","d",0],[24,"Matches","General","d",0],[25,"Whiskey","General","d",0],[26,"Rags","General","d",0],[27,"Cranberries","General","d",0],[28,"IV Saline Bag","General","d",0],[29,"Vitamins","General","d",0],[30,"Nota-Cola","General","d",0],[31,"Zucchini","General","d",0],[32,"Bell Pepper","General","d",0],[33,"Orange","General","d",0],[34,"Heatpack","General","d",0],[35,"Sewing Kit","General","d",0],[36,"Gun Cleaning Kit","General","d",0],[37,"Ashwood Stick","General","d",0],[38,"Wooden Sticks","General","d",0],[39,"Duct Tape","General","d",0],[40,"Burlap Sack","General","d",0],[41,"Rope","General","d",0],[42,"Hunting Knife","General","d",0],[43,"Army Knife","General","d",0],[44,"Butcher Knife","General","d",0],[45,"Adrenaline","General","d",0],[46,"Tetracycline","General","d",0],[47,"Tomato Seeds Pack","General","d",0],[48,"Bell Pepper Seeds Pack","General","d",0],[49,"Newspapers","General","d",0],[50,"Woodpiles","General","d",0],[51,"Crafted Arrow","General","d",0],[52,"Composite Arrow","General","d",0],[53,"Gasoline Can","General","d",0],[54,"Water Bottle","General","d",0],[55,"Canteen","General","d",0],[56,"Landmine","General","d",0],[57,"Bear Trap","General","d",0],[58,".22 LR Ammo","General","d",0],[59,"Car Tool Kit","General","d",0],[60,"Raw Meat","General","d",0],[61,"Roasted Meat","General","d",0],[62,"Nuka-Cola","General","d",0],[63,"Energy Drink","General","d",0],[64,"Equivalent Exchange","General","p",0],[65,"Item Carryover","General","p",0],[66,"Build Mode","General",0,0],[67,"Experience Shop","General",0,0],[68,"Zucchini Seeds Pack","General","d",0],[69,"9x19 P Ammo","General","d",0],[70,"Barbed Wire","General","d",0],[71,"Raw Rabbit","General","d",0],[72,"Roasted Rabbit","General","d",0],[73,"Cloudberries","General","d",0],[74,"Bilberries","General","d",0],[75,"Radio","General","d",0],[76,"RDS","General","d",0],[77,"PU Scope","General","d",0],[78,"PSO-1 Scope","General","d",0],[79,"ACOG Scope","General","d",0],[80,"5.45 Suppressor","General","d",0],[81,"5.56 Suppressor","General","d",0],[82,"Hacksaw","General","d",0],[83,"Bandolier","General","d",0],[84,"4-dial Codelock","General","d",0],[85,"MRE","General","d",0],[86,"Spinning Fishing Rod","General","d",0],[87,"Simple Fishing Rod","General","d",0],[88,"Protective Case","General","d",0],[89,"Magpul","General","d",0],[90,"Choke","General","d",0],[91,"Herring","General","d",0],[92,"Salmon","General","d",0],[93,"Ruffe","General","d",0],[94,"Perch","General","d",0],[95,"Small Grilled Fillet","General","d",0],[96,"Large Grilled Fillet","General","d",0],[97,"Psilocybin🍄","General","d",0],[98,"Long Range Scope","General","d",0],[99,"Claymore","General","d",0],[100,"9x18 M Ammo","General","d",0],[101,"9x39 Ammo","General","d",0],[102,"Molotov Cocktail","General","d",0],[103,"Flare Gun","General","d",0],[104,"50 BMG Ammo Can","General","d",0],[105,"40mm Grenade Shot","General","d",0],[106,"VOG-25 Grenade Shot","General","d",0],[107,"M203 Grenade Launcher","General","d",0],[108,"GP-25 Grenade Launcher","General","d",0],[109,"IV Kit","General","d",0],[110,"Whetstone","General","d",0],[111,"AK Grip","General","d",0],[112,"Rail Grip","General","d",0],[113,"Map Notes","General","d",0],[114,"Elderberries","General","d",0],[115,"Binoculars","General",0,0],[116,"Scout Handbook","General","d",0],[117,"Canvas","General","d",0],[118,"Adhesive Plaster","General","d",0],[119,"M18 Smoke Grenade","General","d",0],[120,"Soviet Cigarettes","General","d",0],[121,"Beer","General","d",0],[122,"Epoxy Glue","General","d",0],[123,"Fertilizer","General","d",0],[124,"Laser Sight","General","d",0],[125,"Lighter","General","d",0],[126,"Keycard","General","d",0],[127,"Makeshift Suppressor","General","d",0],[128,"AN/PVS-4 Scope","General","d",0],[129,"1PN51 Scope","General","d",0],[130,"C-MAG 5.56 Drum","General","d",0],[131,"7.62x39 Drum Mag","General","d",0],[132,"Frying Pan","General","p",0],[133,"Gas Mask","Helmet",250,0],[134,"Balaclava","Helmet",257,0],[135,"GP-5 Gas Mask","Helmet",271,0],[136,"Clown Mask","Helmet",272,0],[137,"Combat Gloves","General","d",0],[138,".308 Win Ammo","General","d",0],[139,"Sneakers","General","d",0],[140,"Woodland Boots","General","d",0],[141,"Assault Boots","General","d",0],[142,"Rifle Sling","General","d",0],[143,"Charcoal Tablets","General","d",0],[144,"Blowtorch","General","d",0],[145,"Ghillie Suit","Vest",407,0],[146,"Underbarrel Flashlight","General","d",0],[147,"Laser AK Grip","General","p",0],[148,"Laser Rail Grip","General","p",0],[149,"7.62/.308 Suppressor","General","d",0],[700,"NBC Boots","General","d",0],[701,"NBC Gloves","General","d",0],[702,"Chem Suit","General","d",0],[703,"Hazmat Suit","Vest",413,0],[704,"12 Cal Drum Mag","General","d",0],[705,"Dye Bucket🎨","General","d",0],[706,"Headlamp","Helmet",260,1],[707,"NVG","Helmet",265,1],[708,"AI-2 Medkit","General","d",0],[709,"Dog Kennel","General","d",0],[710,"Stimulants","General","d",0],[711,"CBRN Suit","General","d",0],[712,"Nautical Chart","General","d",0],[713,"NBC Suit","General","d",0],[714,"Deerskin","General","p",0],[715,"C-MAG 5.45 Drum","General","d",0],[716,"Spiked Collar","General","d",0],[717,"Saddlebag","General","d",0],[718,"Egg","General","p",0],[719,"Raw Chicken","General","p",0],[720,"Cooked Chicken","General","p",0],[721,"Mini Sights","General","d",0],[722,"Pistol Suppressor","General","d",0],[723,"Pistol Flashlight","General","d",0],[724,"Fried Eggs","General","p",0],[725,"Pepper Steak","General","p",0],[726,"Shakshuka","General","p",0],[727,"Searchlight","General","d",0],[728,"Earthworm","General","d",0],[729,"VOG-25 Khatabka","General","p",0],[730,"FNX 45","Pistol",151,1],[731,"Colt 1911","Pistol",152,1],[732,"Magnum Revolver","Pistol",153,1],[733,"Amphibia S","Pistol",165,1],[734,"Glock 17","Pistol",170,1],[735,"Sawn-Off IZh-43","Pistol",171,1],[736,"Mosin Obrez","Pistol",172,1],[737,"Engraved Colt","Pistol",176,1],[738,"Mare's Leg","Pistol",180,1],[739,"PM","Pistol",181,1],[740,"PB","Pistol",182,1],[741,"Desert Eagle","Pistol",189,1],[742,"M79","Pistol",234,1],[743,"Obrez Blaze","Pistol",235,1],[744,"Longhorn","Pistol",236,1],[745,"MAC-10","Pistol",179,1],[746,"Mini-UZI","Pistol",239,1],[747,"C-4","General","d",0],[748,"Santa Hat","General","p",0],[749,"Christmas Presents","General","p",0],[750,"Human Meat","General","p",0],[751,"Cooked Human Meat","General","p",0],[752,"Satchel","General","d",0],[753,"Army Satchel","General","d",0],[754,"Medical Satchel","General","d",0],[755,"Weapon Case","General","d",0],[756,"Pistol Holster","General","d",0],[757,"Work Gloves","General","d",0],[758,"12.7x108 Ammo","General","d",0],[759,"Water Filter (Good)","General","d",0],[760,"Water Filter (empty)","General","p",0],[761,"Ammo Box","General","d",0],[762,"Ammo Box","General",761,0],[763,"Ammo Box","General",761,0],[764,"Ammo Box","General",761,0],[765,"Ammo Box","General",761,0],[766,"Ammo Box","General",761,0],[767,"Ammo Box","General",761,0],[768,"Ammo Box","General",761,0],[769,"Ammo Box","General",761,0],[770,"Ammo Box","General",761,0],[771,"Ammo Box","General",761,0],[772,"Ammo Box","General",761,0],[773,"Ammo Box","General",761,0],[774,"Ammo Box","General",761,0],[775,"Ammo Box","General",761,0],[776,"Ammo Box","General",761,0],[777,"Pear","General","d",0],[778,"Burlap Sack (Chicken)","General",0,0],[779,"Burlap Sack (Pig)","General",0,0],[780,"Raw Wolf Meat","General","d",0],[781,"Roasted Wolf Meat","General","d",0],[782,"Raw Bear Meat","General","d",0],[783,"Roasted Bear Meat","General","d",0],[784,"Bear Hide","General","d",0],[785,"Romero 77 Hatchet","Pistol",244,1],[786,"Jack o' Lantern","General","p",0],[787,"Witch Hat","General","p",0],[788,"Christmas Lights","General","p",0],[151,"FNX 45","Pistol","d",1],[152,"Colt 1911","Pistol","d",1],[153,"Magnum Revolver","Pistol","d",1],[154,"IZh-43","Rifle","d",1],[155,"Remington 870","Rifle","d",1],[156,"Mosin-Nagant","Rifle","d",1],[157,"SKS","Rifle","d",1],[158,"M4A1","Rifle","d",1],[159,"AKM","Rifle","d",1],[160,"AK-74","Rifle","d",1],[161,"AKs-74u","Rifle","d",1],[162,"L85A2","Rifle","d",1],[163,"Improvised Bow","Rifle","d",1],[164,"Hunting Crossbow","Rifle","d",1],[165,"Amphibia S","Pistol","d",1],[166,"Ruger 10/22 Sporter","Rifle","d",1],[167,"M92 Repeater","Rifle","d",1],[168,"SVD Dragunov","Rifle","d",1],[169,"MP5K","Rifle","d",1],[170,"Glock 17","Pistol","d",1],[171,"Sawn-Off IZh-43","Pistol","d",1],[172,"Mosin Obrez","Pistol","d",1],[173,"UMP-45","Rifle","d",1],[174,"RPK","Rifle","d",1],[175,"FN-FAL","Rifle","d",1],[176,"Engraved Colt","Pistol","d",1],[177,"AUG A1","Rifle","d",1],[178,"Saiga-12K","Rifle","d",1],[179,"MAC-10","Pistol","d",1],[180,"Mare's Leg","Pistol","d",1],[181,"PM","Pistol","d",1],[182,"PB","Pistol","d",1],[183,"PP-19 Bizon","Rifle","d",1],[184,"OTs-14 Groza","Rifle","d",1],[185,"VSS Vintorez","Rifle","d",1],[186,"SV-98","Rifle","d",1],[187,"Madsen","Rifle","d",1],[188,"AN-94","Rifle","d",1],[189,"Desert Eagle","Pistol","d",1],[190,"Silenced Remington","Rifle","d",1],[191,"Colt M16A2","Rifle","d",1],[192,"KRISS Vector","Rifle","d",1],[193,"M4A1","Rifle","d",1],[194,"AKM","Rifle","d",1],[195,"M70 Tundra","Rifle","d",1],[196,"Saiga-12K","Rifle","d",1],[197,"RPK","Rifle","d",1],[198,"M16A2","Rifle","d",1],[199,"AUG A1","Rifle","d",1],[230,"Milkor MGL","Rifle","d",1],[231,"Blaze","Rifle","d",1],[232,"FAMAS F1","Rifle","d",1],[233,"Mini-14","Rifle","d",1],[234,"M79","Pistol","d",1],[235,"Obrez Blaze","Pistol","d",1],[236,"Longhorn","Pistol","d",1],[237,"AK-74","Rifle","d",1],[238,"AKs-74u","Rifle","d",1],[239,"Mini-UZI","Pistol","d",1],[240,"AS-VAL","Rifle","d",1],[241,"M249 SAW","Rifle","d",1],[242,"OSV-96","Rifle","d",1],[243,"M-40 Flamethrower","Rifle","d",1],[244,"Romero 77 Hatchet","Pistol","d",1],[245,"M134 Minigun","Rifle","d",1],[246,"PKM","Rifle","d",1],[200,"Pipe Wrench","Melee","d",0],[201,"Shovel","Melee","d",0],[202,"Hatchet","Melee","d",0],[203,"Baseball Bat","Melee","d",0],[204,"Fire Axe","Melee","d",0],[205,"Crowbar","Melee","d",0],[206,"Pickaxe","Melee","d",0],[207,"Pitchfork","Melee","d",0],[208,"Sledgehammer","Melee","d",0],[209,"Crusader Sword","Melee","d",0],[210,"Pan","Melee","d",0],[211,"Katana","Melee","d",0],[212,"Barbed Bat","Melee","d",0],[213,"Chainsaw","Melee","d",0],[214,"Generator","Melee","d",0],[215,"Metal Sheet","Melee","d",0],[216,"Torch","Melee","d",0],[217,"Green Barrel","General","d",0],[218,"Blue Barrel","General","d",0],[250,"Gas Mask","Helmet","d",0],[251,"Army Helmet","Helmet","d",0],[252,"Moto Helmet","Helmet","d",0],[253,"Moto Helmet","Helmet","d",0],[254,"Warm Hat","Helmet","d",0],[255,"Beret","Helmet","d",0],[256,"Cap","Helmet","d",0],[257,"Balaclava","Helmet","d",0],[258,"Ushanka","Helmet","d",0],[259,"Hard Hat","Helmet","d",0],[260,"Headlamp","Helmet","d",1],[261,"Cowboy Hat","Helmet","d",0],[262,"Welding Mask","Helmet","d",0],[263,"Gorka Helmet","Helmet","d",0],[264,"Police Hat","Helmet","d",0],[265,"NVG","Helmet","d",1],[266,"Bandana","Helmet","d",0],[267,"Crusader Helm","Helmet","d",0],[268,"Pilot Helmet","Helmet","d",0],[269,"Altyn Helmet","Helmet","d",0],[270,"Rys-T Helmet","Helmet","d",0],[271,"GP-5 Gas Mask","Helmet","d",0],[272,"Clown Mask","Helmet","d",0],[273,"Assault Helmet","Helmet","d",0],[274,"Assault Helmet","Helmet","d",0],[275,"Assault Helmet","Helmet","d",0],[276,"Assault Helmet","Helmet","d",0],[277,"NV Altyn Helmet","Helmet","d",0],[300,"Jeans","Pants","d",0],[301,"Worker Pants","Pants","d",0],[302,"Tracksuit Pants","Pants","d",0],[303,"Gorka Pants","Pants","d",0],[304,"Orel Pants","Pants","d",0],[305,"Paramedic Pants","Pants","d",0],[306,"Hunter Pants","Pants","d",0],[307,"Firefighter Pants","Pants","d",0],[350,"T-shirt","Outerwear","d",0],[351,"Shirt","Outerwear",352,0],[352,"Shirt","Outerwear","d",0],[353,"Raincoat","Outerwear","d",0],[354,"Jacket","Outerwear","d",0],[355,"Gorka Jacket","Outerwear","d",0],[356,"Hoodie","Outerwear","d",0],[357,"Hoodie","Outerwear","d",0],[358,"Trench Coat","Outerwear","d",0],[359,"Paramedic Jacket","Outerwear","d",0],[360,"Orel Jacket","Outerwear","d",0],[361,"Tracksuit Jacket","Outerwear","d",0],[362,"Dress","Outerwear","d",0],[363,"Down Jacket","Outerwear","d",0],[364,"Hunter Jacket","Outerwear","d",0],[365,"Sweater","Outerwear","d",0],[366,"Awesome Hoodie","Outerwear","d",0],[367,"Firefighter Jacket","Outerwear","d",0],[368,"Crusader Armor","Outerwear","d",0],[400,"Ballistic Vest","Vest","d",0],[401,"Press Vest","Vest","d",0],[402,"Assault Vest","Vest","d",0],[403,"High Capacity Vest","Vest","d",0],[404,"Kevlar Vest","Vest","d",0],[405,"Soviet Vest","Vest","d",0],[406,"Apron","Vest","d",0],[407,"Ghillie Suit","Vest","d",0],[408,"M Heavy Armor Vest","Vest","d",0],[409,"Chem Suit","Vest","d",0],[410,"M Kevlar CBRN Suit","Vest","d",0],[411,"M Heavy CBRN Suit","Vest","d",0],[412,"M Ghillie CBRN Suit","Vest","d",0],[413,"Hazmat Suit","Vest","d",0],[414,"NBC Suit","Vest","d",0],[415,"CBRN Suit","Vest","d",0],[450,"Taloon Backpack","Backpack","d",0],[451,"Hunting Backpack","Backpack","d",0],[452,"Mountain Backpack","Backpack","d",0],[453,"School Backpack","Backpack","d",0],[454,"Improvised Sling Bag","Backpack","d",0],[455,"Improvised Backpack","Backpack","d",0],[456,"Civilian Tent","Backpack","d",0],[457,"Tortilla Backpack","Backpack","d",0],[458,"Satchel","Backpack","d",0],[459,"Army Satchel","Backpack","d",0],[460,"Medical Satchel","Backpack","d",0],[461,"Supplies Stash","Backpack",0,0],[462,"Fuel Pack","Backpack","d",0],[789,"NVG P45","Helmet","d",1],[790,"NVG P45","Helmet",789,1],[791,"Assault Helmet P45","Helmet","d",0],[792,"Assault Helmet P45","Helmet","d",0],[793,"Pox Vial","General","d",0],[794,"40mm Pox Grenade","General","d",0],[795,"Lockpick","General","d",0],[796,"Flag Pole Kit","General","d",0]];
const ITEM_BY = new Map(ITEMS_META.map(r => [r[0], r]));
// Argumen perintah 'item' persis seperti yang dibuat kartu barang di panel admin game (admSpawnCard)
function itemSpawn(id, qty, cond, st, peer) {
  const m = ITEM_BY.get(id); if (!m || m[3] === 0) return null;
  const tg = m[3] === 'p' ? { id, via: 'p' } : (typeof m[3] === 'number' && m[3] > 0) ? { id: m[3], via: 'd' } : { id, via: 'd' };
  const n = parseInt(st, 10), v = !!m[4];
  return { itemId: tg.id, via: tg.via, qty: Math.max(1, Math.min(100, Math.round(Number(qty)) || 1)), cond: Math.max(1, Math.min(100, Math.round(Number(cond)) || 100)),
    ammo: v && n >= 0 ? Math.min(n, 9999) : -1, amount: !v && n > 1 ? Math.min(n, 9999) : 0, att: [], peer };
}

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
  const ACCLEAR_FILE = path.join(DATA_DIR, 'hub-acclear.json');
  let acClearedAt = 0; try { acClearedAt = Number(JSON.parse(fs.readFileSync(ACCLEAR_FILE, 'utf8')).at) || 0; } catch (e) {}
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
      const ia = itemSpawn(g.itemId, g.qty, g.cond, g.st, p.id); if (ia) sendAc('item', ia);
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
      if (url.pathname === '/admin/items') return res.end(JSON.stringify({ items: ITEMS_META }));
      if (url.pathname === '/admin/state') {
        const S = hostState || {}; const out = { online: !!host && !!hostState, age: hostStateAt ? Date.now() - hostStateAt : null, gifts };
        ['name', 'closedMsg', 'fps', 'mem', 'island', 'world', 'players', 'bans', 'kit', 'rules', 'pvp', 'ac', 'bunker', 'ferry', 'chat', 'kills', 'announce', 'lastSave', 'dedicated'].forEach(k => { if (S[k] !== undefined) out[k] = S[k]; });
        if (out.ac && Array.isArray(out.ac.log)) out.ac = Object.assign({}, out.ac, { log: out.ac.log.filter(e => Number(e.at) > acClearedAt) });   // log yang sudah dihapus dari web disembunyikan
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
      if (url.pathname === '/admin/give') {
        if (!host) return res.end('{"ok":false,"error":"host offline"}');
        const id = Math.round(Number(url.searchParams.get('id'))), peerId = String(url.searchParams.get('peer') || '');
        const p = peers.get(peerId); if (!p) return res.end('{"ok":false,"error":"pemain tidak ada"}');
        const ia = itemSpawn(id, url.searchParams.get('qty'), url.searchParams.get('cond'), url.searchParams.get('st'), peerId);
        if (!ia) return res.end('{"ok":false,"error":"game tidak bisa membuat barang ini"}');
        log(`admin: beri ${ia.qty}x #${id} (stack/ammo ${ia.amount || ia.ammo}) -> ${p.name}`); sendAc('item', ia);
        return res.end('{"ok":true}');
      }
      if (url.pathname === '/admin/gift') {
        const uid = String(url.searchParams.get('uid') || ''), itemId = Math.round(Number(url.searchParams.get('itemId')));
        const qty = Math.max(1, Math.min(50, Math.round(Number(url.searchParams.get('qty')) || 1))), cond = Math.max(1, Math.min(100, Math.round(Number(url.searchParams.get('cond')) || 100)));
        if (!uid || !(itemId > 0)) return res.end('{"ok":false,"error":"pemain atau barang tidak valid"}');
        if (!itemSpawn(itemId, 1, 100, '', 'x')) return res.end('{"ok":false,"error":"game tidak bisa membuat barang ini"}');
        if (gifts.length >= 100) return res.end('{"ok":false,"error":"antrean penuh"}');
        const p = ((hostState && hostState.players) || []).find(x => x.uid === uid && peers.has(x.id));
        gifts.push({ uid, name: String(url.searchParams.get('name') || '').slice(0, 30), itemId, qty, cond, st: String(url.searchParams.get('st') || '').slice(0, 6), ref: p && p.x != null ? { x: p.x, y: p.y } : null, off: !p, nul: !!p && p.x == null, at: Date.now() });
        saveGifts(); return res.end('{"ok":true}');
      }
      if (url.pathname === '/admin/acclear') {
        acClearedAt = Date.now(); try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(ACCLEAR_FILE, JSON.stringify({ at: acClearedAt })); } catch (e) {}
        log('admin: log keamanan dihapus dari web'); return res.end('{"ok":true}');
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
