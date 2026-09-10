let authToken = sessionStorage.getItem('adminToken') || null;

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function shapeLabel(s) {
  if (s.type === 'polygon') {
    const first = s.coords && s.coords[0];
    const n = Array.isArray(first) ? first.length : (s.coords ? s.coords.length : 0);
    return 'Poligono (' + n + ' punti)';
  }
  if (s.type === 'circle') {
    return 'Cerchio (raggio ' + (s.radius ? Math.round(s.radius) : '?') + ' m)';
  }
  if (s.type === 'rectangle') {
    const b = s.bounds;
    if (b && b._southWest && b._northEast) {
      return 'Rettangolo (' + b._southWest.lat.toFixed(3) + ',' + b._southWest.lng.toFixed(3) + ' → ' +
        b._northEast.lat.toFixed(3) + ',' + b._northEast.lng.toFixed(3) + ')';
    }
    return 'Rettangolo';
  }
  return s.type || 'Area';
}

function shapeCoordsText(s) {
  if (s.type === 'circle' && s.center) {
    return s.center.lat.toFixed(5) + ', ' + s.center.lng.toFixed(5);
  }
  if (s.type === 'polygon' && s.coords && s.coords[0] && s.coords[0][0]) {
    const pt = s.coords[0][0];
    return pt.lat.toFixed(5) + ', ' + pt.lng.toFixed(5) + ' ...';
  }
  if (s.type === 'rectangle' && s.bounds) {
    const b = s.bounds;
    if (b._southWest) return b._southWest.lat.toFixed(5) + ', ' + b._southWest.lng.toFixed(5);
  }
  return '—';
}

function historyHtml(data) {
  const markers = data.markers || [];
  const events = data.events || [];
  const shapes = data.shapes || [];

  let html = '';

  html += '<div class="section"><h2>🔥 Incendi ufficiali <span class="count">' + markers.length + '</span></h2>';
  if (markers.length === 0) html += '<p class="loading">Nessun incendio ufficiale.</p>';
  markers.forEach(m => {
    html += '<div class="card"><div class="card-head">' +
      '<div class="card-title">🔥 ' + esc(m.title || 'Incendio') + ' <span class="badge incendio">Incendio</span></div>' +
      '<div class="card-time">' + fmtDate(m.createdAt) + '</div></div>' +
      '<div class="card-body"><div class="desc">' + esc(m.description || '') + '</div>' +
      '<div>📍 ' + m.lat.toFixed(5) + ', ' + m.lng.toFixed(5) + '</div></div></div>';
  });
  html += '</div>';

  html += '<div class="section"><h2>⚠️ Segnalazioni utenti <span class="count">' + events.length + '</span></h2>';
  if (events.length === 0) html += '<p class="loading">Nessuna segnalazione utente.</p>';
  events.forEach(ev => {
    const icon = ev.type === 'altro' ? '⚠️' : '🔥';
    html += '<div class="card event-card"><div class="card-head">' +
      '<div class="card-title">' + icon + ' ' + esc(ev.title || 'Segnalazione') + ' <span class="badge segnalazione">Utenza</span></div>' +
      '<div class="card-time">' + fmtDate(ev.createdAt) + '</div></div>' +
      '<div class="card-body"><div class="desc">' + esc(ev.description || '') + '</div>' +
      '<div>📍 ' + ev.lat.toFixed(5) + ', ' + ev.lng.toFixed(5) + '</div></div></div>';
  });
  html += '</div>';

  html += '<div class="section"><h2>🗺️ Aree coinvolte <span class="count">' + shapes.length + '</span></h2>';
  if (shapes.length === 0) html += '<p class="loading">Nessuna area disegnata.</p>';
  shapes.forEach(s => {
    html += '<div class="card shape-card"><div class="card-head">' +
      '<div class="card-title">🗺️ ' + esc(shapeLabel(s)) + ' <span class="badge area">Area</span></div>' +
      '<div class="card-time">' + fmtDate(s.createdAt) + '</div></div>' +
      '<div class="card-body"><div>📍 ' + esc(shapeCoordsText(s)) + '</div></div></div>';
  });
  html += '</div>';

  return html;
}

// === LOAD ===
async function loadHistory() {
  const res = await fetch('/api/history', { headers: { 'Authorization': authToken } });
  if (!res.ok) {
    document.getElementById('historyContent').innerHTML = '<p style="text-align:center;color:#d93025;">Accesso negato. Ricontrolla il login.</p>';
    return;
  }
  const data = await res.json();
  document.getElementById('historyContent').innerHTML = historyHtml(data);
}

// === VERIFICA TOKEN ALL'AVVIO ===
async function verifyToken() {
  if (!authToken) return false;
  const res = await fetch('/api/verify', { headers: { 'Authorization': authToken } });
  return res.ok;
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const pwd = document.getElementById('passwordInput').value;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pwd })
  });
  if (res.ok) {
    authToken = pwd;
    sessionStorage.setItem('adminToken', authToken);
    document.getElementById('loginScreen').style.display = 'none';
    loadHistory();
  } else {
    document.getElementById('loginError').textContent = 'Password errata';
  }
});
document.getElementById('passwordInput').addEventListener('keypress', e => {
  if (e.key === 'Enter') document.getElementById('loginBtn').click();
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  authToken = null;
  sessionStorage.removeItem('adminToken');
  location.reload();
});

// === COLLEGA AI CAMBIAMENTI IN TEMPO REALE ===
let sse = null;
function connectStream() {
  sse = new EventSource('/api/stream');
  sse.onmessage = e => {
    loadHistory();
  };
  sse.onerror = () => {
    if (sse) sse.close();
    setTimeout(connectStream, 3000);
  };
}

// === AUTO-LOGIN ===
if (authToken) {
  verifyToken().then(ok => {
    if (ok) {
      document.getElementById('loginScreen').style.display = 'none';
      loadHistory();
      connectStream();
    } else {
      authToken = null;
      sessionStorage.removeItem('adminToken');
    }
  });
}