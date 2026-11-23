// Hub relay MiniDayZ+ (protokol "np1"): hanya meneruskan pesan JSON antar game.
// Host (game dedicated di browser headless) dan semua pemain adalah klien WebSocket.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PROTO = 'np1';

// Aturan dunia yang bisa diatur dari halaman admin (kunci sama dengan panel host di game).
// type: 'b' = mati/nyala (0/1), 'n' = angka (min-max)
// Jenis NPC yang bisa dimunculkan panel admin game (NPC_LIST di game): zombi, boss, dan hewan
const CAR_KINDS = new Set([1, 2, 3, 4, 5]);          // UAZ, Volga, Humvee, KA, Tank
const NPC_KINDS = new Set([1, 3, 9, 4, 6, 22, 23, 13, 26, 14, 15, 21, 27]);
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
  // ---- baru di 2.3.9-mp27c ----
  ['mp_raid_level','Kesulitan raid: C-4 untuk menjebol gerbang kayu / logam (0-3)','n',0,3],
  ['mp_lock_battery_days','Baterai kunci digital: lama bertahan dalam hari game (0 = tidak pernah habis)','n',0,60],
  ['mp_loot_pct','Jumlah loot dunia (% dari normal)','n',0,300],
  ['mp_tg_bandits','Training grounds (lokasi 39): bandit, bukan terinfeksi','b'],
  ['mp_evac_travel','Lift evakuasi bunker: voting pindah ke pulau berikutnya (juga setelah pulau 6)','b'],
  ['mp_npc_off','Jenis NPC yang tidak pernah muncul','l'],
];
// kategori NPC untuk aturan mp_npc_off (NPC_CATS di game)
const NPC_OFF_OPTS = [['common','Terinfeksi biasa'],['riot','Terinfeksi riot'],['fast','Terinfeksi cepat'],['hazmat','Terinfeksi hazmat'],['army','Terinfeksi army'],['altyn','Altyn (boss army)'],
  ['shooter','Penembak dan pembawa senapan'],['spitter','Spitter'],['screamer','Screamer'],['tank','Tank'],['jumper','Jumper'],['fastboss','Boss cepat'],['witch','Witch'],
  ['fanger','Blood Fanger'],['bandit','Bandit'],['wildlife','Satwa liar']];

// Tabel barang dari game: [id, nama, kategori, s (0 = tidak bisa dibuat, 'p'/'d'/angka = cara/target spawn), v (1 = pakai AMMO/CHARGE)]
const ITEMS_META = [[1,"Canned Beans","General","d",0],[2,"Canned Tuna","General","d",0],[3,"Tactical Bacon","General","d",0],[4,"Rice","General","d",0],[5,"Tomato","General","d",0],[6,"Apple","General","d",0],[7,"Banana","General","d",0],[8,"Pipsi","General","d",0],[9,"Spite","General","d",0],[10,"Kvas","General","d",0],[11,"5.56x45 Ammo","General","d",0],[12,".45 ACP Ammo","General","d",0],[13,"7.62x54R Ammo","General","d",0],[14,"7.62x39 Ammo","General","d",0],[15,"5.45x39 Ammo","General","d",0],[16,".357 M Ammo","General","d",0],[17,"12 Cal Ammo","General","d",0],[18,"Bandage","General","d",0],[19,"IV Blood Bag","General","d",0],[20,"Flare","General","d",0],[21,"F1 Grenade","General","d",0],[22,"9V Battery","General","d",0],[23,"Campfire Kit","General","d",0],[24,"Matches","General","d",0],[25,"Whiskey","General","d",0],[26,"Rags","General","d",0],[27,"Cranberries","General","d",0],[28,"IV Saline Bag","General","d",0],[29,"Vitamins","General","d",0],[30,"Nota-Cola","General","d",0],[31,"Zucchini","General","d",0],[32,"Bell Pepper","General","d",0],[33,"Orange","General","d",0],[34,"Heatpack","General","d",0],[35,"Sewing Kit","General","d",0],[36,"Gun Cleaning Kit","General","d",0],[37,"Ashwood Stick","General","d",0],[38,"Wooden Sticks","General","d",0],[39,"Duct Tape","General","d",0],[40,"Burlap Sack","General","d",0],[41,"Rope","General","d",0],[42,"Hunting Knife","General","d",0],[43,"Army Knife","General","d",0],[44,"Butcher Knife","General","d",0],[45,"Adrenaline","General","d",0],[46,"Tetracycline","General","d",0],[47,"Tomato Seeds Pack","General","d",0],[48,"Bell Pepper Seeds Pack","General","d",0],[49,"Newspapers","General","d",0],[50,"Woodpiles","General","d",0],[51,"Crafted Arrow","General","d",0],[52,"Composite Arrow","General","d",0],[53,"Gasoline Can","General","d",0],[54,"Water Bottle","General","d",0],[55,"Canteen","General","d",0],[56,"Landmine","General","d",0],[57,"Bear Trap","General","d",0],[58,".22 LR Ammo","General","d",0],[59,"Car Tool Kit","General","d",0],[60,"Raw Meat","General","d",0],[61,"Roasted Meat","General","d",0],[62,"Nuka-Cola","General","d",0],[63,"Energy Drink","General","d",0],[64,"Equivalent Exchange","General","p",0],[65,"Item Carryover","General","p",0],[66,"Build Mode","General",0,0],[67,"Experience Shop","General",0,0],[68,"Zucchini Seeds Pack","General","d",0],[69,"9x19 P Ammo","General","d",0],[70,"Barbed Wire","General","d",0],[71,"Raw Rabbit","General","d",0],[72,"Roasted Rabbit","General","d",0],[73,"Cloudberries","General","d",0],[74,"Bilberries","General","d",0],[75,"Radio","General","d",0],[76,"RDS","General","d",0],[77,"PU Scope","General","d",0],[78,"PSO-1 Scope","General","d",0],[79,"ACOG Scope","General","d",0],[80,"5.45 Suppressor","General","d",0],[81,"5.56 Suppressor","General","d",0],[82,"Hacksaw","General","d",0],[83,"Bandolier","General","d",0],[84,"4-dial Codelock","General","d",0],[85,"MRE","General","d",0],[86,"Spinning Fishing Rod","General","d",0],[87,"Simple Fishing Rod","General","d",0],[88,"Protective Case","General","d",0],[89,"Magpul","General","d",0],[90,"Choke","General","d",0],[91,"Herring","General","d",0],[92,"Salmon","General","d",0],[93,"Ruffe","General","d",0],[94,"Perch","General","d",0],[95,"Small Grilled Fillet","General","d",0],[96,"Large Grilled Fillet","General","d",0],[97,"Psilocybin🍄","General","d",0],[98,"Long Range Scope","General","d",0],[99,"Claymore","General","d",0],[100,"9x18 M Ammo","General","d",0],[101,"9x39 Ammo","General","d",0],[102,"Molotov Cocktail","General","d",0],[103,"Flare Gun","General","d",0],[104,"50 BMG Ammo Can","General","d",0],[105,"40mm Grenade Shot","General","d",0],[106,"VOG-25 Grenade Shot","General","d",0],[107,"M203 Grenade Launcher","General","d",0],[108,"GP-25 Grenade Launcher","General","d",0],[109,"IV Kit","General","d",0],[110,"Whetstone","General","d",0],[111,"AK Grip","General","d",0],[112,"Rail Grip","General","d",0],[113,"Map Notes","General","d",0],[114,"Elderberries","General","d",0],[115,"Binoculars","General",0,0],[116,"Scout Handbook","General","d",0],[117,"Canvas","General","d",0],[118,"Adhesive Plaster","General","d",0],[119,"M18 Smoke Grenade","General","d",0],[120,"Soviet Cigarettes","General","d",0],[121,"Beer","General","d",0],[122,"Epoxy Glue","General","d",0],[123,"Fertilizer","General","d",0],[124,"Laser Sight","General","d",0],[125,"Lighter","General","d",0],[126,"Keycard","General","d",0],[127,"Makeshift Suppressor","General","d",0],[128,"AN/PVS-4 Scope","General","d",0],[129,"1PN51 Scope","General","d",0],[130,"C-MAG 5.56 Drum","General","d",0],[131,"7.62x39 Drum Mag","General","d",0],[132,"Frying Pan","General","p",0],[133,"Gas Mask","Helmet",250,0],[134,"Balaclava","Helmet",257,0],[135,"GP-5 Gas Mask","Helmet",271,0],[136,"Clown Mask","Helmet",272,0],[137,"Combat Gloves","General","d",0],[138,".308 Win Ammo","General","d",0],[139,"Sneakers","General","d",0],[140,"Woodland Boots","General","d",0],[141,"Assault Boots","General","d",0],[142,"Rifle Sling","General","d",0],[143,"Charcoal Tablets","General","d",0],[144,"Blowtorch","General","d",0],[145,"Ghillie Suit","Vest",407,0],[146,"Underbarrel Flashlight","General","d",0],[147,"Laser AK Grip","General","p",0],[148,"Laser Rail Grip","General","p",0],[149,"7.62/.308 Suppressor","General","d",0],[150,"Digital Codelock","General","d",0],[151,"FNX 45","Pistol","d",1],[152,"Colt 1911","Pistol","d",1],[153,"Magnum Revolver","Pistol","d",1],[154,"IZh-43","Rifle","d",1],[155,"Remington 870","Rifle","d",1],[156,"Mosin-Nagant","Rifle","d",1],[157,"SKS","Rifle","d",1],[158,"M4A1","Rifle","d",1],[159,"AKM","Rifle","d",1],[160,"AK-74","Rifle","d",1],[161,"AKs-74u","Rifle","d",1],[162,"L85A2","Rifle","d",1],[163,"Improvised Bow","Rifle","d",1],[164,"Hunting Crossbow","Rifle","d",1],[165,"Amphibia S","Pistol","d",1],[166,"Ruger 10/22 Sporter","Rifle","d",1],[167,"M92 Repeater","Rifle","d",1],[168,"SVD Dragunov","Rifle","d",1],[169,"MP5K","Rifle","d",1],[170,"Glock 17","Pistol","d",1],[171,"Sawn-Off IZh-43","Pistol","d",1],[172,"Mosin Obrez","Pistol","d",1],[173,"UMP-45","Rifle","d",1],[174,"RPK","Rifle","d",1],[175,"FN-FAL","Rifle","d",1],[176,"Engraved Colt","Pistol","d",1],[177,"AUG A1","Rifle","d",1],[178,"Saiga-12K","Rifle","d",1],[179,"MAC-10","Pistol","d",1],[180,"Mare's Leg","Pistol","d",1],[181,"PM","Pistol","d",1],[182,"PB","Pistol","d",1],[183,"PP-19 Bizon","Rifle","d",1],[184,"OTs-14 Groza","Rifle","d",1],[185,"VSS Vintorez","Rifle","d",1],[186,"SV-98","Rifle","d",1],[187,"Madsen","Rifle","d",1],[188,"AN-94","Rifle","d",1],[189,"Desert Eagle","Pistol","d",1],[190,"Silenced Remington","Rifle","d",1],[191,"Colt M16A2","Rifle","d",1],[192,"KRISS Vector","Rifle","d",1],[193,"M4A1","Rifle","d",1],[194,"AKM","Rifle","d",1],[195,"M70 Tundra","Rifle","d",1],[196,"Saiga-12K","Rifle","d",1],[197,"RPK","Rifle","d",1],[198,"M16A2","Rifle","d",1],[199,"AUG A1","Rifle","d",1],[200,"Pipe Wrench","Melee","d",0],[201,"Shovel","Melee","d",0],[202,"Hatchet","Melee","d",0],[203,"Baseball Bat","Melee","d",0],[204,"Fire Axe","Melee","d",0],[205,"Crowbar","Melee","d",0],[206,"Pickaxe","Melee","d",0],[207,"Pitchfork","Melee","d",0],[208,"Sledgehammer","Melee","d",0],[209,"Crusader Sword","Melee","d",0],[210,"Pan","Melee","d",0],[211,"Katana","Melee","d",0],[212,"Barbed Bat","Melee","d",0],[213,"Chainsaw","Melee","d",0],[214,"Generator","Melee","d",0],[215,"Metal Sheet","Melee","d",0],[216,"Torch","Melee","d",0],[217,"Green Barrel","General","d",0],[218,"Blue Barrel","General","d",0],[230,"Milkor MGL","Rifle","d",1],[231,"Blaze","Rifle","d",1],[232,"FAMAS F1","Rifle","d",1],[233,"Mini-14","Rifle","d",1],[234,"M79","Pistol","d",1],[235,"Obrez Blaze","Pistol","d",1],[236,"Longhorn","Pistol","d",1],[237,"AK-74","Rifle","d",1],[238,"AKs-74u","Rifle","d",1],[239,"Mini-UZI","Pistol","d",1],[240,"AS-VAL","Rifle","d",1],[241,"M249 SAW","Rifle","d",1],[242,"OSV-96","Rifle","d",1],[243,"M-40 Flamethrower","Rifle","d",1],[244,"Romero 77 Hatchet","Pistol","d",1],[245,"M134 Minigun","Rifle","d",1],[246,"PKM","Rifle","d",1],[247,"SCAR-17","Rifle","d",1],[248,"SIG MCX Spear","Rifle","d",1],[249,"KAC SR-25","Rifle","d",1],[250,"Gas Mask","Helmet","d",0],[251,"Army Helmet","Helmet","d",0],[252,"Moto Helmet","Helmet","d",0],[253,"Moto Helmet","Helmet","d",0],[254,"Warm Hat","Helmet","d",0],[255,"Beret","Helmet","d",0],[256,"Cap","Helmet","d",0],[257,"Balaclava","Helmet","d",0],[258,"Ushanka","Helmet","d",0],[259,"Hard Hat","Helmet","d",0],[260,"Headlamp","Helmet","d",1],[261,"Cowboy Hat","Helmet","d",0],[262,"Welding Mask","Helmet","d",0],[263,"Gorka Helmet","Helmet","d",0],[264,"Police Hat","Helmet","d",0],[265,"NVG","Helmet","d",1],[266,"Bandana","Helmet","d",0],[267,"Crusader Helm","Helmet","d",0],[268,"Pilot Helmet","Helmet","d",0],[269,"Altyn Helmet","Helmet","d",0],[270,"Rys-T Helmet","Helmet","d",0],[271,"GP-5 Gas Mask","Helmet","d",0],[272,"Clown Mask","Helmet","d",0],[273,"Assault Helmet","Helmet","d",0],[274,"Assault Helmet","Helmet","d",0],[275,"Assault Helmet","Helmet","d",0],[276,"Assault Helmet","Helmet","d",0],[277,"NV Altyn Helmet","Helmet","d",0],[278,"T65 Helmet","Helmet","d",0],[300,"Jeans","Pants","d",0],[301,"Worker Pants","Pants","d",0],[302,"Tracksuit Pants","Pants","d",0],[303,"Gorka Pants","Pants","d",0],[304,"Orel Pants","Pants","d",0],[305,"Paramedic Pants","Pants","d",0],[306,"Hunter Pants","Pants","d",0],[307,"Firefighter Pants","Pants","d",0],[350,"T-shirt","Outerwear","d",0],[351,"Shirt","Outerwear",352,0],[352,"Shirt","Outerwear","d",0],[353,"Raincoat","Outerwear","d",0],[354,"Jacket","Outerwear","d",0],[355,"Gorka Jacket","Outerwear","d",0],[356,"Hoodie","Outerwear","d",0],[357,"Hoodie","Outerwear","d",0],[358,"Trench Coat","Outerwear","d",0],[359,"Paramedic Jacket","Outerwear","d",0],[360,"Orel Jacket","Outerwear","d",0],[361,"Tracksuit Jacket","Outerwear","d",0],[362,"Dress","Outerwear","d",0],[363,"Down Jacket","Outerwear","d",0],[364,"Hunter Jacket","Outerwear","d",0],[365,"Sweater","Outerwear","d",0],[366,"Awesome Hoodie","Outerwear","d",0],[367,"Firefighter Jacket","Outerwear","d",0],[368,"Crusader Armor","Outerwear","d",0],[400,"Ballistic Vest","Vest","d",0],[401,"Press Vest","Vest","d",0],[402,"Assault Vest","Vest","d",0],[403,"High Capacity Vest","Vest","d",0],[404,"Kevlar Vest","Vest","d",0],[405,"Soviet Vest","Vest","d",0],[406,"Apron","Vest","d",0],[407,"Ghillie Suit","Vest","d",0],[408,"M Heavy Armor Vest","Vest","d",0],[409,"Chem Suit","Vest","d",0],[410,"M Kevlar CBRN Suit","Vest","d",0],[411,"M Heavy CBRN Suit","Vest","d",0],[412,"M Ghillie CBRN Suit","Vest","d",0],[413,"Hazmat Suit","Vest","d",0],[414,"NBC Suit","Vest","d",0],[415,"CBRN Suit","Vest","d",0],[450,"Taloon Backpack","Backpack","d",0],[451,"Hunting Backpack","Backpack","d",0],[452,"Mountain Backpack","Backpack","d",0],[453,"School Backpack","Backpack","d",0],[454,"Improvised Sling Bag","Backpack","d",0],[455,"Improvised Backpack","Backpack","d",0],[456,"Civilian Tent","Backpack","d",0],[457,"Tortilla Backpack","Backpack","d",0],[458,"Satchel","Backpack","d",0],[459,"Army Satchel","Backpack","d",0],[460,"Medical Satchel","Backpack","d",0],[461,"Supplies Stash","Backpack",0,0],[462,"Fuel Pack","Backpack","d",0],[463,"ALICE Backpack","Backpack","d",0],[700,"NBC Boots","General","d",0],[701,"NBC Gloves","General","d",0],[702,"Chem Suit","General","d",0],[703,"Hazmat Suit","Vest",413,0],[704,"12 Cal Drum Mag","General","d",0],[705,"Dye Bucket🎨","General","d",0],[706,"Headlamp","Helmet",260,1],[707,"NVG","Helmet",265,1],[708,"AI-2 Medkit","General","d",0],[709,"Dog Kennel","General","d",0],[710,"Stimulants","General","d",0],[711,"CBRN Suit","General","d",0],[712,"Nautical Chart","General","d",0],[713,"NBC Suit","General","d",0],[714,"Deerskin","General","p",0],[715,"C-MAG 5.45 Drum","General","d",0],[716,"Spiked Collar","General","d",0],[717,"Saddlebag","General","d",0],[718,"Egg","General","p",0],[719,"Raw Chicken","General","p",0],[720,"Cooked Chicken","General","p",0],[721,"Mini Sights","General","d",0],[722,"Pistol Suppressor","General","d",0],[723,"Pistol Flashlight","General","d",0],[724,"Fried Eggs","General","p",0],[725,"Pepper Steak","General","p",0],[726,"Shakshuka","General","p",0],[727,"Searchlight","General","d",0],[728,"Earthworm","General","d",0],[729,"VOG-25 Khatabka","General","p",0],[730,"FNX 45","Pistol",151,1],[731,"Colt 1911","Pistol",152,1],[732,"Magnum Revolver","Pistol",153,1],[733,"Amphibia S","Pistol",165,1],[734,"Glock 17","Pistol",170,1],[735,"Sawn-Off IZh-43","Pistol",171,1],[736,"Mosin Obrez","Pistol",172,1],[737,"Engraved Colt","Pistol",176,1],[738,"Mare's Leg","Pistol",180,1],[739,"PM","Pistol",181,1],[740,"PB","Pistol",182,1],[741,"Desert Eagle","Pistol",189,1],[742,"M79","Pistol",234,1],[743,"Obrez Blaze","Pistol",235,1],[744,"Longhorn","Pistol",236,1],[745,"MAC-10","Pistol",179,1],[746,"Mini-UZI","Pistol",239,1],[747,"C-4","General","d",0],[748,"Santa Hat","General","p",0],[749,"Christmas Presents","General","p",0],[750,"Human Meat","General","p",0],[751,"Cooked Human Meat","General","p",0],[752,"Satchel","General","d",0],[753,"Army Satchel","General","d",0],[754,"Medical Satchel","General","d",0],[755,"Weapon Case","General","d",0],[756,"Pistol Holster","General","d",0],[757,"Work Gloves","General","d",0],[758,"12.7x108 Ammo","General","d",0],[759,"Water Filter (Good)","General","d",0],[760,"Water Filter (empty)","General","p",0],[761,"Ammo Box","General","d",0],[762,"Ammo Box","General",761,0],[763,"Ammo Box","General",761,0],[764,"Ammo Box","General",761,0],[765,"Ammo Box","General",761,0],[766,"Ammo Box","General",761,0],[767,"Ammo Box","General",761,0],[768,"Ammo Box","General",761,0],[769,"Ammo Box","General",761,0],[770,"Ammo Box","General",761,0],[771,"Ammo Box","General",761,0],[772,"Ammo Box","General",761,0],[773,"Ammo Box","General",761,0],[774,"Ammo Box","General",761,0],[775,"Ammo Box","General",761,0],[776,"Ammo Box","General",761,0],[777,"Pear","General","d",0],[778,"Burlap Sack (Chicken)","General",0,0],[779,"Burlap Sack (Pig)","General",0,0],[780,"Raw Wolf Meat","General","d",0],[781,"Roasted Wolf Meat","General","d",0],[782,"Raw Bear Meat","General","d",0],[783,"Roasted Bear Meat","General","d",0],[784,"Bear Hide","General","d",0],[785,"Romero 77 Hatchet","Pistol",244,1],[786,"Jack o' Lantern","General","p",0],[787,"Witch Hat","General","p",0],[788,"Christmas Lights","General","p",0],[789,"NVG P45","Helmet","d",1],[790,"NVG P45","Helmet",789,1],[791,"Assault Helmet P45","Helmet","d",0],[792,"Assault Helmet P45","Helmet","d",0],[793,"Pox Vial","General","d",0],[794,"40mm Pox Grenade","General","d",0],[795,"Lockpick","General","d",0],[796,"Flag Pole Kit","General","d",0],[797,"Zenit RK-1 Tactical AK Laser Grip","General","d",0],[798,"Zenit RK-1 Tactical Laser Grip","General","d",0],[799,"AFG-2 Angled AK Laser Grip","General","d",0],[800,"AFG-2 Angled Laser Grip","General","d",0],[801,"Hera Arms CQR Gen 1.0 Front AK Laser Grip","General","d",0],[802,"Hera Arms CQR Gen 1.0 Front Laser Grip","General","d",0],[803,"Fortis Shift AK Laser Grip","General","d",0],[804,"Fortis Shift Laser Grip","General","d",0],[805,"Zenit RK-1 Tactical Grip","General","d",0],[806,"AFG-2 Angled Grip","General","d",0],[807,"Hera Arms CQR Gen 1.0 Front Grip","General","d",0],[808,"Fortis Shift Grip","General","d",0],[809,"Holographic Sight","General","d",0],[810,"Trijicon MRO 1x25 RDS 3x Magnifier Sight","General","d",0],[811,"HoloSun AEM Holosight","General","d",0],[812,"Fortis Shift AK Grip","General","d",0],[813,"AFG-2 Angled AK Grip","General","d",0],[814,"Zenit RK-1 Tactical AK Grip","General","d",0],[815,"Hera Arms CQR Gen 1.0 Front AK Grip","General","d",0],[816,"Sig Sauer Spear QD Suppressor","General","d",0],[817,"PMAG D-50","General","d",0],[818,"Leupold Mark 5HD Scope (Black)","General","d",0],[819,"Leupold Mark 5HD Scope (Tan)","General","d",0],[820,"Harris Bipod","General","d",0],[1001,"Rusty Bolts","General","d",0],[1002,"Hex Nuts","General","d",0],[1003,"Metal Washers","General","d",0],[1004,"Nails","General","d",0],[1005,"Screws","General","d",0],[1006,"Ball Bearing","General","d",0],[1007,"Steel Spring","General","d",0],[1008,"Scrap Metal","General","d",0],[1009,"Copper Wire","General","d",0],[1010,"Insulated Wires","General","d",0],[1011,"Electrical Tape","General","d",0],[1012,"Duct Tape","General","d",0],[1013,"Cable Ties","General","d",0],[1014,"Electrical Fuse","General","d",0],[1015,"Light Bulb","General","d",0],[1016,"Spark Plug","General","d",0],[1017,"AA Battery","General","d",0],[1018,"D Battery","General","d",0],[1019,"Ceramic Insulator","General","d",0],[1020,"Rechargeable Battery Pack","General","d",0],[1021,"Circuit Board","General","d",0],[1022,"RAM Module","General","d",0],[1023,"Processor","General","d",0],[1024,"Broken Smartphone","General","d",0],[1025,"Cracked LCD Panel","General","d",0],[1026,"Computer Fan","General","d",0],[1027,"Hard Drive","General","d",0],[1028,"Power Supply Unit","General","d",0],[1029,"Electric Motor","General","d",0],[1030,"Electrical Relay","General","d",0],[1031,"Capacitors","General","d",0],[1032,"Transformer","General","d",0],[1033,"Wrench","General","d",0],[1034,"Pliers","General","d",0],[1035,"Screwdriver","General","d",0],[1036,"Hammer","General","d",0],[1037,"Hacksaw","General","d",0],[1038,"Measuring Tape","General","d",0],[1039,"Metal File","General","d",0],[1040,"Hand Drill","General","d",0],[1041,"Empty Tin Can","General","d",0],[1042,"Crushed Aluminium Can","General","d",0],[1043,"Empty Glass Bottle","General","d",0],[1044,"Broken Glass","General","d",0],[1045,"Silica Gel Packet","General","d",0],[1046,"Rubber Hose","General","d",0],[1047,"Rubber Scraps","General","d",0],[1048,"Worn Tyre Chunk","General","d",0],[1049,"Pressure Gauge","General","d",0],[1050,"Valve Wheel","General","d",0],[1051,"Pipe Elbow","General","d",0],[1052,"Rusty Pipe","General","d",0],[1053,"Bicycle Chain","General","d",0],[1054,"Gear Cog","General","d",0],[1055,"Padlock","General","d",0],[1056,"Key Ring","General","d",0],[1057,"Sewing Thread","General","d",0],[1058,"Fabric Scraps","General","d",0],[1059,"Leather Scraps","General","d",0],[1060,"Rope","General","d",0],[1061,"Soap","General","d",0],[1062,"Toothpaste","General","d",0],[1063,"Empty Oil Tin","General","d",0],[1064,"Air Filter","General","d",0],[1065,"Gold Wristwatch","General","d",0],[1066,"Silver Pocket Watch","General","d",0],[1067,"Gold Chain","General","d",0],[1068,"Ruby Ring","General","d",0],[1069,"Pearl Necklace","General","d",0],[1070,"Golden Brooch","General","d",0],[1071,"Silver Bracelet","General","d",0],[1072,"Gold Ingot","General","d",0],[1073,"Silver Ingot","General","d",0],[1074,"Old Coins","General","d",0],[1075,"Banknote Roll","General","d",0],[1076,"Leather Wallet","General","d",0],[1077,"Passport","General","d",0],[1078,"Classified Documents","General","d",0],[1079,"Red Access Keycard","General","d",0],[1080,"Blue Access Keycard","General","d",0],[1081,"USB Flash Drive","General","d",0],[1082,"SD Memory Card","General","d",0],[1083,"Solid-State Drive","General","d",0],[1084,"Graphics Card","General","d",0],[1085,"Handheld Radio","General","d",0],[1086,"Digital Camera","General","d",0],[1087,"Camera Lens","General","d",0],[1088,"Handheld Game Console","General","d",0],[1089,"Radiation Dosimeter","General","d",0],[1090,"Digital Multimeter","General","d",0],[1091,"Compass","General","d",0],[1092,"Binoculars (broken)","General","d",0],[1093,"Brass Telescope","General","d",0],[1094,"Stopwatch","General","d",0],[1095,"Security Key Fob","General","d",0],[1096,"GPS Receiver","General","d",0],[1097,"Golden Cat Figurine","General","d",0],[1098,"Bronze Horse Figurine","General","d",0],[1099,"Wooden Bear Figurine","General","d",0],[1100,"Porcelain Teacup","General","d",0],[1101,"Silver Spoon","General","d",0],[1102,"Brass Candlestick","General","d",0],[1103,"Jade Pendant","General","d",0],[1104,"Purple Gemstone","General","d",0],[1105,"Coffee Bag","General","d",0],[1106,"Tea Box","General","d",0],[1107,"Chocolate Bar","General","d",0],[1108,"Sugar Packet","General","d",0],[1109,"Chewing Gum","General","d",0],[1110,"Cigarette Carton","General","d",0],[1111,"Cigar Case","General","d",0],[1112,"Matchbox","General","d",0],[1113,"Fuel Conditioner","General","d",0],[1114,"Gun Oil","General","d",0],[1115,"Sewing Kit","General","d",0],[1116,"Copper Foil","General","d",0],[1117,"Silicone Sealant","General","d",0],[1118,"Instant Glue","General","d",0],[1119,"Polishing Paste","General","d",0],[1120,"Metal Rivets","General","d",0],[1121,"Document Pouch","General","d",0],[1122,"Technical Blueprint","General","d",0],[1123,"Microfilm Reel","General","d",0],[1124,"Cassette Tape","General","d",0],[1125,"VHS Tape","General","d",0],[1126,"Floppy Disk","General","d",0],[1127,"Military Dog Tags","General","d",0],[1128,"Stamp Album","General","d",0],[1129,"Sterile Swab Tube","General","d",0],[1130,"Specimen Jar","General","d",0],[1131,"Petri Dish","General","d",0],[1132,"Test Tube Rack","General","d",0],[1133,"Microscope Slide Box","General","d",0],[1134,"Glass Pipette","General","d",0],[1135,"Graduated Cylinder","General","d",0],[1136,"Conical Flask","General","d",0],[1137,"Amber Reagent Vial","General","d",0],[1138,"Litmus Paper Booklet","General","d",0],[1139,"Chromatography Strip Tin","General","d",0],[1140,"Glass Stirring Rod","General","d",0],[1141,"Porcelain Crucible","General","d",0],[1142,"Mortar and Pestle","General","d",0],[1143,"Glass Funnel","General","d",0],[1144,"Laboratory Powder Scoop","General","d",0],[1145,"Surgical Scissors","General","d",0],[1146,"Hemostat Forceps","General","d",0],[1147,"Precision Tweezers","General","d",0],[1148,"Scalpel","General","d",0],[1149,"Dental Mirror","General","d",0],[1150,"Dental Probe","General","d",0],[1151,"Stethoscope","General","d",0],[1152,"Otoscope","General","d",0],[1153,"Pulse Oximeter","General","d",0],[1154,"Digital Thermometer","General","d",0],[1155,"Blood Pressure Cuff","General","d",0],[1156,"Ophthalmoscope","General","d",0],[1157,"Reflex Hammer","General","d",0],[1158,"Tongue Depressor Pack","General","d",0],[1159,"Dental Crown","General","d",0],[1160,"Denture Case","General","d",0],[1161,"Saline IV Bag","General","d",0],[1162,"Blood Bag","General","d",0],[1163,"IV Drip Tubing","General","d",0],[1164,"Sterile Syringe","General","d",0],[1165,"Sterile Needle Packet","General","d",0],[1166,"Suture Kit","General","d",0],[1167,"Tourniquet","General","d",0],[1168,"Medical Splint","General","d",0],[1169,"Instant Cold Pack","General","d",0],[1170,"Heat Patch","General","d",0],[1171,"Burn Gel Sachet","General","d",0],[1172,"Alcohol Wipe Sachet","General","d",0],[1173,"Inhaler","General","d",0],[1174,"Nasal Spray","General","d",0],[1175,"Eye Drops","General","d",0],[1176,"Dental Cement Pot","General","d",0],[1177,"Protective Goggles","General","d",0],[1178,"Surgical Glove Pack","General","d",0],[1179,"Bouffant Cap","General","d",0],[1180,"Shoe Cover Pack","General","d",0],[1181,"Folded Sterile Drape","General","d",0],[1182,"Folded Laboratory Apron","General","d",0],[1183,"Biohazard Sample Case","General","d",0],[1184,"Film Radiation Badge","General","d",0],[1185,"Microscope Objective","General","d",0],[1186,"Centrifuge Rotor","General","d",0],[1187,"Microscope Eyepiece","General","d",0],[1188,"Vacuum Flask Stopper","General","d",0],[1189,"Rubber Lab Stopper","General","d",0],[1190,"Test Tube Brush","General","d",0],[1191,"Reagent Bottle Caps","General","d",0],[1192,"Specimen Transport Envelope","General","d",0],[1193,"Ratchet Driver","General","d",0],[1194,"Socket Set Case","General","d",0],[1195,"Hex Key Set","General","d",0],[1196,"Bolt Cutters","General","d",0],[1197,"Crowbar","General","d",0],[1198,"Pipe Wrench","General","d",0],[1199,"Wire Strippers","General","d",0],[1200,"Tin Snips","General","d",0],[1201,"Chisel","General","d",0],[1202,"Centre Punch","General","d",0],[1203,"Bench Vise","General","d",0],[1204,"G Clamp","General","d",0],[1205,"Spirit Level","General","d",0],[1206,"Vernier Calipers","General","d",0],[1207,"Soldering Iron","General","d",0],[1208,"Solder Spool","General","d",0],[1209,"Drill Bit Set","General","d",0],[1210,"Grinding Disc","General","d",0],[1211,"Cutting Disc","General","d",0],[1212,"Sandpaper Sheets","General","d",0],[1213,"Wire Brush","General","d",0],[1214,"Welding Electrode Bundle","General","d",0],[1215,"Propane Cylinder","General","d",0],[1216,"Blowtorch Head","General","d",0],[1217,"Hydraulic Jack","General","d",0],[1218,"Pulley Block","General","d",0],[1219,"Turnbuckle","General","d",0],[1220,"Carabiner","General","d",0],[1221,"Steel Cable Reel","General","d",0],[1222,"Chain Hook","General","d",0],[1223,"Lifting Shackle","General","d",0],[1224,"Lifting Strap","General","d",0],[1225,"Plumbing Tee","General","d",0],[1226,"Pipe Flange","General","d",0],[1227,"Water Tap","General","d",0],[1228,"Brass Coupler","General","d",0],[1229,"Radiator Cap","General","d",0],[1230,"Thermostat Housing","General","d",0],[1231,"Engine Piston","General","d",0],[1232,"Connecting Rod","General","d",0],[1233,"Camshaft","General","d",0],[1234,"Crankshaft","General","d",0],[1235,"Alternator","General","d",0],[1236,"Starter Motor","General","d",0],[1237,"Clutch Plate","General","d",0],[1238,"Brake Pads","General","d",0],[1239,"Brake Disc","General","d",0],[1240,"Fuel Filter","General","d",0],[1241,"Ceramic Tile","General","d",0],[1242,"Clay Brick","General","d",0],[1243,"Cement Bag","General","d",0],[1244,"Plaster Bag","General","d",0],[1245,"Roofing Shingles","General","d",0],[1246,"Insulation Foam","General","d",0],[1247,"Plywood Boards","General","d",0],[1248,"Fibreglass Roll","General","d",0],[1249,"Gunpowder Jar","General","d",0],[1250,"Sulphur Bag","General","d",0],[1251,"Coal Lump","General","d",0],[1252,"Charcoal Lump","General","d",0],[1253,"Lead Scrap","General","d",0],[1254,"Zinc Scrap","General","d",0],[1255,"Steel Rebar Bundle","General","d",0],[1256,"Aluminium Extrusion","General","d",0],[1257,"Wedding Photograph","General","d",0],[1258,"Portrait Frame","General","d",0],[1259,"Military Medal","General","d",0],[1260,"Award Ribbon","General","d",0],[1261,"Enamel Pin","General","d",0],[1262,"Sheriff Badge","General","d",0],[1263,"Hockey Mask","General","d",0],[1264,"Ceramic Vase","General","d",0],[1265,"Harmonica","General","d",0],[1266,"Music Box","General","d",0],[1267,"Chess Knight","General","d",0],[1268,"Domino Tiles","General","d",0],[1269,"Playing Cards","General","d",0],[1270,"Dice Pair","General","d",0],[1271,"Puzzle Cube","General","d",0],[1272,"Yo-Yo","General","d",0],[1273,"Toothbrush","General","d",0],[1274,"Comb","General","d",0],[1275,"Folding Razor","General","d",0],[1276,"Shaving Brush","General","d",0],[1277,"Razor Blade Pack","General","d",0],[1278,"Nail Clippers","General","d",0],[1279,"Hand Mirror","General","d",0],[1280,"Hair Clip","General","d",0],[1281,"Dishcloth","General","d",0],[1282,"Cleaning Sponge","General","d",0],[1283,"Steel Wool","General","d",0],[1284,"Scouring Powder Tin","General","d",0],[1285,"Detergent Packet","General","d",0],[1286,"Laundry Powder Box","General","d",0],[1287,"Beeswax Block","General","d",0],[1288,"Shoe Polish Tin","General","d",0],[1289,"Empty Food Jar","General","d",0],[1290,"Can Opener","General","d",0],[1291,"Corkscrew","General","d",0],[1292,"Tea Strainer","General","d",0],[1293,"Fork","General","d",0],[1294,"Ladle","General","d",0],[1295,"Saucepan","General","d",0],[1296,"Mess Tin","General","d",0],[1297,"Fishing Line Spool","General","d",0],[1298,"Fish Hook Packet","General","d",0],[1299,"Fishing Sinkers","General","d",0],[1300,"Fishing Bobber","General","d",0],[1301,"Metal Fishing Lure","General","d",0],[1302,"Foam Fishing Float","General","d",0],[1303,"Folded Gill Net","General","d",0],[1304,"Folded Crab Trap","General","d",0],[1305,"Tent Peg Bundle","General","d",0],[1306,"Folded Tarpaulin","General","d",0],[1307,"Rolled Sleeping Mat","General","d",0],[1308,"Emergency Foil Blanket","General","d",0],[1309,"Mosquito Net","General","d",0],[1310,"Survival Whistle","General","d",0],[1311,"Signal Mirror","General","d",0],[1312,"Hand Warmer Packet","General","d",0],[1313,"Empty Map Case","General","d",0],[1314,"Waterproof Notebook","General","d",0],[1315,"Pencil Bundle","General","d",0],[1316,"Fountain Pen","General","d",0],[1317,"Ink Bottle","General","d",0],[1318,"Magnifying Glass","General","d",0],[1319,"Old Hardcover Book","General","d",0],[1320,"Binocular Case","General","d",0],[1321,"Rigid Solar Panel","General","d",0],[1322,"Folding Solar Panel","General","d",0],[1323,"Cracked Solar Panel","General","d",0],[1324,"Loose Photovoltaic Cell","General","d",0],[1325,"Solar Mounting Rail","General","d",0],[1326,"Panel Tilt Bracket","General","d",0],[1327,"Solar Junction Box","General","d",0],[1328,"MC4 Connector Pair","General","d",0],[1329,"PWM Charge Controller","General","d",0],[1330,"MPPT Charge Controller","General","d",0],[1331,"Power Inverter","General","d",0],[1332,"DC-DC Converter","General","d",0],[1333,"DC Circuit Breaker","General","d",0],[1334,"Inline Fuse Holder","General","d",0],[1335,"Busbar Block","General","d",0],[1336,"Grounding Rod","General","d",0],[1337,"Deep-Cycle Battery","General","d",0],[1338,"Lithium Storage Battery","General","d",0],[1339,"Battery Isolator Switch","General","d",0],[1340,"Battery Terminal Clamps","General","d",0],[1341,"Heavy Battery Leads","General","d",0],[1342,"Battery Balancer Board","General","d",0],[1343,"Panel-Mount Voltmeter","General","d",0],[1344,"Battery Hydrometer","General","d",0],[1345,"Compact Wind Turbine","General","d",0],[1346,"Micro Water Turbine","General","d",0],[1347,"Hand-Crank Dynamo","General","d",0],[1348,"Thermoelectric Module","General","d",0],[1349,"Pedal Generator","General","d",0],[1350,"Generator Pull Starter","General","d",0],[1351,"Generator Regulator Module","General","d",0],[1352,"Generator Carbon Brushes","General","d",0],[1353,"Extension Cord Reel","General","d",0],[1354,"Outdoor Power Strip","General","d",0],[1355,"Weatherproof Socket","General","d",0],[1356,"Terminal Strip","General","d",0],[1357,"Crimp Terminal Box","General","d",0],[1358,"Cable Gland Set","General","d",0],[1359,"Heat-Shrink Tubing","General","d",0],[1360,"Electrical Conduit Bend","General","d",0],[1361,"LED Work Light","General","d",0],[1362,"Solar Lantern","General","d",0],[1363,"Motion Detector","General","d",0],[1364,"Photocell Sensor","General","d",0],[1365,"Timer Switch","General","d",0],[1366,"Float Switch","General","d",0],[1367,"Thermostat Switch","General","d",0],[1368,"Electrical Enclosure","General","d",0],[1369,"Submersible Water Pump","General","d",0],[1370,"Diaphragm Water Pump","General","d",0],[1371,"Inline Water Strainer","General","d",0],[1372,"Sediment Filter Cartridge","General","d",0],[1373,"Ceramic Water Filter","General","d",0],[1374,"Rainwater Diverter","General","d",0],[1375,"Drip Irrigation Nozzle","General","d",0],[1376,"Hose Quick Connector","General","d",0],[1377,"Foldable Antenna","General","d",0],[1378,"Coaxial Cable","General","d",0],[1379,"PoE Injector","General","d",0],[1380,"Ethernet Switch","General","d",0],[1381,"Wireless Access Point","General","d",0],[1382,"Ceramic Heating Element","General","d",0],[1383,"Power Resistor","General","d",0],[1384,"Copper Heat Sink","General","d",0],[1385,"Red Key","General","d",0],[1386,"Blue Key","General","d",0],[1387,"Green Key","General","d",0],[1388,"Yellow Key","General","d",0],[1389,"Orange Key","General","d",0],[1390,"White Key","General","d",0],[1391,"Purple Key","General","d",0],[1392,"Black Key","General","d",0],[1393,"Rusty Key","General","d",0]];
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
  let rmeta = {};                  // 'meta' dari host: lvl, rows, time, region, host (dipakai roomInfo)
  let hostState = null, hostStateAt = 0, itemsLive = null;   // status host yang dikirim tiap 2 detik ({t:'state'})
  let gifts = [];                                            // antrean hadiah: diberikan saat pemain muncul lagi / respawn

  // ---- fitur admin: hak admin per UID perangkat (disimpan di file), diberikan lewat host ----
  const ADMIN_KEYS = String(process.env.ADMIN_KEY || '').split(',').map(x => x.trim()).filter(x => x.length >= 6);   // beberapa kunci dipisah koma: satu per admin
  const ADMIN_KEY = ADMIN_KEYS.length ? ADMIN_KEYS[0] : '';
  const DATA_DIR = process.env.DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(__dirname, '.data'));
  const ADMIN_FILE = path.join(DATA_DIR, 'hub-admins.json');
  const adminUids = new Set(String(process.env.ADMIN_UIDS || '').split(',').map(x => x.trim()).filter(Boolean));
  try { JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')).forEach(u => adminUids.add(String(u))); } catch (e) {}
  const ISLAND_FILE = path.join(DATA_DIR, 'hub-islands.json');
  let islandLabels = {}; try { const j = JSON.parse(fs.readFileSync(ISLAND_FILE, 'utf8')); if (j && typeof j === 'object') islandLabels = j; } catch (e) {}
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
  // perintah yang butuh posisi admin (npc): dikirim atas nama admin yang sedang hidup di game, hasilnya muncul di sebelahnya
  function sendAcAs(fromId, c, a) { if (host) send(host.ws, { t: 'msg', from: String(fromId), tag: 'ac', data: JSON.stringify({ c, a }) }); }
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
<div style="background:#8a2b2b;color:#fff;padding:10px;border-radius:8px;margin-bottom:10px;font:15px system-ui"><b>panel.html tidak ditemukan.</b> Ini halaman admin sederhana. Upload <code>panel.html</code> ke repo (satu folder dengan hub.js), lalu jalankan <code>git pull</code> di Codespace. Tidak perlu restart server.</div>
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

  // ---- sama dengan hub resmi (hub.cjs): info ruang dan daftar pemain yang dikirim ke game ----
  function roomInfo() {
    const m = rmeta || {};
    return { id: room.id, name: room.name, max: room.ded ? room.max - 1 : room.max, pvp: room.pvp, locked: room.locked,
      players: room.ded ? peers.size : 1 + peers.size, since: room.at, host: m.host || (host && host.name) || '',
      lvl: m.lvl === undefined ? null : m.lvl, rows: m.rows || 0, time: m.time === undefined ? null : m.time, region: m.region || room.region || '',
      entry: room.entry || 0, queue: queue.length, ded: !!room.ded, itemAck: room.itemAck ? 1 : 0, secureRelay: room.secureRelay ? 1 : 0, gv: room.gv || '' };
  }
  function playersOf() { return [{ id: 'h', name: host ? host.name : '' }].concat([...peers.values()].map(p => ({ id: p.id, name: p.name }))); }
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
    send(ws, { t: 'welcome', id, host: false, room: roomInfo(), players: playersOf(), name: p.name, now: Date.now() });
    // host menerima UID dan alamat pemain (ban, panel admin); pemain lain hanya nama (seperti hub resmi)
    everyone().forEach(x => { if (x.ws !== ws) send(x.ws, x === host ? { t: 'joined', id, name: p.name, uid: p.uid, ip } : { t: 'joined', id, name: p.name }); });
    log(`+ ${p.name} (${id}) uid=${p.uid || '-'} ${ip}  [${peers.size}/${room.max}]`);
    if (api.onPlayers) api.onPlayers(peers.size);
    if (p.uid && adminUids.has(p.uid)) setTimeout(() => { if (peers.has(id)) sendAc('admin', { peer: id, on: true }); }, 1500);
  }

  function pumpQueue() {
    while (queue.length && host && 1 + peers.size < room.max) { const q = queue.shift(); if (q.ws.readyState === 1) admit(q.ws, q.hello, q.ip); }
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
      room = { id: 'r1', name: String(i.name || 'MiniDayZ server').slice(0, 90), max: Math.max(2, Math.min(120, Number(i.max) || 10)), pvp: !!i.pvp, locked: !!password,
        lan: !!i.lan, entry: Math.max(0, Math.min(120, Number(i.entry) || 0)), region: String(i.region || '').slice(0, 40), ded: !!i.ded,
        itemAck: !!i.itemAck, secureRelay: !!i.secureRelay, gv: String(h.gv || '').slice(0, 24), at: Date.now() };
      host = { ws, id: 'h', name: String(h.name || 'Server').slice(0, 24), uid: String(h.uid || ''), info: i };
      rmeta = { region: room.region };
      ws.mdz = host; ws.mdzHost = true;
      send(ws, { t: 'welcome', id: 'h', host: true, room: roomInfo(), players: playersOf(), now: Date.now() });
      log(`HOST aktif: "${room.name}" max=${room.max} pvp=${room.pvp} locked=${room.locked} versi game=${room.gv || '?'}`);
      return pumpQueue();
    }
    // klien
    if (!host) return refuse(ws, 'no_host');
    if (String(h.gv || '') !== String(room.gv || '')) return refuse(ws, 'version', 'server ' + (room.gv || 'older') + ', this game ' + (h.gv || 'older'));
    if (room.locked && String(h.pw || '') !== password) return refuse(ws, 'password');
    if (1 + peers.size >= room.max) {                                  // host selalu memakai satu slot (seperti hub resmi)
      if (queue.length >= 50) return refuse(ws, 'full');
      queue.push({ ws, hello: h, ip }); ws.queued = true; return pumpQueue();
    }
    admit(ws, h, ip);
  }

  // pose pemain ('st'): pemain dalam jarak 2200 unit menerima tiap pose; yang lebih jauh hanya tiap 1 detik atau saat penampilannya berubah
  function stateFor(source, target, data, at) {
    if (target === host || !source.xy || !target.xy || Math.hypot(source.xy[0] - target.xy[0], source.xy[1] - target.xy[1]) <= 2200) return true;
    const look = String(data).split('|').slice(2).join('|'), cache = target.farState || (target.farState = {}), last = cache[source.id];
    if (!last || at - last[0] >= 1000 || last[1] !== look) { cache[source.id] = [at, look]; return true; }
    return false;
  }
  const behind = x => (x.ws.bufferedAmount || 0) > 64 * 1024;
  const flushT = setInterval(() => everyone().forEach(x => { const p = x && x.stPend; if (!p || behind(x)) return; x.stPend = null; for (const k in p) { if (x.ws.readyState === 1) x.ws.send(p[k]); } }), 100);
  function refuse(ws, reason, text) { send(ws, { t: 'refused', reason, text }); setTimeout(() => { try { ws.close(); } catch (e) {} }, 50); }

  function onMessage(ws, m) {
    const me = ws.mdz; if (!me) return;
    // perlindungan banjir: pemain yang mengirim lebih dari 900 pesan atau 6 MB dalam 3 detik diputus (host tidak dibatasi)
    if (!ws.mdzHost && !ws.flooded) {
      const t = Date.now(); if (!ws.fw || t - ws.fw > 3000) { ws.fw = t; ws.fm = 0; ws.fb = 0; }
      ws.fm++; ws.fb += JSON.stringify(m).length;
      if (ws.fm > 900 || ws.fb > 6 * 1024 * 1024) { ws.flooded = true; log(`flood ${me.id}: ${ws.fm} pesan, ${ws.fb} byte / 3 dtk`); refuse(ws, 'flood'); return; }
    }
    if (ws.flooded) return;
    if (m.t === 'ping') return send(ws, { t: 'pong', ts: m.ts });
    if (m.t === 'kick' && ws.mdzHost) { kickPeer(m.id, m.reason, m.text); return; }
    if (m.t === 'meta' && ws.mdzHost) {
      const d = m.data || {};
      rmeta = { lvl: d.lvl === null || d.lvl === undefined ? undefined : Number(d.lvl), rows: Number(d.rows) || 0, time: d.time === null || d.time === undefined ? undefined : Number(d.time),
        region: String(d.region || '').slice(0, 40), host: String(d.host || '').slice(0, 24) };
      return;
    }
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
      const out = { t: 'msg', from: me.id, tag: String(m.tag), data: m.data };
      const to = String(m.to || (ws.mdzHost ? 'all' : 'host'));          // tanpa 'to': host -> semua, pemain -> host (seperti hub resmi)
      if (out.tag === 'st') { const a = String(m.data).split('|'), x = Number(a[0]), y = Number(a[1]); if (a.length >= 6 && isFinite(x) && isFinite(y)) me.xy = [x, y]; }
      if (to === 'all') {
        const wire = JSON.stringify(out), at = Date.now();
        everyone().forEach(x => {
          if (x.ws === ws || x.ws.readyState !== 1) return;
          if (out.tag === 'st' && !stateFor(me, x, m.data, at)) return;                          // pemain jauh: pose tiap 1 detik saja
          if (out.tag === 'st' && (x.stPend || behind(x))) { (x.stPend || (x.stPend = {}))[me.id] = wire; }  // koneksi lambat: simpan pose terbaru saja
          else x.ws.send(wire);
        });
      }
      else if (to === 'host' || to === 'h') { if (host && host.ws !== ws) send(host.ws, out); }
      else { const p = peers.get(to); if (p) send(p.ws, out); }
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
    if (api.onPlayers) api.onPlayers(peers.size);
    pumpQueue();
  }

  function serveStatic(req, res) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/admin')) {
      if (!ADMIN_KEY) { res.writeHead(404); return res.end('admin nonaktif'); }
      if (!keyOk(url.searchParams.get('key') || '')) { return setTimeout(() => { res.writeHead(403); res.end('kunci salah'); }, 800); }
      if (url.pathname === '/admin') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        try { return res.end(fs.readFileSync(path.join(__dirname, 'panel.html'))); } catch (e) { return res.end(ADMIN_PAGE); }
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
        log(`admin: ${c} ${JSON.stringify(a).slice(0, 120)}`);
        if (c === 'save' && api.forceSave) { Promise.resolve(api.forceSave()).catch(() => {}).then(() => { sendAc(c, a); res.end('{"ok":true}'); }); return; }
        sendAc(c, a); return res.end('{"ok":true}');
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
      if (url.pathname === '/admin/npc') {
        const kind = Math.round(Number(url.searchParams.get('kind'))), count = Math.max(1, Math.min(20, Math.round(Number(url.searchParams.get('count'))) || 1));
        const peerId = String(url.searchParams.get('peer') || '');
        if (!host) return res.end('{"ok":false,"error":"host offline"}');
        if (!NPC_KINDS.has(kind)) return res.end('{"ok":false,"error":"jenis NPC tidak dikenal"}');
        const ap = ((hostState && hostState.players) || []).find(x => x.id === peerId && peers.has(x.id));
        if (!ap || !ap.admin) return res.end('{"ok":false,"error":"pilih admin yang sedang online"}');
        if (ap.x == null) return res.end('{"ok":false,"error":"admin itu belum punya posisi (mati / baru masuk)"}');
        log(`admin: npc #${kind} x${count} di sebelah ${ap.name}`); sendAcAs(peerId, 'npc', { kind, count });
        return res.end('{"ok":true}');
      }
      if (url.pathname === '/admin/car') {
        const kind = Math.round(Number(url.searchParams.get('kind'))), peerId = String(url.searchParams.get('peer') || '');
        if (!host) return res.end('{"ok":false,"error":"host offline"}');
        if (!CAR_KINDS.has(kind)) return res.end('{"ok":false,"error":"kode kendaraan harus 1-5"}');
        const ap = ((hostState && hostState.players) || []).find(x => x.id === peerId && peers.has(x.id));
        if (!ap || !ap.admin) return res.end('{"ok":false,"error":"pilih admin yang sedang online"}');
        if (ap.x == null) return res.end('{"ok":false,"error":"admin itu belum punya posisi (mati / baru masuk)"}');
        log(`admin: kendaraan #${kind} di sebelah ${ap.name}`); sendAcAs(peerId, 'car', { kind });
        return res.end('{"ok":true}');
      }
      if (url.pathname === '/admin/weather') {      // tanpa mode = baca; cerah / hujan / badai = isi variabel; bebas = lepas kunci
        if (!host) return res.end('{"ok":false,"error":"host offline"}');
        if (!api.weatherFn) return res.end('{"ok":false,"error":"fitur ini butuh start.js terbaru"}');
        const mode = url.searchParams.get('mode'), lock = url.searchParams.get('lock') === '1';
        const W = { cerah: { Rain: 0, rains_level: 0 }, hujan: { Rain: 1, rains_level: 1 }, badai: { Rain: 1, rains_level: 2 } };
        if (mode && mode !== 'bebas' && !W[mode]) return res.end('{"ok":false,"error":"mode cuaca tidak dikenal"}');
        if (mode) log(`admin: cuaca -> ${mode}${lock ? ' (dikunci)' : ''}`);
        Promise.resolve(api.weatherFn(mode && mode !== 'bebas' ? W[mode] : null, lock, mode === 'bebas')).then(r => res.end(JSON.stringify(Object.assign({ ok: true }, r)))).catch(e => res.end(JSON.stringify({ ok: false, error: String(e && e.message || e).slice(0, 200) })));
        return;
      }
      if (url.pathname === '/admin/difficulty') {   // tanpa level = baca; dengan level = ubah pada dunia yang berjalan
        if (!host) return res.end('{"ok":false,"error":"host offline"}');
        if (!api.difficultyFn) return res.end('{"ok":false,"error":"fitur ini butuh start.js terbaru"}');
        const lv = url.searchParams.get('level');
        Promise.resolve(api.difficultyFn(lv ? String(lv).slice(0, 20) : null)).then(r => {
          if (lv) { log(`admin: kesulitan -> ${r.level}`); sendAc('say', { text: 'Tingkat kesulitan diubah ke ' + r.level }); }
          res.end(JSON.stringify(Object.assign({ ok: true }, r)));
        }).catch(e => res.end(JSON.stringify({ ok: false, error: String(e && e.message || e).slice(0, 200) })));
        return;
      }
      if (url.pathname === '/admin/vehicle') {     // cari kendaraan bertipe tNNN yang sudah ada, pindahkan ke sebelah admin
        const code = String(url.searchParams.get('code') || '').trim().toLowerCase(), peerId = String(url.searchParams.get('peer') || '');
        if (!host) return res.end('{"ok":false,"error":"host offline"}');
        if (!/^t\d{1,5}$/.test(code)) return res.end('{"ok":false,"error":"kode harus berbentuk t diikuti angka, misalnya t1700"}');
        if (!api.vehicleFn) return res.end('{"ok":false,"error":"fitur ini butuh start.js terbaru"}');
        const ap = ((hostState && hostState.players) || []).find(x => x.id === peerId && peers.has(x.id));
        if (!ap || !ap.admin) return res.end('{"ok":false,"error":"pilih admin yang sedang online"}');
        if (ap.x == null) return res.end('{"ok":false,"error":"admin itu belum punya posisi (mati / baru masuk)"}');
        log(`admin: kendaraan ${code} dipindahkan ke sebelah ${ap.name}`);
        Promise.resolve(api.vehicleFn(code, Math.round(ap.x + 150), Math.round(ap.y))).then(r => res.end(JSON.stringify(Object.assign({ ok: true }, r)))).catch(e => res.end(JSON.stringify({ ok: false, error: String(e && e.message || e).slice(0, 200) })));
        return;
      }
      if (url.pathname === '/admin/tpx') {        // bring = pemain dibawa ke admin, goto = admin ke pemain
        const mode = url.searchParams.get('mode'), target = String(url.searchParams.get('peer') || ''), adminId = String(url.searchParams.get('admin') || '');
        if (!host) return res.end('{"ok":false,"error":"host offline"}');
        if (mode !== 'bring' && mode !== 'goto') return res.end('{"ok":false,"error":"mode salah"}');
        const ps = (hostState && hostState.players) || [];
        const ap = ps.find(x => x.id === adminId && peers.has(x.id)), tp = ps.find(x => x.id === target && peers.has(x.id));
        if (!ap || !ap.admin) return res.end('{"ok":false,"error":"pilih admin yang sedang online"}');
        if (!tp) return res.end('{"ok":false,"error":"pemain tidak ada"}');
        if (ap.x == null || tp.x == null) return res.end('{"ok":false,"error":"admin atau pemain belum punya posisi"}');
        log(`admin: ${mode} ${tp.name} <-> ${ap.name}`); sendAcAs(adminId, mode, { peer: target });
        return res.end('{"ok":true}');
      }
      if (url.pathname === '/admin/backups') return res.end(JSON.stringify({ ok: true, enabled: !!api.control, backups: api.control ? api.control.list() : [], busy: api.control ? !!api.control.busy : false, last: api.control ? api.control.last || null : null }));
      if (url.pathname === '/admin/backup' || url.pathname === '/admin/restore') {
        if (!api.control) return res.end('{"ok":false,"error":"fitur cadangan belum aktif (pakai start.js terbaru + backup.js)"}');
        if (api.control.busy) return res.end('{"ok":false,"error":"sedang memproses cadangan lain"}');
        const isRestore = url.pathname === '/admin/restore';
        if (isRestore && url.searchParams.get('confirm') !== '1') return res.end('{"ok":false,"error":"konfirmasi diperlukan"}');
        const job = isRestore ? api.control.restore(String(url.searchParams.get('name') || '')) : api.control.backup(String(url.searchParams.get('label') || ''), url.searchParams.get('push') !== '0');
        Promise.resolve(job).then(r => res.end(JSON.stringify(Object.assign({ ok: true }, r)))).catch(e => res.end(JSON.stringify({ ok: false, error: String(e && e.message || e).slice(0, 300) })));
        return;
      }
      if (url.pathname === '/admin/islands') return res.end(JSON.stringify({ ok: true, labels: islandLabels, current: hostState && hostState.island !== undefined ? hostState.island : null }));
      if (url.pathname === '/admin/islandlabel') {      // beri nama pulau 1-9 (mis. "salju"); kosong = hapus
        const n = Math.round(Number(url.searchParams.get('n')));
        if (!(n >= 1 && n <= 9)) return res.end('{"ok":false,"error":"pulau harus 1-9"}');
        const label = String(url.searchParams.get('label') || '').replace(/[<>"'`]/g, '').trim().slice(0, 24);
        if (label) islandLabels[n] = label; else delete islandLabels[n];
        try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(ISLAND_FILE, JSON.stringify(islandLabels)); } catch (e) {}
        return res.end(JSON.stringify({ ok: true, labels: islandLabels }));
      }
      if (url.pathname === '/admin/giftdel') { const i = Number(url.searchParams.get('i')); if (i >= 0 && i < gifts.length) { gifts.splice(i, 1); saveGifts(); } return res.end('{"ok":true}'); }
      if (url.pathname === '/admin/rulesdata') return res.end(JSON.stringify({ online: !!host, values: rulesNow, defs: RULE_DEFS.map(d => ({ k: d[0], label: d[1], type: d[2], min: d[3], max: d[4], opts: d[2] === 'l' ? NPC_OFF_OPTS.map(o => ({ id: o[0], label: o[1] })) : undefined })) }));
      if (url.pathname === '/admin/setrule') {
        const def = RULE_DEFS.find(d => d[0] === url.searchParams.get('k')); const v = url.searchParams.get('v');
        if (!host) return res.end('{"ok":false,"error":"host offline"}');
        if (!def) return res.end('{"ok":false,"error":"aturan tidak dikenal"}');
        if (def[2] === 'l') {                       // daftar kategori dipisah koma (mis. mp_npc_off = "bandit,army")
          const ids = String(v || '').split(',').map(x => x.trim()).filter(Boolean);
          if (ids.some(x => !NPC_OFF_OPTS.some(o => o[0] === x))) return res.end('{"ok":false,"error":"kategori tidak dikenal"}');
          const val = [...new Set(ids)].join(',');
          log(`admin: aturan ${def[0]} = ${val || 'bawaan'}`); sendAc('rule', { key: def[0], value: val }); return res.end('{"ok":true}');
        }
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
    if (url.pathname === '/rooms') {            // dibaca daftar "online" di game (refreshOnline): satu ruang, atau kosong bila host belum siap
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(host && room ? [roomInfo()] : []));
    }
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
  server.on('close', () => { clearInterval(hb); clearInterval(flushT); });
  const api = { server, wss, roomNow: () => (host && room ? roomInfo() : null), control: null, weatherFn: null, vehicleFn: null, difficultyFn: null, onPlayers: null, forceSave: null, sendSave: () => sendAc('save', {}), state: () => ({ host: !!host, peers: peers.size, queue: queue.length }) };
  return api;
}

module.exports = { createHub, PROTO, pushLog };
if (require.main === module) {
  const port = Number(process.env.PORT) || 7777;
  createHub().server.listen(port, '0.0.0.0', () => console.log('hub di port', port));
}
