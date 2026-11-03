'use strict';

/* ── CONSTANTES ───────────────────────── */
const FUELS = {
  gazole:{ p:'gazole_prix', m:'gazole_maj', r:'gazole_rupture_type', l:'Gazole', es:'Precio Gasoleo A' },
  e10:   { p:'e10_prix',    m:'e10_maj',    r:'e10_rupture_type',    l:'E10',    es:'Precio Gasolina 95 E10' },
  sp95:  { p:'sp95_prix',   m:'sp95_maj',   r:'sp95_rupture_type',   l:'SP95',   es:'Precio Gasolina 95 E5' },
  sp98:  { p:'sp98_prix',   m:'sp98_maj',   r:'sp98_rupture_type',   l:'SP98',   es:'Precio Gasolina 98 E5' },
  e85:   { p:'e85_prix',    m:'e85_maj',    r:'e85_rupture_type',    l:'E85',    es:'Precio Gasolina 95 E85' },
  gplc:  { p:'gplc_prix',   m:'gplc_maj',   r:'gplc_rupture_type',   l:'GPLc',   es:'Precio Gases licuados del petróleo' },
};
const K = { f:'pm_fuel', r:'pm_radius', mo:'pm_model', tk:'pm_tank', co:'pm_conso', lv:'pm_level', nav:'pm_nav' };

// Applications d'itinéraire. « only » : proposée seulement sur cette plateforme
const UA = navigator.userAgent;
const IS_IOS = /iPad|iPhone|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints>1);
const IS_ANDROID = /Android/.test(UA);
const NAV_APPS = {
  google:{ l:'Google Maps', url:(la,lo)=>`https://www.google.com/maps/dir/?api=1&destination=${la},${lo}&travelmode=driving` },
  waze:  { l:'Waze',        url:(la,lo)=>`https://waze.com/ul?ll=${la},${lo}&navigate=yes` },
  apple: { l:'Plans',       url:(la,lo)=>`https://maps.apple.com/?daddr=${la},${lo}&dirflg=d`, only:IS_IOS||/Macintosh/.test(UA) },
  geo:   { l:'Autre app',   url:(la,lo)=>`geo:${la},${lo}?q=${la},${lo}`, only:IS_ANDROID }, // sélecteur Android
};
const NAV_LIST = Object.keys(NAV_APPS).filter(k=>NAV_APPS[k].only!==false);

const API = {
  fr:    'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records',
  names: 'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/prix_des_carburants_j_7/records',
  es:    'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/FiltroProvincia/',
  osrm:  'https://routing.openstreetmap.de/routed-car/table/v1/driving/',
  // Recherche de lieu : communes (gère les débuts de nom, « bord » → Bordeaux)
  // + adresses (Géoplateforme, remplace api-adresse.data.gouv.fr dépréciée)
  communes: 'https://geo.api.gouv.fr/communes',
  geocode:  'https://data.geopf.fr/geocodage/search',
  completion: 'https://data.geopf.fr/geocodage/completion',
};
// Champs demandés à l'API (évite select=* qui renvoie services, horaires…)
const FR_FIELDS = ['id','adresse','ville','geom',
  ...Object.values(FUELS).flatMap(f=>[f.p,f.m,f.r])].join(',');
const PAGE = 100;         // maximum autorisé par l'API Opendatasoft
const OSRM_BATCH = 250;   // destinations par requête (au-delà, URL trop longue)
const OSRM_GAP = 1100;    // ms entre deux requêtes : le serveur public limite à 1/s
const REFRESH_AFTER = 15*60*1000; // actualise au retour sur l'appli après 15 min

const SPAIN_BORDERS = [
  { name:'Hendaye / Irun',  lat:43.358, lon:-1.787, prov:'20' }, // Guipúzcoa
  { name:'Col du Somport',  lat:42.795, lon:-0.530, prov:'22' }, // Huesca
  { name:'Puigcerdà',       lat:42.430, lon: 1.928, prov:'25' }, // Lleida
  { name:'La Jonquera',     lat:42.462, lon: 2.851, prov:'17' }, // Girona
];
const ES_RADIUS   = 50;  // km autour du passage frontière
const ES_MAX_DIST = 200; // km : au-delà, le bouton Espagne n'est pas proposé
const ES_TOP      = 6;   // stations espagnoles affichées

/* ── STATE ────────────────────────────── */
const $ = id => document.getElementById(id);
const S = {
  fuel:   localStorage.getItem(K.f) || 'gazole',
  radius: +( localStorage.getItem(K.r) || 10 ),
  sort:   'litre',
  lat: null, lon: null, time: 0,
  raw: [],
  names: {},   // { idStation -> enseigne }
  road: {},    // { "lat,lon" -> km par la route depuis la position actuelle }
  esCache: {}, // { codeProvince -> { time, list } }
  animate: false,
  wantPlein: false, // tri « Plein total » demandé avant d'avoir un profil
  nav: NAV_LIST.includes(localStorage.getItem(K.nav)) ? localStorage.getItem(K.nav) : 'ask',
  routing: '',      // '' | 'pending' | 'failed' : état du calcul des distances
  place: null,      // { label, lat, lon } : lieu choisi à la place du GPS (non mémorisé)
  placeItems: [],
  car: {
    model: localStorage.getItem(K.mo) || '',
    tank:  +( localStorage.getItem(K.tk) ) || 0,
    conso: +( localStorage.getItem(K.co) ) || 0,
    level: +( localStorage.getItem(K.lv) ) || 0, // fraction déjà dans le réservoir
  },
};
if(!FUELS[S.fuel]) S.fuel = 'gazole';
let searchSeq = 0; // ignore les réponses d'une recherche dépassée

/* ── OUTILS ───────────────────────────── */
function hav(a,b,c,d){
  const R=6371,r=x=>x*Math.PI/180,dA=r(c-a),dB=r(d-b);
  const x=Math.sin(dA/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dB/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function esc(s){
  return String(s??'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
const fmt = (n,d) => n.toFixed(d).replace('.',',');  // décimales à la française
const num = v => parseFloat(String(v??'').replace(',','.')); // accepte "6,5"
const titleCase = s => s.trim().replace(/\S+/g, w => w.charAt(0).toUpperCase()+w.slice(1).toLowerCase());
const ptKey = (lat,lon) => `${(+lat).toFixed(5)},${(+lon).toFixed(5)}`;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const hasCar = () => S.car.tank>0 && S.car.conso>0;

async function fetchJson(url, label, timeout=30000){
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(), timeout);
  const res = await fetch(url,{headers:{Accept:'application/json'}, signal:ctrl.signal})
    .finally(()=>clearTimeout(timer));
  if(!res.ok) throw new Error(`${label} : erreur ${res.status}`);
  return res.json();
}

// Requête doublée : sans réponse après `after` ms, on relance la même requête
// (paramètre _r différent, sinon le navigateur attend la première) et on garde
// la première réponse. Utile pour l'API des communes, dont ~1 requête sur 3
// met ~10 s au lieu de 0,2 s.
function hedgedJson(url, label, after=1200){
  let timer;
  const second = new Promise(r=>{ timer=setTimeout(r,after); })
    .then(()=>fetchJson(url+'&_r=2', label, 15000));
  const first = fetchJson(url, label, 15000)
    .then(v=>{ clearTimeout(timer); return v; }); // en cas d'échec, la 2e part quand même
  return Promise.any([first, second]);
}

// Distance par la route si connue, sinon à vol d'oiseau
function distTo(lat,lon){
  const road = S.road[ptKey(lat,lon)];
  return road
    ? { km:road.km, min:road.min, road:true }
    : { km:hav(S.lat,S.lon,lat,lon), road:false };
}
function distTag(d, suffix=''){
  return d.road
    ? `<span class="tag" title="Par la route, durée estimée sans trafic">📍 ${fmt(d.km,1)} km · ${Math.max(1,Math.round(d.min))} min${suffix}</span>`
    : `<span class="tag" title="Distance à vol d'oiseau">📍 ~${fmt(d.km,1)} km${suffix}</span>`;
}

// Coût du plein (litres manquants) + carburant consommé pour l'aller-retour
function cost(prix, km){
  if(!hasCar()) return null;
  const litres = S.car.tank*(1-S.car.level);
  const fuel = litres*prix;
  const trip = (2*km/100)*S.car.conso*prix;
  return { litres, fuel, trip, total:fuel+trip };
}

/* ── API FRANCE (paginée) ─────────────── */
async function fetchFrance(lat, lon, radius){
  const base = API.fr+
    `?where=distance(geom,geom'POINT(${lon}%20${lat})',${radius}km)`+
    `&select=${FR_FIELDS}&limit=${PAGE}&timezone=Europe%2FParis`;
  const page = offset => fetchJson(`${base}&offset=${offset}`,'API France');
  // 1re page pour connaître total_count, puis le reste en parallèle
  const first = await page(0);
  const offsets = [];
  for(let o=PAGE;o<(first.total_count||0);o+=PAGE) offsets.push(o);
  const rest = await Promise.all(offsets.map(page));
  return [first,...rest].flatMap(j=>j.results||[]);
}

/* ── ENSEIGNES (dataset J-7 opendatasoft) ── */
async function enrichNames(ids){
  ids = ids.filter(id=>!(id in S.names));
  // Lots de 100 ids (limite de l'API), requêtes en parallèle
  const batches = [];
  for(let i=0;i<ids.length;i+=PAGE) batches.push(ids.slice(i,i+PAGE));
  await Promise.all(batches.map(async batch=>{
    try {
      const where = batch.map(id=>`id="${id}"`).join(' OR ');
      const json = await fetchJson(
        `${API.names}?select=id,brand,name&where=${encodeURIComponent(where)}&limit=${PAGE}`,'Enseignes');
      (json.results||[]).forEach(r=>{
        const id = String(r.id||'');
        const label = r.brand||r.name||null;
        if(id && label) S.names[id] = label.trim();
      });
    } catch(_){} // les noms sont un bonus : on garde l'adresse en repli
  }));
}

/* ── DISTANCES ROUTIÈRES (OSRM) ───────── */
let osrmNext = 0; // instant au plus tôt de la prochaine requête

// Remplit S.road lot par lot ; onBatch() est appelé après chaque lot reçu.
// Renvoie true si tout a été calculé. En cas d'échec, les stations restantes
// gardent la distance à vol d'oiseau.
async function routeTo(points, seq, onBatch){
  // Les plus proches d'abord : le 1er lot (le seul rapide, le serveur ralentit
  // les requêtes rapprochées) couvre les stations les plus utiles
  const todo = [...new Map(points
    .filter(p=>!(ptKey(p.lat,p.lon) in S.road))
    .map(p=>[ptKey(p.lat,p.lon),p])).values()]
    .sort((a,b)=>hav(S.lat,S.lon,a.lat,a.lon)-hav(S.lat,S.lon,b.lat,b.lon));
  const lonLat = p => ptKey(p.lat,p.lon).split(',').reverse().join(',');
  const origin = lonLat({lat:S.lat,lon:S.lon});
  for(let i=0;i<todo.length;i+=OSRM_BATCH){
    const batch = todo.slice(i,i+OSRM_BATCH);
    const url = `${API.osrm}${[origin,...batch.map(lonLat)].join(';')}`+
      '?sources=0&annotations=distance,duration&skip_waypoints=true';
    let json = null;
    for(let attempt=0; attempt<2 && !json; attempt++){ // 1 nouvel essai si échec
      const start = Math.max(Date.now(), osrmNext);
      osrmNext = start+OSRM_GAP*(attempt+1);
      await sleep(start-Date.now());
      if(seq!==searchSeq) return false;
      try {
        const r = await fetchJson(url,'OSRM');
        if(r.code==='Ok') json = r;
      } catch(_){}
    }
    if(!json || seq!==searchSeq) return false;
    json.distances[0].slice(1).forEach((m,j)=>{
      const sec = json.durations[0][j+1];
      if(m!=null && sec!=null) S.road[ptKey(batch[j].lat,batch[j].lon)] = { km:m/1000, min:sec/60 };
    });
    onBatch();
  }
  return true;
}

/* ── SEARCH ───────────────────────────── */
async function search(){
  const seq=++searchSeq;
  const btn=$('btn');
  btn.disabled=true; btn.textContent=S.place?'🔄 Chargement…':'📍 Localisation…';
  skels();
  try {
    let lat, lon;
    if(S.place){ ({lat,lon}=S.place); }
    else { const pos=await geo(); lat=pos.coords.latitude; lon=pos.coords.longitude; }
    if(seq!==searchSeq) return;
    S.lat=lat; S.lon=lon;
    S.road={};
    btn.textContent='🔄 Chargement…';
    const raw=await fetchFrance(S.lat,S.lon,S.radius);
    if(seq!==searchSeq) return;
    S.raw=raw; S.time=Date.now(); S.animate=true;

    $('statusBar').classList.add('on');
    $('stTime').textContent=
      new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    render();

    // Compléments chargés en arrière-plan, la liste se met à jour à l'arrivée
    const rerender = ()=>{ if(seq===searchSeq) render(); };
    enrichNames(S.raw.map(r=>String(r.id||'')).filter(Boolean)).then(rerender);
    routeFrance(seq);
  } catch(e){ if(seq===searchSeq) showErr(e); }
  finally {
    if(seq===searchSeq){
      btn.disabled=false;
      btn.textContent='⛽ Actualiser';
    }
  }
}

function routeFrance(seq=searchSeq){
  setRouting('pending');
  routeTo(S.raw.filter(r=>r.geom).map(r=>({lat:r.geom.lat,lon:r.geom.lon})), seq,
    ()=>{ if(seq===searchSeq) render(); })
    .then(ok=>{ if(seq===searchSeq) setRouting(ok?'':'failed'); });
}
function setRouting(state){
  S.routing=state;
  const n=$('routeNote');
  n.className=state?'on '+state:'';
  n.innerHTML = state==='pending'
    ? 'Calcul des distances par la route…'
    : state==='failed'
      ? 'Distances à vol d’oiseau (~) : calcul par la route indisponible. <button type="button" id="routeRetry">Réessayer</button>'
      : '';
}

/* ── STATIONS FRANCE ──────────────────── */
function frStations(){
  const f=FUELS[S.fuel];
  return S.raw.map(r=>{
    const prix=parseFloat(r[f.p]);
    if(!prix||isNaN(prix)||!r.geom) return null;
    const {lat,lon}=r.geom;
    const d=distTo(lat,lon);
    let age=null, stale=false;
    const maj=r[f.m]?new Date(r[f.m]):null; // new Date(null) donnerait 1970
    if(maj&&!isNaN(maj)){
      const h=Math.round((Date.now()-maj)/3600000);
      age=h<1?'< 1h':h<24?`${h}h`:`${Math.round(h/24)}j`;
      stale=h>48;
    }
    const id=String(r.id||'');
    return {
      id, lat, lon, prix, d, age, stale, c:cost(prix,d.km),
      name: S.names[id] ? titleCase(S.names[id]) : (r.adresse||'Station'),
      addr: [r.adresse,r.ville].filter(Boolean).join(', '),
    };
  }).filter(Boolean);
}

/* ── RENDER ───────────────────────────── */
function render(){
  const f=FUELS[S.fuel];
  const stations=frStations();
  const sorted=[...stations].sort((a,b)=>{
    if(S.sort==='plein'&&a.c&&b.c) return a.c.total-b.c.total;
    if(S.sort==='proche') return a.d.km-b.d.km;
    if(S.sort==='cher')   return b.prix-a.prix;
    return a.prix-b.prix;
  });

  const ruptures=S.raw.filter(r=>r[f.r]==='temporaire').length;
  $('stLbl').textContent=
    `${sorted.length} station${sorted.length!==1?'s':''} · ${f.l}`+
    (ruptures?` · ${ruptures} en rupture`:'');

  const sb=$('sumBox'), list=$('list');
  list.classList.toggle('anim', S.animate); // anime seulement le 1er affichage
  S.animate=false;

  if(!sorted.length){
    sb.classList.remove('on');
    $('btnSpain').hidden=true;
    list.innerHTML=`<div class="void"><span class="e">🏜️</span><h3>Aucun résultat</h3><p>${S.raw.length} station${S.raw.length!==1?'s':''} dans ce rayon mais aucune ne vend du ${esc(f.l)}.<br>Changez de carburant ou augmentez le rayon.</p></div>`;
    return;
  }

  const pp=sorted.map(s=>s.prix);
  const mn=Math.min(...pp),mx=Math.max(...pp),avg=pp.reduce((a,b)=>a+b,0)/pp.length;

  sb.classList.add('on');
  let sh=`<div class="sum-grid">
    <div class="sum-item"><div class="sum-key">Moins cher</div><div class="sum-val lo">${fmt(mn,3)} €/L</div></div>
    <div class="sum-item"><div class="sum-key">Plus cher</div><div class="sum-val hi">${fmt(mx,3)} €/L</div></div>
    <div class="sum-item"><div class="sum-key">Moyenne</div><div class="sum-val">${fmt(avg,3)} €/L</div></div>
    <div class="sum-item"><div class="sum-key">Écart max</div><div class="sum-val">${fmt(mx-mn,3)} €/L</div></div>`;
  if(hasCar()){
    const best=Math.min(...stations.map(s=>s.c.total));
    sh+=`<div class="sum-div"></div>
    <div class="sum-item" style="grid-column:1/-1">
      <div class="sum-key">Meilleur plein estimé (${fmt(stations[0].c.litres,0)} L + trajet)</div>
      <div class="sum-val lo" style="font-size:1.1rem">${fmt(best,2)} €</div>
    </div>`;
  }
  sh+=`</div>`;
  sb.innerHTML=sh;

  list.innerHTML=sorted.map((s,i)=>card(s,i,mn)).join('');
  $('btnSpain').hidden = nearestBorder().distUser>ES_MAX_DIST;
}

function card(s,i,mn){
  const top=i===0&&S.sort!=='cher';
  const delta=s.prix-mn, pct=(mn>0?delta/mn*100:0);
  const dtag=delta<0.001
    ?`<span class="tag g">✓ Moins cher</span>`
    :pct<2?`<span class="tag a">+${fmt(pct,1)} %</span>`
          :`<span class="tag r">+${fmt(pct,1)} %</span>`;

  const plein=s.c
    ?`<div class="plein-strip">
      <span class="plein-lbl">Plein ${fmt(s.c.litres,0)} L + trajet</span>
      <div><span class="plein-amt">${fmt(s.c.total,2)}</span><span class="plein-eur">€</span></div>
    </div>`
    :'';

  return `<div class="card${top?' top':''}">
    <div class="card-main">
      <div class="rk">${i+1}</div>
      <div class="card-body">
        <div class="card-name">${esc(s.name)}</div>
        <div class="card-addr">${esc(s.addr)}</div>
      </div>
      <div class="card-price">
        <div class="p-main">${fmt(s.prix,3)}</div>
        <div class="p-unit">€ / litre</div>
      </div>
    </div>
    <div class="card-foot">
      <div class="tags">
        ${distTag(s.d)}
        ${s.age?`<span class="tag${s.stale?' r':''}" title="Prix déclaré il y a ${s.age}">Prix : ${s.age}</span>`:''}
        ${dtag}
      </div>
    </div>
    ${plein}
    ${navButton(s.lat,s.lon,s.name)}
  </div>`;
}

/* ── TRI / CARBURANT / NIVEAU ─────────── */
function setSort(v){
  if(v==='plein'&&!hasCar()){ S.wantPlein=true; openSheet('car'); return; }
  S.sort=v;
  document.querySelectorAll('#sortSeg .seg-btn').forEach(b=>{
    b.classList.toggle('on',b.dataset.sort===v);
    b.setAttribute('aria-pressed',b.dataset.sort===v);
  });
  if(S.raw.length) render();
}
function setFuel(v){
  S.fuel=v;
  localStorage.setItem(K.f,v);
  document.querySelectorAll('.pill').forEach(p=>{
    p.classList.toggle('on',p.dataset.fuel===v);
    p.setAttribute('aria-pressed',p.dataset.fuel===v);
  });
  if(S.raw.length) render();
}
function setLevel(v){
  S.car.level=v;
  localStorage.setItem(K.lv,v);
  document.querySelectorAll('#lvlSeg .seg-btn').forEach(b=>{
    b.classList.toggle('on',+b.dataset.lvl===v);
    b.setAttribute('aria-pressed',+b.dataset.lvl===v);
  });
  if(S.raw.length) render();
}

/* ── PROFIL VÉHICULE ──────────────────── */
function fillCarForm(){
  const c=S.car;
  $('fMod').value=c.model||'';
  $('fTank').value=c.tank||'';
  $('fConso').value=c.conso?fmt(c.conso,1):'';
  ['fTank','fConso'].forEach(id=>$(id).removeAttribute('aria-invalid'));
}
function saveProfile(e){
  e.preventDefault();
  const mo=$('fMod').value.trim();
  const tkRaw=$('fTank').value.trim(), coRaw=$('fConso').value.trim();
  const tk=num(tkRaw), co=num(coRaw);
  // Champ vide accepté (profil partiel), valeur hors bornes refusée
  const bad=(raw,v,min,max)=>raw!==''&&!(v>=min&&v<=max);
  const badTk=bad(tkRaw,tk,10,150), badCo=bad(coRaw,co,1,30);
  const mark=(id,b)=>b?$(id).setAttribute('aria-invalid','true'):$(id).removeAttribute('aria-invalid');
  mark('fTank',badTk); mark('fConso',badCo);
  if(badTk||badCo) return;

  S.car={...S.car, model:mo, tank:tk||0, conso:co||0};
  localStorage.setItem(K.mo,mo);
  localStorage.setItem(K.tk,tk||'');
  localStorage.setItem(K.co,co||'');
  document.activeElement?.blur(); // ferme le clavier mobile
  const wantPlein=S.wantPlein; // closeSheet() le remet à false
  updateCarUI(); closeSheet('car');
  if(wantPlein&&hasCar()) setSort('plein');
  else if(S.raw.length) render();
}
function resetProfile(){
  S.car={model:'',tank:0,conso:0,level:0};
  [K.mo,K.tk,K.co,K.lv].forEach(k=>localStorage.removeItem(k));
  if(S.sort==='plein') setSort('litre');
  updateCarUI(); closeSheet('car');
  if(S.raw.length) render();
}
function updateCarUI(){
  const c=S.car, has=!!(c.model||c.tank>0);
  $('dbadge').classList.toggle('on', has);
  $('carChip').classList.toggle('on', has);
  $('lvlRow').classList.toggle('on', c.tank>0);
  if(has){
    $('chipModel').textContent=c.model||'Mon véhicule';
    $('chipSpecs').textContent=
      [c.tank?`${c.tank} L`:'', c.conso?`${fmt(c.conso,1)} L/100`:''].filter(Boolean).join(' · ');
  }
  setLevel(c.level);
}

/* ── PANNEAUX (véhicule, Espagne, itinéraire) ── */
const SHEETS = { car:['carSheet','carOvl'], spain:['spainSheet','spainOvl'], nav:['navSheet','navOvl'], place:['placeSheet','placeOvl'] };
const opened = []; // pile : le choix d'itinéraire peut s'ouvrir par-dessus l'Espagne
const isOpen = name => opened.includes(name);

function openSheet(name){
  if(name==='car') fillCarForm();
  const [sh,ov]=SHEETS[name];
  $(ov).classList.add('on'); $(sh).classList.add('on');
  $(sh).scrollTop=0;
  $('scr').style.overflow='hidden';
  if(!isOpen(name)) opened.push(name);
}
function closeSheet(name=opened[opened.length-1]){
  if(!name||!isOpen(name)) return;
  const [sh,ov]=SHEETS[name];
  $(ov).classList.remove('on'); $(sh).classList.remove('on');
  opened.splice(opened.indexOf(name),1);
  if(!opened.length) $('scr').style.overflow='';
  if(name==='car') S.wantPlein=false;
}

// Glisser vers le bas pour fermer (quand le panneau est scrollé tout en haut)
function swipeToClose(name){
  const sh=$(SHEETS[name][0]);
  let y0=null, dy=0;
  sh.addEventListener('touchstart',e=>{
    y0 = sh.scrollTop<=0 ? e.touches[0].clientY : null; dy=0;
  },{passive:true});
  sh.addEventListener('touchmove',e=>{
    if(y0===null) return;
    dy=e.touches[0].clientY-y0;
    if(dy<=0){ sh.style.transform=''; sh.classList.remove('drag'); return; }
    e.preventDefault(); // bloque le rebond du scroll pendant le glissement
    sh.classList.add('drag');
    sh.style.transform=`translateY(${dy}px)`;
  },{passive:false});
  sh.addEventListener('touchend',()=>{
    if(y0===null) return;
    sh.classList.remove('drag');
    sh.style.transform='';
    if(dy>90) closeSheet(name);
    y0=null;
  });
}

/* ── LIEU DE RECHERCHE ──────────────── */
const fromWhere = () => S.place ? `de ${S.place.label}` : 'de vous';

function updatePlaceUI(){
  $('placeLbl').textContent = S.place ? S.place.label : 'Ma position';
  $('placeBtn').classList.toggle('custom', !!S.place);
}
function openPlace(){
  $('placeInput').value='';
  $('placeList').innerHTML='';
  $('placeGps').hidden=!S.place;
  openSheet('place');
  $('placeInput').focus({preventScroll:true}); // dans le geste : affiche le clavier mobile
}
function setPlace(place){
  S.place=place;
  updatePlaceUI();
  closeSheet('place');
  search();
}

let placeSeq=0, placeTimer=null;
function onPlaceInput(){
  clearTimeout(placeTimer);
  const q=$('placeInput').value.trim();
  if(q.length<3){ placeSeq++; $('placeList').innerHTML=''; return; }
  placeTimer=setTimeout(()=>findPlaces(q),300);
}
// Trois sources en parallèle, résultats affichés dès que l'une répond :
// - communes : meilleurs résultats, mais répond parfois en ~10 s
// - complétion Géoplateforme : rapide, comble l'attente (rate quelques communes)
// - adresses : seulement si la saisie ressemble à une adresse
function findPlaces(q){
  const seq=++placeSeq, found={communes:null, completion:null, addr:null};
  const show=()=>{ if(seq===placeSeq) renderPlaces(found); };
  const enc=encodeURIComponent(q);
  const looksLikeAddress=/\d|\s/.test(q); // « bord » seul ramènerait des rues nommées « Bord »
  const load=(key,url,map)=>hedgedJson(url,key)
    .then(r=>{ found[key]=map(r); })
    .catch(()=>{ found[key]=[]; })
    .finally(show);
  renderPlaces(found);
  load('communes', `${API.communes}?nom=${enc}&fields=nom,codeDepartement,centre&boost=population&limit=5`,
    r=>r.filter(c=>c.centre).map(c=>({
      label:c.nom, sub:`Commune · ${c.codeDepartement}`,
      lat:c.centre.coordinates[1], lon:c.centre.coordinates[0] })));
  load('completion', `${API.completion}?text=${enc}&type=PositionOfInterest&poiType=commune&maximumResponses=5`,
    r=>(r.results||[]).map(c=>({
      label:c.fulltext.split(',')[0].trim(), sub:`Commune · ${(c.zipcode||'').slice(0,2)}`,
      lat:c.y, lon:c.x })));
  if(looksLikeAddress) load('addr', `${API.geocode}?q=${enc}&limit=5`,
    r=>(r.features||[]).filter(f=>f.properties.score>0.5).map(f=>({
      label:f.properties.label, sub:f.properties.context||'',
      lat:f.geometry.coordinates[1], lon:f.geometry.coordinates[0] })));
  else found.addr=[];
}
function renderPlaces(found){
  const seen=new Set();
  S.placeItems=[...(found.communes||[]), ...(found.completion||[]), ...(found.addr||[])]
    .filter(p=>{ const k=p.label.toLowerCase(); return !seen.has(k)&&seen.add(k); })
    .slice(0,7);
  const pending=Object.values(found).some(v=>v===null);
  $('placeList').innerHTML = S.placeItems.length
    ? S.placeItems.map((p,i)=>`<button type="button" class="place-item" data-i="${i}">
        <span class="place-name">${esc(p.label)}</span><span class="place-sub">${esc(p.sub)}</span></button>`).join('')
      + (pending?'<div class="place-empty">Recherche…</div>':'')
    : `<div class="place-empty">${pending?'Recherche…':'Aucun lieu trouvé'}</div>`;
}

/* ── ITINÉRAIRE ──────────────────────── */
function navButton(lat,lon,name){
  const app=NAV_APPS[S.nav];
  if(!app) return `<div class="nav-row"><button type="button" class="nav-btn" data-nav="${lat},${lon}" data-name="${esc(name)}">🗺 Itinéraire</button></div>`;
  // geo: est intercepté par Android, pas besoin de nouvel onglet
  const tgt = S.nav==='geo' ? '' : ' target="_blank" rel="noopener"';
  const lbl = S.nav==='geo' ? '' : ` · ${app.l}`;
  return `<div class="nav-row"><a class="nav-btn" href="${esc(app.url(lat,lon))}"${tgt}>🗺 Itinéraire${lbl}</a></div>`;
}
function openNav(lat,lon,name){
  $('navSub').textContent=name||'';
  $('navRemember').checked=false;
  $('navList').innerHTML=NAV_LIST.map(k=>{
    const tgt = k==='geo' ? '' : ' target="_blank" rel="noopener"';
    return `<a class="nav-app" data-app="${k}" href="${esc(NAV_APPS[k].url(lat,lon))}"${tgt}>${NAV_APPS[k].l}</a>`;
  }).join('');
  openSheet('nav');
}
function setNav(v){
  S.nav=v;
  if(v==='ask') localStorage.removeItem(K.nav); else localStorage.setItem(K.nav,v);
  document.querySelectorAll('[data-set-nav]').forEach(b=>{
    b.classList.toggle('on',b.dataset.setNav===v);
    b.setAttribute('aria-pressed',b.dataset.setNav===v);
  });
  if(S.raw.length) render();
  if(isOpen('spain')&&S.lastSpain) renderSpain(...S.lastSpain);
}

/* ── HELPERS ──────────────────────────── */
function geo(){
  return new Promise((ok,fail)=>{
    if(!navigator.geolocation) return fail(new Error('Géolocalisation non disponible sur cet appareil.'));
    navigator.geolocation.getCurrentPosition(ok,fail,
      {enableHighAccuracy:true,timeout:14000,maximumAge:15000});
  });
}
function skels(){
  setRouting('');
  $('sumBox').classList.remove('on');
  $('btnSpain').hidden=true;
  $('list').innerHTML=Array(6).fill('<div class="skel"></div>').join('');
}
function showErr(e){
  let m=e?.message||'Erreur inconnue.';
  if(e?.code===1)m='Géolocalisation refusée. Autorisez la localisation pour ce site dans les réglages du navigateur.';
  else if(e?.code===2)m='Position indisponible. Vérifiez que la localisation est activée.';
  else if(e?.code===3)m='Délai de localisation dépassé. Réessayez.';
  else if(e instanceof TypeError)m='Connexion impossible. Vérifiez votre réseau.';
  setRouting('');
  $('sumBox').classList.remove('on');
  $('list').innerHTML=
    `<div class="void"><span class="e">⚠️</span><h3>Erreur</h3><p>${esc(m)}</p></div>`;
}

/* ── COMPARAISON ESPAGNE ──────────────── */
function nearestBorder(){
  return SPAIN_BORDERS
    .map(b=>({...b, distUser:hav(S.lat,S.lon,b.lat,b.lon)}))
    .sort((a,b)=>a.distUser-b.distUser)[0];
}

// Endpoint par province (~300 Ko) plutôt que l'Espagne entière (~12 Mo)
async function fetchSpainStations(prov){
  const TTL=5*60*1000, c=S.esCache[prov];
  if(c && Date.now()-c.time<TTL) return c.list;
  const json=await fetchJson(API.es+prov,'API Espagne');
  const list=json.ListaEESSPrecio||[];
  S.esCache[prov]={time:Date.now(), list};
  return list;
}

// Format espagnol : "1,749", coordonnées avec virgule
function parseSpain(rawList, border){
  const field=FUELS[S.fuel].es;
  return rawList.map(r=>{
    const lat=num(r['Latitud']), lon=num(r['Longitud (WGS84)']);
    if(isNaN(lat)||isNaN(lon)||!lat||!lon) return null;
    if(hav(border.lat,border.lon,lat,lon)>ES_RADIUS) return null;
    const prix=num(r[field]);
    if(!(prix>=0.3)) return null;
    return {
      name: titleCase(r['Rótulo']||'Station'),
      addr: [r['Dirección'],r['Municipio']].filter(Boolean).join(', '),
      prix, lat, lon,
    };
  }).filter(Boolean);
}

async function searchSpain(){
  if(S.lat===null) return;
  const seq=searchSeq;
  const btn=$('btnSpain');
  btn.disabled=true; btn.textContent='🔄 Chargement…';

  const border=nearestBorder();
  $('esSub').innerHTML=`Via <strong>${esc(border.name)}</strong> · frontière à ~${fmt(border.distUser,0)} km ${esc(fromWhere())}<br>
    Stations à moins de ${ES_RADIUS} km du passage frontière`;
  const cont=$('spainContent');
  cont.innerHTML='<div class="void" style="padding:40px 20px"><p>Chargement des stations espagnoles…</p></div>';
  openSheet('spain');

  try{
    const stations=parseSpain(await fetchSpainStations(border.prov), border);
    if(seq!==searchSeq) return;
    // Affichage immédiat (vol d'oiseau), puis mise à jour avec les distances par la route
    renderSpain(border, stations);
    routeTo(stations, seq, ()=>{
      if(isOpen('spain')&&seq===searchSeq) renderSpain(border, stations);
    });
  }catch(e){
    cont.innerHTML=`<div class="void" style="padding:40px 20px"><span class="e">⚠️</span><h3>Erreur</h3><p>${esc(e.message)}</p></div>`;
  }finally{
    btn.disabled=false; btn.textContent='🇪🇸 Comparer avec l\'Espagne';
  }
}

function renderSpain(border, list){
  S.lastSpain=[border, list]; // pour réafficher si le réglage d'itinéraire change
  const f=FUELS[S.fuel], car=S.car;
  const cont=$('spainContent');

  const stations=list.map(s=>{ const d=distTo(s.lat,s.lon); return {...s, d, c:cost(s.prix,d.km)}; });
  const byBest=(a,b)=>a.c&&b.c ? a.c.total-b.c.total : a.prix-b.prix;
  const top=stations.sort(byBest).slice(0,ES_TOP);

  if(!top.length){
    cont.innerHTML=`<div class="void" style="padding:30px 20px"><p>Aucune station ne vend de ${esc(f.l)} près de ${esc(border.name)}.</p></div>`;
    return;
  }

  let html='';
  const bestFr=frStations().sort(byBest)[0];
  const bestEs=top[0];
  if(bestFr){
    const useTotal=!!(bestFr.c&&bestEs.c);
    const vFr=useTotal?bestFr.c.total:bestFr.prix;
    const vEs=useTotal?bestEs.c.total:bestEs.prix;
    const diff=vFr-vEs, win=diff>0;
    const dec=useTotal?2:3, unit=useTotal?'€':'€/L';
    const breakdown=s=>useTotal
      ? `${fmt(s.c.fuel,2)} € carburant + ${fmt(s.c.trip,2)} € trajet (${fmt(2*s.d.km,0)} km A/R)`
      : esc(s.name);
    html+=`<div class="es-compare">
      <div class="es-compare-ttl">${useTotal
        ?`Plein ${fmt(bestEs.c.litres,0)} L + trajet A/R · ${esc(car.model||'votre véhicule')}`
        :`Meilleur prix · ${esc(f.l)}`}</div>
      <div class="es-compare-row">
        <div class="es-compare-item">
          <div class="es-compare-flag">🇫🇷 France</div>
          <div class="es-compare-val fr">${fmt(vFr,dec)} ${unit}</div>
          <div class="es-compare-sub">${breakdown(bestFr)}</div>
        </div>
        <div class="es-compare-sep">vs</div>
        <div class="es-compare-item">
          <div class="es-compare-flag">🇪🇸 Espagne</div>
          <div class="es-compare-val es">${fmt(vEs,dec)} ${unit}</div>
          <div class="es-compare-sub">${breakdown(bestEs)}</div>
        </div>
      </div>
      <div class="es-savings ${win?'win':'lose'}">
        ${useTotal
          ? (win ? `✅ Économie nette de ${fmt(diff,2)} € trajet inclus`
                 : `❌ ${fmt(-diff,2)} € de plus trajet inclus`)
          : (win ? `✅ ${fmt(diff,3)} €/L moins cher en Espagne`
                 : `❌ ${fmt(-diff,3)} €/L plus cher en Espagne`)}
      </div>
      ${useTotal?'':`<div class="es-compare-sub" style="text-align:center;margin-top:6px">Renseignez votre véhicule pour inclure le coût du trajet.</div>`}
    </div>`;
  }

  html+=`<div class="es-list">`;
  top.forEach((s,i)=>{
    const plein=s.c
      ? `<div class="es-plein">
          <div>
            <span class="es-plein-lbl">Plein ${fmt(s.c.litres,0)} L + trajet A/R</span>
            <div class="es-plein-breakdown">${fmt(s.c.fuel,2)} € + ${fmt(s.c.trip,2)} € trajet (${fmt(2*s.d.km,0)} km)</div>
          </div>
          <div><span class="es-plein-amt">${fmt(s.c.total,2)}</span><span class="plein-eur"> €</span></div>
        </div>`
      : '';
    html+=`<div class="es-card${i===0?' es-top':''}">
      <div class="es-card-main">
        <div class="es-rk">${i+1}</div>
        <div class="es-card-body">
          <div class="es-card-name">${esc(s.name)}</div>
          <div class="es-card-addr">${esc(s.addr)}</div>
        </div>
        <div class="es-card-price">
          <div class="es-p-main">${fmt(s.prix,3)}</div>
          <div class="es-p-unit">€ / litre</div>
        </div>
      </div>
      <div class="es-card-foot">
        ${distTag(s.d,' '+fromWhere())}
        <span class="tag" title="Distance à vol d'oiseau">🏁 ~${fmt(hav(border.lat,border.lon,s.lat,s.lon),1)} km de la frontière</span>
      </div>
      ${plein}
      ${navButton(s.lat,s.lon,s.name)}
    </div>`;
  });
  html+=`</div>`;
  cont.innerHTML=html;
}

/* ── INIT ─────────────────────────────── */
(function(){
  document.querySelectorAll('.pill').forEach(p=>
    p.addEventListener('click',()=>setFuel(p.dataset.fuel)));
  document.querySelectorAll('#sortSeg .seg-btn').forEach(b=>
    b.addEventListener('click',()=>setSort(b.dataset.sort)));
  document.querySelectorAll('#lvlSeg .seg-btn').forEach(b=>
    b.addEventListener('click',()=>setLevel(+b.dataset.lvl)));
  setFuel(S.fuel);

  const rs=$('rs');
  rs.value=S.radius;
  $('rv').textContent=S.radius;
  rs.addEventListener('input',()=>{ S.radius=+rs.value; $('rv').textContent=S.radius; });
  rs.addEventListener('change',()=>{
    localStorage.setItem(K.r,S.radius);
    if(S.lat!==null) search();
  });

  $('btn').addEventListener('click',search);
  $('btnSpain').addEventListener('click',searchSpain);
  $('carBtn').addEventListener('click',()=>openSheet('car'));
  $('carChip').addEventListener('click',()=>openSheet('car'));
  $('carForm').addEventListener('submit',saveProfile);
  $('resetBtn').addEventListener('click',resetProfile);
  $('carOvl').addEventListener('click',()=>closeSheet('car'));
  $('spainOvl').addEventListener('click',()=>closeSheet('spain'));
  document.querySelectorAll('[data-close]').forEach(b=>
    b.addEventListener('click',()=>closeSheet(b.closest('.sheet').dataset.name)));
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeSheet(); });
  $('navOvl').addEventListener('click',()=>closeSheet('nav'));
  swipeToClose('car'); swipeToClose('spain'); swipeToClose('nav');

  // Boutons « Itinéraire » (générés dans les listes) et réessai du calcul routier
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-nav]');
    if(b){ const [la,lo]=b.dataset.nav.split(','); openNav(la,lo,b.dataset.name); }
    if(e.target.id==='routeRetry') routeFrance();
  });
  $('navList').addEventListener('click',e=>{
    const a=e.target.closest('a[data-app]');
    if(!a) return;
    if($('navRemember').checked) setNav(a.dataset.app);
    closeSheet('nav');
  });
  $('navSet').innerHTML=['ask',...NAV_LIST].map(k=>
    `<button type="button" class="seg-btn" data-set-nav="${k}">${k==='ask'?'Demander':NAV_APPS[k].l}</button>`).join('');
  $('navSet').addEventListener('click',e=>{
    const b=e.target.closest('[data-set-nav]'); if(b) setNav(b.dataset.setNav);
  });
  setNav(S.nav);

  $('placeBtn').addEventListener('click',openPlace);
  $('placeOvl').addEventListener('click',()=>closeSheet('place'));
  $('placeInput').addEventListener('input',onPlaceInput);
  $('placeForm').addEventListener('submit',e=>{ // touche Entrée : 1er résultat
    e.preventDefault();
    if(S.placeItems[0]) setPlace(S.placeItems[0]);
  });
  $('placeList').addEventListener('click',e=>{
    const b=e.target.closest('.place-item'); if(b) setPlace(S.placeItems[+b.dataset.i]);
  });
  $('placeGps').addEventListener('click',()=>setPlace(null));
  swipeToClose('place');
  updatePlaceUI();

  // Retour sur l'appli (téléphone) après un moment : prix rafraîchis
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'&&S.time&&Date.now()-S.time>REFRESH_AFTER) search();
  });

  updateCarUI();
  search(); // lancement automatique dès l'ouverture
})();
