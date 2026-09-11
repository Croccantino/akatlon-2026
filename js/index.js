const map = L.map('map', { zoomControl: false }).setView([41.9, 12.5], 6);
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
  aggiornaZonePericolo();
}

// === ZONA DI PERICOLO AUTOMATICA (modello calcolaZonaCompleta) ===
let zonaPericoloGroup = null;
let ultimoFingerprint = '';
let shapesCache = [];
function combustibilePerEvento(ev) {
  if (ev.type === 'incendio') return 'macchia';
  return 'prato';
}
function raggioAreaRossaEvento(ev) {
  let best = 0;
  let bestKm = 1;
  for (const s of shapesCache) {
    if (s.type !== 'circle' || !s.center) continue;
    const d = distanzaKm(ev.lat, ev.lng, s.center.lat, s.center.lng);
    if (d < bestKm) { bestKm = d; best = s.radius || 0; }
  }
  return best;
}
async function creaZonePerEvento(incendi) {
  const venti = {};
  const segnatura = [];
  for (const ev of incendi) {
    try {
      const w = await ottieniVentoMigliore(ev.lat, ev.lng);
      venti[ev.id] = w;
      segnatura.push(ev.id + ':' + Math.round(w.direzioneGradi) + ':' + w.velocitaKmh.toFixed(1) + ':' + w.fonte + ':r' + Math.round(raggioAreaRossaEvento(ev)));
    } catch (err) {
      venti[ev.id] = null;
      segnatura.push(ev.id + ':err');
    }
  }
  return { venti, segnatura: segnatura.join('|') };
}
async function aggiornaZonePericolo() {
  const incendi = clientEvents.filter(ev => ev.type !== 'altro');
  if (incendi.length === 0) {
    if (zonaPericoloGroup) { map.removeLayer(zonaPericoloGroup); zonaPericoloGroup = null; }
    ultimoFingerprint = '';
    return;
  }
  const { venti, segnatura } = await creaZonePerEvento(incendi);
  if (segnatura === ultimoFingerprint && zonaPericoloGroup) return;
  ultimoFingerprint = segnatura;
  if (zonaPericoloGroup) map.removeLayer(zonaPericoloGroup);
  zonaPericoloGroup = L.layerGroup({ pane: 'overlayPane' }).addTo(map);
  for (const ev of incendi) {
    const raggioRosso = raggioAreaRossaEvento(ev);
    const gialla = creaZonaGialla(map, ev.lat, ev.lng, raggioRosso + 60);
    zonaPericoloGroup.addLayer(gialla);
    try {
      const zona = await creaZonaPericoloDaMeteo(
        map, ev.lat, ev.lng, combustibilePerEvento(ev), venti[ev.id], raggioRosso
      );
      if (zona) zonaPericoloGroup.addLayer(zona);
    } catch (err) {
      console.warn('Vento non disponibile, uso cerchio base:', err);
      const cerchio = creaZonaPericolo(map, ev.lat, ev.lng, 300);
      zonaPericoloGroup.addLayer(cerchio);
    }
  }
}
setInterval(aggiornaZonePericolo, 2000);

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
let pendingReport = null;
let previewCircle = null;
const addEventBtn = document.getElementById('addEventBtn');
const reportHint = document.getElementById('reportHint');

function resetReportUI() {
  addEventBtn.textContent = '📌 Segnala';
  if (reportHint) reportHint.style.display = 'none';
  eventTypeSelect.value = 'incendio';
  eventTypeText.value = '';
  eventTypeText.style.display = 'none';
  document.getElementById('eventDesc').value = '';
}

function rimuoviPreviewCerchio() {
  if (previewCircle) { map.removeLayer(previewCircle); previewCircle = null; }
}

function salvaSegnalazioneConArea(p, layer, data) {
  drawnItems.addLayer(layer);
  fetch('/api/shapes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
    .then(r => r.json())
    .then(s => { layer.options.shapeId = s.id; loadShapes(); })
    .catch(err => console.warn('area non salvata:', err));
  postEvent({ type: p.type, title: p.title, description: p.description, lat: p.lat, lng: p.lng });
}

document.getElementById('addEventBtn').addEventListener('click', () => {
  if (pendingReport) {
    pendingReport = null;
    rimuoviPreviewCerchio();
    resetReportUI();
    return;
  }
  const type = eventTypeSelect.value;
  if (type === 'altro' && !eventTypeText.value.trim()) {
    reportHint.textContent = '⚠️ Scrivi il tipo di pericolo nel campo apposito';
    reportHint.style.display = 'block';
    return;
  }
  addModeActive = true;
  reportHint.textContent = '📍 Tocca la mappa nel punto dell\u2019incendio...';
  reportHint.style.display = 'block';
});

map.on('click', e => {
  if (pendingReport) {
    const raggio = distanzaKm(pendingReport.lat, pendingReport.lng, e.latlng.lat, e.latlng.lng) * 1000;
    const raggioFinale = Math.max(300, Math.round(raggio));
    rimuoviPreviewCerchio();
    const p = pendingReport;
    pendingReport = null;
    const layer = L.circle([p.lat, p.lng], {
      radius: raggioFinale,
      color: '#e63946', fillColor: '#e63946', fillOpacity: 0.25, weight: 2
    });
    resetReportUI();
    salvaSegnalazioneConArea(p, layer, { type: 'circle', center: { lat: p.lat, lng: p.lng }, radius: raggioFinale });
    return;
  }
  if (!addModeActive) return;
  const type = eventTypeSelect.value;
  const title = type === 'incendio' ? 'Incendio' : eventTypeText.value.trim();
  const description = document.getElementById('eventDesc').value.trim();
  addModeActive = false;
  pendingReport = { type, title, description, lat: e.latlng.lat, lng: e.latlng.lng };
  addEventBtn.textContent = '🗑️ Annulla area';
  reportHint.textContent = '⭕ Tocca di nuovo per fissare il raggio dell\u2019area (min 300 m)';
  reportHint.style.display = 'block';
  previewCircle = L.circle([e.latlng.lat, e.latlng.lng], {
    radius: 300,
    color: '#e63946', fillColor: '#e63946', fillOpacity: 0.2, weight: 1
  }).addTo(map);
});

map.on('mousemove', e => {
  if (previewCircle && pendingReport) {
    const r = distanzaKm(pendingReport.lat, pendingReport.lng, e.latlng.lat, e.latlng.lng) * 1000;
    previewCircle.setRadius(Math.max(50, r));
  }
});

// === DISEGNO AREE (salvate sul server, visibili in storico) ===
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

async function loadShapes() {
  const res = await fetch('/api/shapes');
  const list = await res.json();
  shapesCache = list;
  drawnItems.clearLayers();
  list.forEach(s => {
    let layer;
    try {
      if (s.type === 'polygon') {
        layer = L.polygon(s.coords, { color: '#e63946', fillColor: '#e63946', fillOpacity: 0.25 });
      } else if (s.type === 'rectangle') {
        const b = s.bounds;
        if (b && b._southWest && b._northEast) {
          layer = L.rectangle(
            [[b._southWest.lat, b._southWest.lng], [b._northEast.lat, b._northEast.lng]],
            { color: '#e63946', fillColor: '#e63946', fillOpacity: 0.25 }
          );
        } else if (Array.isArray(b)) {
          layer = L.rectangle(b, { color: '#e63946', fillColor: '#e63946', fillOpacity: 0.25 });
        }
      } else if (s.type === 'circle') {
        layer = L.circle(s.center, { radius: s.radius, color: '#e63946', fillColor: '#e63946', fillOpacity: 0.25 });
      }
    } catch (err) {
      console.error('shape non valida', s.id, err);
      return;
    }
    if (layer) {
      layer.options.shapeId = s.id;
      drawnItems.addLayer(layer);
    }
  });
}

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