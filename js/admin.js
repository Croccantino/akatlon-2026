const map = L.map('map').setView([41.9, 12.5], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// Icona marker con il logo FireTracker
const fireIcon = L.divIcon({
  className: 'fire-icon',
  html: '<img src="/img/marker.png" alt="🔥" />',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

let authToken = sessionStorage.getItem('adminToken') || null;
let markers = [];
let userEvents = [];
let pendingMarker = null;
let pendingDescription = '';
let markerGroup = null;
let adminEventGroup = null;

// Icona segnalazione utente (admin vede le segnalazioni client)
const eventPinIcon = L.divIcon({
  className: 'danger-icon',
  html: '⚠️',
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -30]
});

// === VERIFICA TOKEN ALL'AVVIO ===
async function verifyToken() {
  if (!authToken) return false;
  const res = await fetch('/api/verify', { headers: { 'Authorization': authToken } });
  return res.ok;
}

// === LOGIN ===
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
    document.getElementById('sidebar').style.display = 'block';
    loadMarkers();
    loadEvents();
    connectStream();
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

// === GESTIONE MARKER ===
async function loadMarkers() {
  const res = await fetch('/api/markers');
  markers = await res.json();
  renderMarkers();
}

function renderMarkers() {
  const list = document.getElementById('markerList');
  list.innerHTML = '';
  if (markerGroup) map.removeLayer(markerGroup);
  markerGroup = L.layerGroup().addTo(map);
  markers.forEach(m => {
    const div = document.createElement('div');
    div.className = 'marker-item';
    div.innerHTML = `
      <div>
        <div class="name">🔥 ${m.title || 'Incendio'}</div>
        <div class="coords">${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}</div>
      </div>
      <button class="btn btn-danger" style="width:auto;margin:0;padding:5px 10px;" onclick="deleteMarker(${m.id})">🗑️</button>
    `;
    list.appendChild(div);

    L.marker([m.lat, m.lng], { icon: fireIcon }).addTo(markerGroup)
      .bindPopup(`<b>🔥 ${m.title || 'Incendio'}</b><br>${m.description || ''}`);
  });
}

// === EVENTI UTENTI (admin li vede e li può approvare/eliminare) ===
async function loadEvents() {
  const res = await fetch('/api/events');
  userEvents = await res.json();
  renderUserEvents();
}

function renderUserEvents() {
  const list = document.getElementById('userEventList');
  list.innerHTML = '';
  if (adminEventGroup) map.removeLayer(adminEventGroup);
  adminEventGroup = L.layerGroup().addTo(map);

  if (userEvents.length === 0) {
    list.innerHTML = '<p style="color:#888;font-size:13px;">Nessuna segnalazione utente.</p>';
    return;
  }

  userEvents.forEach(ev => {
    const div = document.createElement('div');
    div.className = 'event-item';
    const icon = ev.type === 'altro' ? '⚠️' : '🔥';
    div.innerHTML = `
      <div>
        <div class="name">${icon} ${ev.title}</div>
        <div class="coords">${ev.lat.toFixed(4)}, ${ev.lng.toFixed(4)}</div>
      </div>
      <div class="user-event-actions">
        <button class="btn btn-primary" style="width:auto;margin:0;padding:5px 10px;" onclick="useEventPosition(${ev.id})">📌 Aggiungi marker</button>
        <button class="btn btn-danger" style="width:auto;margin:0;padding:5px 10px;" onclick="deleteUserEvent(${ev.id})">🗑️</button>
      </div>
    `;
    list.appendChild(div);

    L.marker([ev.lat, ev.lng], { icon: eventPinIcon }).addTo(adminEventGroup)
      .bindPopup(`<b>${icon} ${ev.title}</b><br>${ev.description || ''}`);
  });
}

function useEventPosition(id) {
  const ev = userEvents.find(e => e.id === id);
  if (!ev) return;
  if (pendingMarker) map.removeLayer(pendingMarker);
  pendingMarker = L.marker([ev.lat, ev.lng], { icon: fireIcon }).addTo(map)
    .bindPopup('🔥 Segnalazione selezionata');
  document.getElementById('pinDescription').value =
    (ev.description || ev.title) + (ev.type === 'altro' ? ' [' + ev.title + ']' : '');
  document.getElementById('saveBtn').style.display = 'block';
  document.getElementById('addHint').textContent = '🔥 Segnalazione pronta: clicca Salva';
  map.setView([ev.lat, ev.lng], 15);
}

async function deleteUserEvent(id) {
  const res = await fetch('/api/events/' + id, {
    method: 'DELETE',
    headers: { 'Authorization': authToken }
  });
  if (res.ok) loadEvents();
}

// === STREAM REALTIME (admin <-> client) ===
let sse = null;
function connectStream() {
  sse = new EventSource('/api/stream');
  sse.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg.type === 'markers') loadMarkers();
    if (msg.type === 'events') loadEvents();
  };
  sse.onerror = () => {
    if (sse) sse.close();
    setTimeout(connectStream, 3000);
  };
}

async function deleteMarker(id) {
  const res = await fetch(`/api/markers/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': authToken }
  });
  if (res.ok) loadMarkers();
}

// === AGGIUNGI MARKER (click mappa) ===
map.on('click', e => {
  if (!authToken) return;
  if (pendingMarker) map.removeLayer(pendingMarker);
pendingMarker = L.marker(e.latlng, { icon: fireIcon }).addTo(map).bindPopup('🔥 Segnalazione selezionata');
      document.getElementById('saveBtn').style.display = 'block';
      document.getElementById('addHint').textContent = '🔥 Segnalazione pronta: clicca Salva';
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  if (!pendingMarker) return;
  const description = document.getElementById('pinDescription').value;
  const pos = pendingMarker.getLatLng();
  const title = description || 'Marker';
  const res = await fetch('/api/markers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authToken
    },
    body: JSON.stringify({ lat: pos.lat, lng: pos.lng, title, description })
  });
  if (res.ok) {
    map.removeLayer(pendingMarker);
    pendingMarker = null;
    document.getElementById('pinDescription').value = '';
    document.getElementById('saveBtn').style.display = 'none';
    document.getElementById('addHint').textContent = '📌 Clicca sulla mappa per aggiungere un incendio';
    loadMarkers();
  }
});

document.getElementById('saveBtn').style.display = 'none';

// === GEOLOCALIZZAZIONE: CENTRA LA TUA POSIZIONE ===
let userMarker = null;
document.getElementById('locateBtn').addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('Il tuo browser non supporta la geolocalizzazione');
    return;
  }
  document.getElementById('locateBtn').textContent = '⏳ Localizzazione...';
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      map.setView([latitude, longitude], 15);

      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.marker([latitude, longitude]).addTo(map)
        .bindPopup('<b>📍 Sei qui</b>')
        .openPopup();

      const circle = L.circle([latitude, longitude], {
        radius: position.coords.accuracy,
        color: '#34a853',
        fillColor: '#34a853',
        fillOpacity: 0.15,
        weight: 1
      }).addTo(map);
      userMarker._circle = circle;

      document.getElementById('locateBtn').textContent = '📍 La mia posizione';
    },
    (err) => {
      document.getElementById('locateBtn').textContent = '📍 La mia posizione';
      alert('Errore geolocalizzazione: ' + err.message);
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
});

// === SE LOGGED, mostra subito ===
if (authToken) {
  verifyToken().then(ok => {
    if (ok) {
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('sidebar').style.display = 'block';
      loadMarkers();
      loadEvents();
      connectStream();
    } else {
      authToken = null;
      sessionStorage.removeItem('adminToken');
    }
  });
}