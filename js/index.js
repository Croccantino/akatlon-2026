const map = L.map('map').setView([41.9, 12.5], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// Icona marker con il logo FireTracker (admin)
const logoIcon = L.divIcon({
  className: 'fire-icon',
  html: '<img src="/img/marker.png" alt="FireTracker" />',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

// Icona fuoco emoji (client - incendio)
const fireEmojiIcon = L.divIcon({
  className: 'fire-emoji',
  html: '🔥',
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -30]
});

// Icona pericolo (client - altro pericolo)
const dangerIcon = L.divIcon({
  className: 'danger-icon',
  html: '⚠️',
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -30]
});

// === MARKER ADMIN (dal server) ===
let adminMarkerGroup = null;
async function loadAdminMarkers() {
  const res = await fetch('/api/markers');
  const list = await res.json();
  if (adminMarkerGroup) map.removeLayer(adminMarkerGroup);
  adminMarkerGroup = L.layerGroup().addTo(map);
  list.forEach(m => {
    L.marker([m.lat, m.lng], { icon: logoIcon }).addTo(adminMarkerGroup)
      .bindPopup(`<b>🔥 ${m.title || 'Incendio'}</b><br>${m.description || ''}`);
  });
}

// === EVENTI CLIENT (dal server, visibili anche admin) ===
let clientEvents = [];
let eventMarkers = [];

async function loadEvents() {
  const res = await fetch('/api/events');
  clientEvents = await res.json();
  renderEventList();
  refreshEventMarkers();
}

function postEvent(event) {
  return fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  }).then(() => loadEvents());
}

function eventIconFor(ev) {
  return ev.type === 'altro' ? dangerIcon : fireEmojiIcon;
}

function renderEventList() {
  const list = document.getElementById('eventList');
  if (clientEvents.length === 0) {
    list.innerHTML = '<p style="color:#888;font-size:13px;">Nessuna segnalazione. Clicca su "Segnala" e poi sulla mappa!</p>';
    return;
  }
  list.innerHTML = '';
  clientEvents.forEach((ev, idx) => {
    const div = document.createElement('div');
    div.className = 'event-item';
    const icon = ev.type === 'altro' ? '⚠️' : '🔥';
    div.innerHTML = `
      <div class="title">${icon} ${ev.title}</div>
      <div class="desc">${ev.description || ''}<br>${ev.lat.toFixed(4)}, ${ev.lng.toFixed(4)}</div>
    `;
    div.onclick = () => map.setView([ev.lat, ev.lng], 13);
    list.appendChild(div);
  });
}

// Gestione marker eventi sulla mappa
function refreshEventMarkers() {
  eventMarkers.forEach(m => map.removeLayer(m));
  eventMarkers = [];
  clientEvents.forEach(ev => {
    const m = L.marker([ev.lat, ev.lng], { icon: eventIconFor(ev) }).addTo(map)
      .bindPopup(`<div class="event-popup"><h4>${ev.type === 'altro' ? '⚠️' : '🔥'} ${ev.title}</h4><p>${ev.description || ''}</p></div>`);
    eventMarkers.push(m);
  });
}

// === SELEZIONE TIPO EVENTO ===
const eventTypeSelect = document.getElementById('eventType');
const eventTypeText = document.getElementById('eventTypeText');

eventTypeSelect.addEventListener('change', () => {
  const isAltro = eventTypeSelect.value === 'altro';
  eventTypeText.style.display = isAltro ? 'block' : 'none';
  eventTypeText.required = isAltro;
});

// === AGGIUNGI EVENTO (click mappa quando attivo) ===
let addModeActive = false;

document.getElementById('addEventBtn').addEventListener('click', () => {
  const type = eventTypeSelect.value;
  if (type === 'altro' && !eventTypeText.value.trim()) {
    alert('Scrivi il tipo di pericolo nel campo apposito');
    return;
  }
  addModeActive = true;
  alert('Clicca sulla mappa nel punto dove vuoi segnalare');
});

map.on('click', e => {
  if (!addModeActive) return;
  const type = eventTypeSelect.value;
  const title = type === 'incendio' ? 'Incendio' : eventTypeText.value.trim();
  const description = document.getElementById('eventDesc').value.trim();
  addModeActive = false;
  eventTypeSelect.value = 'incendio';
  eventTypeText.value = '';
  eventTypeText.style.display = 'none';
  document.getElementById('eventDesc').value = '';
  postEvent({ type, title, description, lat: e.latlng.lat, lng: e.latlng.lng });
});

// === DISEGNO AREE (salvate sul server, visibili in storico) ===
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

function shapeDataFromLayer(layer) {
  if (layer instanceof L.Rectangle) return { type: 'rectangle', bounds: layer.getBounds() };
  if (layer instanceof L.Polygon) return { type: 'polygon', coords: layer.getLatLngs() };
  if (layer instanceof L.Circle) return { type: 'circle', center: layer.getLatLng(), radius: layer.getRadius() };
  return null;
}

async function loadShapes() {
  const res = await fetch('/api/shapes');
  const list = await res.json();
  drawnItems.clearLayers();
  list.forEach(s => {
    let layer;
    if (s.type === 'polygon') {
      layer = L.polygon(s.coords);
    } else if (s.type === 'rectangle') {
      layer = L.rectangle(s.bounds);
    } else if (s.type === 'circle') {
      layer = L.circle(s.center, { radius: s.radius });
    }
    if (layer) {
      layer.options.shapeId = s.id;
      drawnItems.addLayer(layer);
    }
  });
}

const drawControl = new L.Control.Draw({
  draw: {
    polygon: { showArea: true, allowIntersection: false, shapeOptions: { color: '#e63946' } },
    circle: { showRadius: true },
    rectangle: {},
    polyline: false,
    marker: false,
    circlemarker: false
  },
  edit: { featureGroup: drawnItems, remove: true }
});
map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, e => {
  const layer = e.layer;
  const data = shapeDataFromLayer(layer);
  if (!data) return;
  drawnItems.addLayer(layer);
  fetch('/api/shapes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
    .then(r => r.json())
    .then(s => { layer.options.shapeId = s.id; });
});

map.on(L.Draw.Event.EDITED, e => {
  e.layers.eachLayer(layer => {
    const data = shapeDataFromLayer(layer);
    if (data && layer.options.shapeId) {
      fetch('/api/shapes/' + layer.options.shapeId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    }
  });
});

map.on(L.Draw.Event.DELETED, e => {
  e.layers.eachLayer(layer => {
    if (layer.options.shapeId) {
      fetch('/api/shapes/' + layer.options.shapeId, { method: 'DELETE' });
    }
  });
});

// === GEOLOCALIZZAZIONE: CENTRA LA TUA POSIZIONE ===
let userLocationLayer = null;

function updateLocateBtn(generic) {
  const texts = [
    document.getElementById('locateBtn'),
    document.getElementById('navLocate')
  ].filter(Boolean);
  texts.forEach(btn => {
    if (generic) {
      btn.textContent = generic;
    } else {
      btn.innerHTML = btn.id === 'navLocate' ? '📍' : '📍 La mia posizione';
    }
  });
}

function centerOnMe() {
  if (!navigator.geolocation) {
    alert('Il tuo browser non supporta la geolocalizzazione');
    return;
  }
  updateLocateBtn('⏳ Localizzazione...');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      map.setView([latitude, longitude], 15);

      // Rimuovi marker e cerchio precedenti
      if (userLocationLayer) {
        map.removeLayer(userLocationLayer);
        userLocationLayer = null;
      }
      userLocationLayer = L.layerGroup().addTo(map);

      L.marker([latitude, longitude]).addTo(userLocationLayer)
        .bindPopup('<b>📍 Sei qui</b>')
        .openPopup();

      L.circle([latitude, longitude], {
        radius: accuracy,
        color: '#34a853',
        fillColor: '#34a853',
        fillOpacity: 0.15,
        weight: 1
      }).addTo(userLocationLayer);

      updateLocateBtn();
    },
    (err) => {
      updateLocateBtn();
      let msg = 'Errore geolocalizzazione: ' + err.message;
      if (err.code === err.PERMISSION_DENIED) msg = 'Permesso negato. Abilita la geolocalizzazione nel browser.';
      if (err.code === err.POSITION_UNAVAILABLE) msg = 'Posizione non disponibile. Riprova.';
      alert(msg);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
  );
}

document.getElementById('locateBtn').addEventListener('click', centerOnMe);

// === TASTI NAVIGAZIONE MAPPA (basso a destra) ===
const NavControl = L.Control.extend({
  options: { position: 'bottomright' },
  onAdd: function(map) {
    const container = L.DomUtil.create('div', 'nav-control');
    container.innerHTML = `
      <button class="nav-btn" id="navZoomIn" title="Zoom avanti">+</button>
      <button class="nav-btn" id="navZoomOut" title="Zoom indietro">−</button>
      <button class="nav-btn" id="navHome" title="Torna al centro">🏠</button>
      <button class="nav-btn nav-locate" id="navLocate" title="La mia posizione">📍</button>
      <button class="nav-btn" id="navFull" title="Schermo intero">⛶</button>
    `;
    L.DomEvent.disableClickPropagation(container);
    return container;
  }
});
new NavControl().addTo(map);

document.getElementById('navZoomIn').addEventListener('click', () => map.zoomIn());
document.getElementById('navZoomOut').addEventListener('click', () => map.zoomOut());
document.getElementById('navHome').addEventListener('click', () => map.setView([41.9, 12.5], 6));
document.getElementById('navLocate').addEventListener('click', centerOnMe);
document.getElementById('navFull').addEventListener('click', () => {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    el.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
});

// === STREAM REALTIME (admin <-> client) ===
let eventSource = null;
function connectStream() {
  eventSource = new EventSource('/api/stream');
  eventSource.onmessage = e => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg.type === 'markers') loadAdminMarkers();
    if (msg.type === 'events') loadEvents();
    if (msg.type === 'shapes') loadShapes();
  };
  eventSource.onerror = () => {
    if (eventSource) eventSource.close();
    setTimeout(connectStream, 3000);
  };
}

// === INIT ===
loadAdminMarkers();
loadEvents();
loadShapes();
connectStream();