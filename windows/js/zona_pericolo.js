/**
 * Zona di pericolo incendio per Leaflet.
 * - creaZonaPericolo: cerchio giallo attorno al punto
 * - creaZonaPericoloDirezionale: settore sottovento (geometria sferica esatta)
 * - ottieniVentoMigliore: vento reale via proxy server (/api/meteo/vento)
 *   che usa METAR Aeronautica Militare (LIBN) -> centraline ARPAP -> Open-Meteo
 * - creaZonaPericoloDaMeteo: zona automatica guidata dal vento
 */

/**
 * Zona gialla circolare di sicurezza immediata attorno all'incendio.
 * @param {L.Map} map
 * @param {number} lat
 * @param {number} lng
 * @param {number} raggioMetri - raggio della zona gialla (es. raggio rosso + 60 m)
 * @returns {L.Circle}
 */
function creaZonaGialla(map, lat, lng, raggioMetri) {
  return L.circle([lat, lng], {
    radius: raggioMetri,
    color: "#e6b800",
    fillColor: "#ffe066",
    fillOpacity: 0.4,
    weight: 2,
  }).addTo(map);
}

/**
 * Crea un cerchio giallo semi-trasparente attorno al punto dell'incendio.
 * @param {L.Map} map
 * @param {number} lat
 * @param {number} lng
 * @param {number} raggioMetri - raggio della zona in metri (default 300)
 * @returns {L.Circle}
 */
function creaZonaPericolo(map, lat, lng, raggioMetri = 300) {
  const zona = L.circle([lat, lng], {
    radius: raggioMetri,
    color: "#ff6b35",
    fillColor: "#ffa94d",
    fillOpacity: 0.45,
    weight: 2,
  }).addTo(map);

  zona.bindTooltip("⚠️ Zona di pericolo - non accedere", {
    permanent: false,
    direction: "top",
  });

  return zona;
}

/**
 * Punto sulla sfera a distanza e azimut dati (formula del punto di destinazione).
 * @param {number} lat
 * @param {number} lng
 * @param {number} distanzaMetri
 * @param {number} azimutGradi - 0=Nord, 90=Est
 * @returns {[number, number]} [lat, lng] del punto di arrivo
 */
function puntoSullaSfera(lat, lng, distanzaMetri, azimutGradi) {
  const R = 6371000;
  const theta = (azimutGradi * Math.PI) / 180;
  const phi1 = (lat * Math.PI) / 180;
  const lambda1 = (lng * Math.PI) / 180;
  const delta = distanzaMetri / R;

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) +
    Math.cos(phi1) * Math.sin(delta) * Math.cos(theta)
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
    );

  return [(phi2 * 180) / Math.PI, (lambda2 * 180) / Math.PI];
}

/**
 * Settore sottovento: usa la formula del punto di destinazione su sfera
 * (distanza e azimut dati), quindi l'ampiezza angolare è esatta a qualunque
 * latitudine (niente approssimazione lineare in gradi).
 *
 * Se raggioInizioMetri > 0 la zona è uno "spicchio anulare" che parte dal
 * bordo della zona rossa (raggio esterno = raggioMetri).
 *
 * @param {L.Map} map
 * @param {number} lat
 * @param {number} lng
 * @param {number} raggioMetri - estensione della zona nella direzione del vento
 * @param {number} direzioneVentoGradi - direzione verso cui soffia il vento (0=Nord, 90=Est)
 * @param {number} aperturaGradi - ampiezza angolare del settore (default 90°)
 * @param {number} [raggioInizioMetri=0] - se >0 la zona parte da questo raggio (bordo zona rossa)
 * @returns {L.Polygon|null}
 */
function creaZonaPericoloDirezionale(
  map,
  lat,
  lng,
  raggioMetri = 500,
  direzioneVentoGradi = 0,
  aperturaGradi = 90,
  raggioInizioMetri = 0
) {
  const passi = 20;
  const inizio = direzioneVentoGradi - aperturaGradi / 2;
  const fine = direzioneVentoGradi + aperturaGradi / 2;

  const usaAnello = raggioInizioMetri > 0 && raggioInizioMetri < raggioMetri;
  const punti = [];

  if (!usaAnello) {
    punti.push(L.latLng(lat, lng));
    for (let i = 0; i <= passi; i++) {
      const angolo = inizio + ((fine - inizio) * i) / passi;
      const [aLat, aLng] = puntoSullaSfera(lat, lng, raggioMetri, angolo);
      punti.push(L.latLng(aLat, aLng));
    }
  } else {
    for (let i = 0; i <= passi; i++) {
      const angolo = inizio + ((fine - inizio) * i) / passi;
      const [aLat, aLng] = puntoSullaSfera(lat, lng, raggioMetri, angolo);
      punti.push(L.latLng(aLat, aLng));
    }
    for (let i = passi; i >= 0; i--) {
      const angolo = inizio + ((fine - inizio) * i) / passi;
      const [aLat, aLng] = puntoSullaSfera(lat, lng, raggioInizioMetri, angolo);
      punti.push(L.latLng(aLat, aLng));
    }
  }

  const settore = L.polygon(punti, {
    color: "#ff6b35",
    fillColor: "#ffa94d",
    fillOpacity: 0.5,
    weight: 2,
  }).addTo(map);

  settore.bindTooltip("⚠️ Zona di pericolo (sottovento) - non accedere", {
    direction: "top",
  });

  return settore;
}

/** Distanza approssimata in km tra due punti (Haversine). */
function distanzaKm(lat1, lng1, lat2, lng2) {
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

/**
 * Modello matematico di propagazione dell'incendio.
 * - La velocità del vento (km/h -> m/s) spinge il fronte in 15 minuti
 * - Raggio minimo 300 m anche a vento calmo
 * - Fattore Kf in base al tipo di combustibile:
 *   urbano 0.5 | prato 1.0 | macchia 1.5 | boscoSecco 2.0
 * - La propagazione avviene nella direzione in cui soffia il vento (vento + 180°)
 *
 * @param {number} vKmh - velocità del vento in km/h
 * @param {number} direzioneVentoGradi - direzione da cui proviene il vento (0=Nord, 90=Est)
 * @param {string} tipoCombustibile - urbano | prato | macchia | boscoSecco
 * @returns {{vMs:number, direzionePropagazione:number, raggioBase:number, Kf:number, raggioFinale:number}}
 */
function calcolaZonaCompleta(vKmh, direzioneVentoGradi, tipoCombustibile) {
  const Kf = {
    urbano: 0.5,
    prato: 1.0,
    macchia: 1.5,
    boscoSecco: 2.0,
  }[tipoCombustibile] ?? 1.0;

  const vMs = vKmh / 3.6;                    // km/h -> m/s
  const TEMPO_SECONDI = 15 * 60;              // 15 minuti
  const RAGGIO_MINIMO = 300;                  // metri, vento calmo

  const raggioBase = Math.max(RAGGIO_MINIMO, vMs * TEMPO_SECONDI);
  const raggioFinale = raggioBase * Kf;

  const direzionePropagazione = (direzioneVentoGradi + 180) % 360;

  return {
    vMs,
    direzionePropagazione,
    raggioBase,
    Kf,
    raggioFinale,
  };
}

/**
 * Ottiene il vento migliore disponibile dal proxy del server
 * (/api/meteo/vento), che a sua volta usa: METAR Aeronautica Militare (LIBN),
 * centraline ARPAP Puglia e infine il modello Open-Meteo.
 * Il proxy evita i blocchi CORS delle API meteo dal browser e aggiunge timeout.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{direzioneGradi:number, velocitaKmh:number, fonte:string}>}
 */
async function ottieniVentoMigliore(lat, lng) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const risposta = await fetch(
      `/api/meteo/vento`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: lat, lng: lng }),
        signal: ctrl.signal
      }
    );
    if (!risposta.ok) throw new Error('Nessun dato vento disponibile (' + risposta.status + ')');
    const dati = await risposta.json();
    if (dati && dati.error) throw new Error(dati.error);
    return dati;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Crea automaticamente la zona di pericolo sottovento con il vento reale
 * attuale. Il raggio è calcolato dal modello matematico calcolaZonaCompleta
 * (propagazione in 15 minuti + fattore combustibile).
 *
 * @param {L.Map} map
 * @param {number} lat
 * @param {number} lng
 * @param {string} tipoCombustibile - urbano | prato | macchia | boscoSecco (default macchia)
 * @param {object} [ventoPrefettato] - dati vento già recuperati (evita un secondo fetch)
 * @param {number} [raggioZonaRossaMetri=0] - raggio dell'area rossa già coperta dal fuoco
 * @returns {Promise<L.Polygon|null>}
 */
async function creaZonaPericoloDaMeteo(map, lat, lng, tipoCombustibile = 'macchia', ventoPrefettato, raggioZonaRossaMetri = 0) {
  const vento = ventoPrefettato || await ottieniVentoMigliore(lat, lng);

  const modello = calcolaZonaCompleta(vento.velocitaKmh, vento.direzioneGradi, tipoCombustibile);

  const margineGiallo = 60;
  const raggioInterno = Math.min(raggioZonaRossaMetri + margineGiallo, modello.raggioFinale);
  if (raggioInterno >= modello.raggioFinale) return null;

  const settore = creaZonaPericoloDirezionale(
    map,
    lat,
    lng,
    modello.raggioFinale,
    modello.direzionePropagazione,
    90,
    raggioInterno
  );

  settore.bindTooltip(
    `⚠️ Zona di pericolo - vento ${vento.velocitaKmh.toFixed(0)} km/h ` +
      `verso ${modello.direzionePropagazione.toFixed(0)}° · raggio teorico ` +
      `${Math.round(modello.raggioFinale)} m (${tipoCombustibile}) - fonte: ${vento.fonte}`,
    { direction: "top" }
  );

  return settore;
}