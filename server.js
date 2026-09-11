const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'markers.json');
const EVENTS_FILE = path.join(__dirname, 'events.json');
const SHAPES_FILE = path.join(__dirname, 'shapes.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    return { password: 'admin123' };
  }
}

function getAdminPassword() {
  return readConfig().password;
}

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

function readMarkers() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeMarkers(markers) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(markers, null, 2));
}

function readEvents() {
  try {
    return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeEvents(events) {
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

function readShapes() {
  try {
    return JSON.parse(fs.readFileSync(SHAPES_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeShapes(shapes) {
  fs.writeFileSync(SHAPES_FILE, JSON.stringify(shapes, null, 2));
}

// === STORICO APPEND-ONLY (le cancellazioni rimangono nel log) ===
function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeHistory(entries) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries, null, 2));
}

function logHistory(type, action, data) {
  const entries = readHistory();
  entries.push({ id: nextLogId(), type, action, createdAt: new Date().toISOString(), data: data || null });
  if (entries.length > 2000) entries.splice(0, entries.length - 2000);
  writeHistory(entries);
  broadcast({ type: 'history' });
}

let lastLogId = Date.now();
function nextLogId() {
  lastLogId = Math.max(lastLogId + 1, Date.now());
  return lastLogId;
}

// === SSE (real-time) ===
const sseClients = new Set();
function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  sseClients.forEach(res => {
    try { res.write(data); } catch (e) { sseClients.delete(res); }
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function getBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (e) { resolve({}); }
    });
  });
}

// === PROXY METEO (venti reali per la zona di pericolo) ===
async function fetchTimeout(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'FireTracker/1.0' } });
  } finally {
    clearTimeout(timer);
  }
}

function distanzaKmServer(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function ventoDaMETAR(icao = 'LIBN') {
  const r = await fetchTimeout(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`);
  if (!r.ok) throw new Error('METAR ' + r.status);
  const dati = await r.json();
  if (!dati || dati.length === 0) throw new Error('METAR vuoto');
  const u = dati[0];
  if (u.wdir === undefined || u.wdir === null || u.wdir === 'VRB') {
    throw new Error('Vento variabile/calmo');
  }
  let ts = 'orario n/d';
  if (u.obsTime != null) {
    const n = Number(u.obsTime);
    if (!isNaN(n)) {
      const ms = n > 1e12 ? n : n * 1000;
      ts = new Date(ms).toLocaleString('it-IT');
    }
  }
  return {
    direzioneGradi: Number(u.wdir),
    velocitaKmh: Number(u.wspd) * 1.852,
    fonte: `Aeronautica Militare - METAR ${icao} (${ts})`,
  };
}

const ARPAP_BASE = 'https://cloud.arpa.puglia.it/Meteo';
const DISTANZA_MAX_CENTRALINA_KM = 40;

const METEO_CACHE = new Map();
const METEO_CACHE_TTL = 60 * 1000;

async function centralinaPiuVicinaServer(lat, lng) {
  const r = await fetchTimeout(`${ARPAP_BASE}/Stations`);
  if (!r.ok) throw new Error('Centraline ' + r.status);
  const gj = await r.json();
  let best = null;
  let bestD = Infinity;
  for (const f of gj.features || []) {
    const [lngS, latS] = f.geometry.coordinates.map(Number);
    const d = distanzaKmServer(lat, lng, latS, lngS);
    if (d < bestD) {
      bestD = d;
      best = { ...f.properties, lat: latS, lng: lngS, distanzaKm: d };
    }
  }
  return best;
}

async function ventoDaCentralinaServer(idStation) {
  const anno = new Date().getFullYear();
  const r = await fetchTimeout(`${ARPAP_BASE}?id_station=${idStation}&year=${anno}&format=CSV`);
  if (!r.ok) throw new Error('Centralina CSV ' + r.status);
  const testo = await r.text();
  const righe = testo.trim().split('\n').map(x => x.split(','));
  const h = righe[0];
  const iV = h.indexOf('velocita_vento_avg');
  const iD = h.indexOf('direzione_vento_gradi');
  const iCV = h.indexOf('cod_validazione_velocita_vento');
  const iCD = h.indexOf('cod_validazione_direzione_vento');
  if (iV < 0 || iD < 0 || iCV < 0 || iCD < 0) return null;
  for (let i = righe.length - 1; i >= 1; i--) {
    const riga = righe[i];
    if (riga[iCV] === '1' && riga[iCD] === '1') {
      const v = parseFloat(riga[iV]);
      const d = parseFloat(riga[iD]);
      if (!isNaN(v) && !isNaN(d)) return { velocitaMs: v, direzioneGradi: d };
    }
  }
  return null;
}

async function ventoDaOpenMeteo(lat, lng) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`;
  const r = await fetchTimeout(url);
  if (!r.ok) throw new Error('Open-Meteo ' + r.status);
  const d = await r.json();
  return {
    direzioneGradi: d.current.wind_direction_10m,
    velocitaKmh: d.current.wind_speed_10m,
  };
}

async function ventoMigliore(lat, lng) {
  try {
    return await ventoDaMETAR('LIBN');
  } catch (e) {
    console.warn('METAR non disponibile, provo ARPAP:', e.message);
  }
  try {
    const c = await centralinaPiuVicinaServer(lat, lng);
    if (c && c.distanzaKm <= DISTANZA_MAX_CENTRALINA_KM) {
      const v = await ventoDaCentralinaServer(c.id_station);
      if (v) {
        return {
          direzioneGradi: v.direzioneGradi,
          velocitaKmh: v.velocitaMs * 3.6,
          fonte: `Centralina ARPAP ${c.name} (${c.distanzaKm.toFixed(1)} km)`,
        };
      }
    }
  } catch (e) {
    console.warn('ARPAP non disponibile, uso il modello meteo:', e.message);
  }
  const m = await ventoDaOpenMeteo(lat, lng);
  return { ...m, fonte: 'Modello meteo (Open-Meteo)' };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  // === REALTIME STREAM (SSE) ===
  if (pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (e) { clearInterval(heartbeat); sseClients.delete(res); }
    }, 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
    return;
  }

  // === API AUTH ===
  if (pathname === '/api/login' && method === 'POST') {
    const body = await getBody(req);
    if (body.password === getAdminPassword()) {
      return sendJson(res, 200, { success: true });
    }
    return sendJson(res, 401, { error: 'Password errata' });
  }

  if (pathname === '/api/verify' && method === 'GET') {
    const auth = req.headers.authorization;
    if (auth === getAdminPassword()) {
      return sendJson(res, 200, { success: true });
    }
    return sendJson(res, 401, { error: 'Non autorizzato' });
  }

  // === API MARKERS ===
  if (pathname === '/api/markers' && method === 'GET') {
    return sendJson(res, 200, readMarkers());
  }

  if (pathname === '/api/markers' && method === 'POST') {
    const auth = req.headers.authorization;
    if (auth !== getAdminPassword()) return sendJson(res, 401, { error: 'Non autorizzato' });
    const markers = readMarkers();
    const body = await getBody(req);
    const marker = { ...body, id: Date.now(), createdAt: new Date().toISOString() };
    markers.push(marker);
    writeMarkers(markers);
    broadcast({ type: 'markers' });
    logHistory('marker', 'created', marker);
    return sendJson(res, 201, marker);
  }

  if (pathname.startsWith('/api/markers/') && method === 'DELETE') {
    const auth = req.headers.authorization;
    if (auth !== getAdminPassword()) return sendJson(res, 401, { error: 'Non autorizzato' });
    const id = parseInt(pathname.split('/')[3]);
    let markers = readMarkers();
    const removed = markers.find(m => m.id === id);
    const filtered = markers.filter(m => m.id !== id);
    if (filtered.length === markers.length) return sendJson(res, 404, { error: 'Marker non trovato' });
    writeMarkers(filtered);
    broadcast({ type: 'markers' });
    logHistory('marker', 'deleted', removed);
    return sendJson(res, 200, { success: true });
  }

  if (pathname.startsWith('/api/markers/') && pathname.endsWith('/estinto') && method === 'POST') {
    const auth = req.headers.authorization;
    if (auth !== getAdminPassword()) return sendJson(res, 401, { error: 'Non autorizzato' });
    const id = parseInt(pathname.split('/')[3]);
    const markers = readMarkers();
    const removed = markers.find(m => m.id === id);
    if (!removed) return sendJson(res, 404, { error: 'Marker non trovato' });
    writeMarkers(markers.filter(m => m.id !== id));
    broadcast({ type: 'markers' });
    logHistory('marker', 'estinto', removed);
    return sendJson(res, 200, { success: true });
  }

  // === API EVENTI CLIENT ===
  if (pathname === '/api/events' && method === 'GET') {
    return sendJson(res, 200, readEvents());
  }

  if (pathname === '/api/events' && method === 'POST') {
    const events = readEvents();
    const body = await getBody(req);
    const ev = { ...body, id: Date.now(), createdAt: new Date().toISOString() };
    events.push(ev);
    writeEvents(events);
    broadcast({ type: 'events' });
    logHistory('event', 'created', ev);
    return sendJson(res, 201, ev);
  }

  if (pathname.startsWith('/api/events/') && method === 'DELETE') {
    const auth = req.headers.authorization;
    if (auth !== getAdminPassword()) return sendJson(res, 401, { error: 'Non autorizzato' });
    const id = parseInt(pathname.split('/')[3]);
    let events = readEvents();
    const removed = events.find(e => e.id === id);
    const filtered = events.filter(e => e.id !== id);
    if (filtered.length === events.length) return sendJson(res, 404, { error: 'Evento non trovato' });
    writeEvents(filtered);
    broadcast({ type: 'events' });
    logHistory('event', 'deleted', removed);
    return sendJson(res, 200, { success: true });
  }

  if (pathname.startsWith('/api/events/') && pathname.endsWith('/estinto') && method === 'POST') {
    const auth = req.headers.authorization;
    if (auth !== getAdminPassword()) return sendJson(res, 401, { error: 'Non autorizzato' });
    const id = parseInt(pathname.split('/')[3]);
    const events = readEvents();
    const removed = events.find(e => e.id === id);
    if (!removed) return sendJson(res, 404, { error: 'Evento non trovato' });
    writeEvents(events.filter(e => e.id !== id));
    broadcast({ type: 'events' });
    logHistory('event', 'estinto', removed);
    return sendJson(res, 200, { success: true });
  }

  // === API AREE (shapes) ===
  if (pathname === '/api/shapes' && method === 'GET') {
    return sendJson(res, 200, readShapes());
  }

  if (pathname === '/api/shapes' && method === 'POST') {
    const shapes = readShapes();
    const body = await getBody(req);
    const shape = { id: Date.now(), createdAt: new Date().toISOString(), ...body };
    shapes.push(shape);
    writeShapes(shapes);
    broadcast({ type: 'shapes' });
    logHistory('shape', 'created', shape);
    return sendJson(res, 201, shape);
  }

  if (pathname.startsWith('/api/shapes/') && method === 'PUT') {
    const id = parseInt(pathname.split('/')[3]);
    const shapes = readShapes();
    const idx = shapes.findIndex(s => s.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'Area non trovata' });
    const body = await getBody(req);
    shapes[idx] = { ...shapes[idx], ...body, id };
    writeShapes(shapes);
    broadcast({ type: 'shapes' });
    return sendJson(res, 200, shapes[idx]);
  }

  if (pathname.startsWith('/api/shapes/') && method === 'DELETE') {
    const id = parseInt(pathname.split('/')[3]);
    let shapes = readShapes();
    const removed = shapes.find(s => s.id === id);
    const filtered = shapes.filter(s => s.id !== id);
    if (filtered.length === shapes.length) return sendJson(res, 404, { error: 'Area non trovata' });
    writeShapes(filtered);
    broadcast({ type: 'shapes' });
    logHistory('shape', 'deleted', removed);
    return sendJson(res, 200, { success: true });
  }

  // === PROXY METEO (zona di pericolo) ===
  if (pathname === '/api/meteo/vento' && (method === 'GET' || method === 'POST')) {
    let lat = parseFloat(url.searchParams.get('lat'));
    let lng = parseFloat(url.searchParams.get('lng'));
    if (method === 'POST') {
      const b = await getBody(req);
      lat = parseFloat(b && b.lat);
      lng = parseFloat(b && b.lng);
    }
    if (isNaN(lat) || isNaN(lng)) return sendJson(res, 400, { error: 'lat/lng mancanti' });
    try {
      const cacheKey = lat.toFixed(3) + ',' + lng.toFixed(3);
      const cacheHit = METEO_CACHE.get(cacheKey);
      if (cacheHit && Date.now() - cacheHit.t < METEO_CACHE_TTL) {
        return sendJson(res, 200, Object.assign({ cache: true }, cacheHit.v));
      }
      const v = await ventoMigliore(lat, lng);
      METEO_CACHE.set(cacheKey, { t: Date.now(), v });
      return sendJson(res, 200, v);
    } catch (e) {
      return sendJson(res, 502, { error: 'Nessun dato vento disponibile: ' + e.message });
    }
  }

  // === API STORICO (solo admin) ===
  if (pathname === '/api/history' && method === 'GET') {
    const auth = req.headers.authorization;
    if (auth !== getAdminPassword()) return sendJson(res, 401, { error: 'Non autorizzato' });
    return sendJson(res, 200, { entries: readHistory() });
  }

  if (pathname.startsWith('/api/history/') && method === 'DELETE') {
    const auth = req.headers.authorization;
    if (auth !== getAdminPassword()) return sendJson(res, 401, { error: 'Non autorizzato' });
    const id = parseInt(pathname.split('/')[3]);
    const entries = readHistory();
    const entry = entries.find(e => e.id === id);
    if (!entry) return sendJson(res, 404, { error: 'Voce non trovata' });
    writeHistory(entries.filter(e => e.id !== id));

    const ref = entry.data && entry.data.id;
    if (ref) {
      if (entry.type === 'marker') {
        const markers = readMarkers().filter(m => m.id !== ref);
        writeMarkers(markers);
        broadcast({ type: 'markers' });
      } else if (entry.type === 'event') {
        const events = readEvents().filter(e => e.id !== ref);
        writeEvents(events);
        broadcast({ type: 'events' });
      } else if (entry.type === 'shape') {
        const shapes = readShapes().filter(s => s.id !== ref);
        writeShapes(shapes);
        broadcast({ type: 'shapes' });
      }
    }
    broadcast({ type: 'history' });
    return sendJson(res, 200, { success: true });
  }

  // === PAGINE STATICHE ===
  let filePath;
  if (pathname === '/') {
    filePath = path.join(__dirname, 'index.html');
  } else if (pathname === '/admin') {
    filePath = path.join(__dirname, 'admin.html');
  } else if (pathname === '/contatti') {
    filePath = path.join(__dirname, 'contatti.html');
  } else if (pathname === '/dati') {
    filePath = path.join(__dirname, 'dati.html');
  } else if (pathname === '/history') {
    filePath = path.join(__dirname, 'history.html');
  } else {
    filePath = path.join(__dirname, pathname);
    // Se il percorso non ha estensione, prova con .html
    if (!path.extname(filePath)) {
      const withHtml = path.join(__dirname, pathname + '.html');
      if (fs.existsSync(withHtml)) filePath = withHtml;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'text/html';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('File non trovato');
      } else {
        res.writeHead(500);
        res.end('Errore server');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server su http://localhost:${PORT}`);
  console.log(`Admin su http://localhost:${PORT}/admin`);
  const net = require('os').networkInterfaces();
  for (const name of Object.keys(net)) {
    for (const iface of net[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(`IP LAN ${name}: http://${iface.address}:${PORT}`);
      }
    }
  }
});
