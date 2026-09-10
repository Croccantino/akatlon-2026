const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'markers.json');
const EVENTS_FILE = path.join(__dirname, 'events.json');
const SHAPES_FILE = path.join(__dirname, 'shapes.json');
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
    return sendJson(res, 201, marker);
  }

  if (pathname.startsWith('/api/markers/') && method === 'DELETE') {
    const auth = req.headers.authorization;
    if (auth !== getAdminPassword()) return sendJson(res, 401, { error: 'Non autorizzato' });
    const id = parseInt(pathname.split('/')[3]);
    let markers = readMarkers();
    const filtered = markers.filter(m => m.id !== id);
    if (filtered.length === markers.length) return sendJson(res, 404, { error: 'Marker non trovato' });
    writeMarkers(filtered);
    broadcast({ type: 'markers' });
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
    return sendJson(res, 201, ev);
  }

  if (pathname.startsWith('/api/events/') && method === 'DELETE') {
    const auth = req.headers.authorization;
    if (auth !== getAdminPassword()) return sendJson(res, 401, { error: 'Non autorizzato' });
    const id = parseInt(pathname.split('/')[3]);
    let events = readEvents();
    const filtered = events.filter(e => e.id !== id);
    if (filtered.length === events.length) return sendJson(res, 404, { error: 'Evento non trovato' });
    writeEvents(filtered);
    broadcast({ type: 'events' });
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
    const filtered = shapes.filter(s => s.id !== id);
    if (filtered.length === shapes.length) return sendJson(res, 404, { error: 'Area non trovata' });
    writeShapes(filtered);
    broadcast({ type: 'shapes' });
    return sendJson(res, 200, { success: true });
  }

  // === API STORICO (solo admin) ===
  if (pathname === '/api/history' && method === 'GET') {
    const auth = req.headers.authorization;
    if (auth !== getAdminPassword()) return sendJson(res, 401, { error: 'Non autorizzato' });
    return sendJson(res, 200, {
      markers: readMarkers(),
      events: readEvents(),
      shapes: readShapes()
    });
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
});
