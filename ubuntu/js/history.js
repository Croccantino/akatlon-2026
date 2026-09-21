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
  if (s.type === 'rectangle' && s.bounds && s.bounds._southWest) {
    return s.bounds._southWest.lat.toFixed(5) + ', ' + s.bounds._southWest.lng.toFixed(5);
  }
  return '—';
}

function entryIcon(type, d) {
  if (type === 'marker') return '🔥';
  if (type === 'event') return (d && d.type === 'altro') ? '⚠️' : '🔥';
  return '🗺️';
}

function entryBadge(type, action) {
  const base = type === 'marker' ? ['incendio', 'Incendio']
    : type === 'event' ? ['segnalazione', 'Utenza']
    : ['area', 'Area'];
  const extra = action === 'deleted' ? ' del'
    : action === 'estinto' ? ' estinto' : '';
  const estinto = action === 'estinto' ? ' badge-estinto' : '';
  return '<span class="badge ' + base[0] + estinto + '">' + base[1] + extra + '</span>';
}

function entryTitle(type, d) {
  if (type === 'marker') return esc(d.title || 'Incendio');
  if (type === 'event') return esc(d.title || 'Segnalazione');
  return esc(shapeLabel(d));
}

function entryBody(type, d) {
  if (type === 'marker' || type === 'event') {
    const lat = d.lat, lng = d.lng;
    const geo = (lat != null && lng != null)
      ? '<div>📍 ' + Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5) + '</div>'
      : '';
    const desc = d.description ? '<div class="desc">' + esc(d.description) + '</div>' : '';
    return desc + geo;
  }
  return '<div>📍 ' + esc(shapeCoordsText(d)) + '</div>';
}

function historyHtml(entries) {
  if (entries.length === 0) {
    return '<p class="loading">Nessun evento registrato.</p>';
  }
  let html = '';
  entries.slice().reverse().forEach(e => {
    const d = e.data || {};
    const deleted = e.action === 'deleted';
    const estinto = e.action === 'estinto';
    const nota = deleted ? 'rimossa dalla mappa' : estinto ? 'estinta, rimossa dalla mappa' : '';
    html += '<div class="card ' + (deleted ? 'deleted-card' : estinto ? 'estinto-card' : '') + '">' +
      '<div class="card-head">' +
      '<div class="card-title">' + entryIcon(e.type, d) + ' ' + entryTitle(e.type, d) +
        ' ' + entryBadge(e.type, e.action) +
        (nota ? ' <span class="del-note">' + nota + '</span>' : '') +
      '</div>' +
      '<div class="card-actions">' +
        '<div class="card-time">' + fmtDate(e.createdAt) + '</div>' +
        '<button class="del-btn" title="Elimina dallo storico" onclick="deleteEntry(' + e.id + ')">🗑️</button>' +
      '</div>' +
      '</div>' +
      '<div class="card-body">' + entryBody(e.type, d) + '</div>' +
      '</div>';
  });
  return html;
}

let pendingDeleteId = null;

function deleteEntry(id) {
  pendingDeleteId = id;
  document.getElementById('confirmModal').style.display = 'flex';
}

document.getElementById('confirmNo').addEventListener('click', () => {
  pendingDeleteId = null;
  document.getElementById('confirmModal').style.display = 'none';
});

document.getElementById('confirmYes').addEventListener('click', async () => {
  document.getElementById('confirmModal').style.display = 'none';
  const id = pendingDeleteId;
  pendingDeleteId = null;
  if (id == null) return;
  const res = await fetch('/api/history/' + id, {
    method: 'DELETE',
    headers: { 'Authorization': authToken }
  });
  if (!res.ok) {
    const msg = res.status === 401
      ? 'Sessione scaduta: fai di nuovo login.'
      : 'Errore: voce non trovata.';
    document.getElementById('historyContent').innerHTML =
      '<p style="text-align:center;color:#d93025;">' + msg + '</p>';
    return;
  }
  loadHistory();
});

// === LOAD ===
async function loadHistory() {
  const res = await fetch('/api/history', { headers: { 'Authorization': authToken } });
  if (!res.ok) {
    document.getElementById('historyContent').innerHTML = '<p style="text-align:center;color:#d93025;">Accesso negato. Ricontrolla il login.</p>';
    return;
  }
  const data = await res.json();
  document.getElementById('historyContent').innerHTML = historyHtml(data.entries || []);
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
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg.type === 'history') loadHistory();
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