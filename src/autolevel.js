'use strict';

// Auto-Level (Lautstärke-Automatik) für die Twitch-Player.
//
// Die Funktion `chain` wird NICHT im Hauptprozess ausgeführt, sondern als Text
// in jeden Player-Frame (player.twitch.tv) eingeschleust. Dort leitet sie den
// Ton des <video>-Elements durch diese Web-Audio-Kette:
//
//   Video → Pre (hebt die Player-Lautstärke auf) → Messung
//         → AGC (regelt auf Ziel-Pegel) → Kompressor → Make-up → Limiter
//         → Post (wendet die Player-Lautstärke wieder an) → Ausgang
//
// So arbeitet die Automatik unabhängig vom Lautstärkeregler des Players,
// und der Regler funktioniert weiterhin wie gewohnt.

const DEFAULTS = {
  enabled: false,          // standardmäßig aus
  // Auto-Gain (AGC)
  agcEnabled: true,
  target: -18,             // Ziel-Pegel am Ausgang in dBFS (RMS)
  maxBoost: 12,            // maximale Anhebung in dB
  maxCut: 12,              // maximale Absenkung in dB
  agcAttack: 300,          // ms – wie schnell bei zu lautem Ton abgesenkt wird
  agcRelease: 3000,        // ms – wie schnell bei zu leisem Ton angehoben wird
  gate: -55,               // dBFS – darunter (Stille) wird nicht angehoben
  // Kompressor
  compEnabled: true,
  threshold: -14,          // dB – liegt über dem Ziel-Pegel, fängt also nur Spitzen ab
  ratio: 3,                // :1
  knee: 6,                 // dB
  attack: 10,              // ms
  release: 250,            // ms
  makeup: 0,               // dB
  // Limiter
  limEnabled: true,
  ceiling: -1,             // dBFS
};

const RANGES = {
  target: [-40, 0], maxBoost: [0, 30], maxCut: [0, 30], agcAttack: [10, 5000], agcRelease: [100, 20000],
  gate: [-90, -20], threshold: [-60, 0], ratio: [1, 20], knee: [0, 40], attack: [0, 1000], release: [10, 1000],
  makeup: [-12, 24], ceiling: [-12, 0],
};

// Threshold liegt jeweils so, dass der Kompressor Spitzen über dem Ziel-Pegel
// abfängt, statt gegen den Auto-Gain zu arbeiten.
const PRESETS = {
  sanft: { target: -20, maxBoost: 6, maxCut: 6, agcAttack: 800, agcRelease: 5000, gate: -55, threshold: -12, ratio: 2, knee: 10, attack: 20, release: 300, makeup: 0, ceiling: -1 },
  standard: { target: -18, maxBoost: 12, maxCut: 12, agcAttack: 300, agcRelease: 3000, gate: -55, threshold: -14, ratio: 3, knee: 6, attack: 10, release: 250, makeup: 0, ceiling: -1 },
  stark: { target: -16, maxBoost: 20, maxCut: 18, agcAttack: 100, agcRelease: 1500, gate: -55, threshold: -20, ratio: 6, knee: 3, attack: 3, release: 150, makeup: 4, ceiling: -1 },
  nacht: { target: -24, maxBoost: 18, maxCut: 24, agcAttack: 50, agcRelease: 2000, gate: -55, threshold: -26, ratio: 10, knee: 2, attack: 1, release: 120, makeup: 6, ceiling: -3 },
};

function sanitize(input) {
  const cfg = { ...DEFAULTS };
  if (!input || typeof input !== 'object') return cfg;
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in input)) continue;
    if (typeof DEFAULTS[key] === 'boolean') {
      cfg[key] = Boolean(input[key]);
    } else {
      const n = Number(input[key]);
      if (!Number.isFinite(n)) continue;
      const [lo, hi] = RANGES[key];
      cfg[key] = Math.min(hi, Math.max(lo, n));
    }
  }
  return cfg;
}

/* eslint-disable no-var */
// Läuft im Player-Frame. Gibt Messwerte für die Pegelanzeige zurück.
function chain(cfg) {
  var S = window.__simonAL;
  if (!S && !cfg.enabled) return [];          // nie aktiviert → Ton gar nicht anfassen
  if (!S) S = window.__simonAL = { chains: [] };
  S.cfg = cfg;

  var db2lin = function (db) { return Math.pow(10, db / 20); };
  var lin2db = function (x) { return x > 1e-6 ? 20 * Math.log10(x) : -120; };
  var rms = function (an, buf) {
    an.getFloatTimeDomainData(buf);
    var sum = 0;
    for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return lin2db(Math.sqrt(sum / buf.length));
  };

  function ctx() {
    if (!S.ctx) S.ctx = new AudioContext();
    if (S.ctx.state === 'suspended') S.ctx.resume();
    return S.ctx;
  }

  function build(video) {
    var ac = ctx();
    var c = {
      video: video,
      src: ac.createMediaElementSource(video),
      pre: ac.createGain(), anIn: ac.createAnalyser(), agc: ac.createGain(),
      comp: ac.createDynamicsCompressor(), makeup: ac.createGain(),
      lim: ac.createDynamicsCompressor(), limTrim: ac.createGain(), anOut: ac.createAnalyser(), post: ac.createGain(),
      gainDb: 0, inDb: -120, outDb: -120, on: null,
    };
    c.anIn.fftSize = 2048;
    c.anOut.fftSize = 2048;
    c.bufIn = new Float32Array(2048);
    c.bufOut = new Float32Array(2048);
    c.pre.connect(c.anIn);
    c.pre.connect(c.agc);
    c.agc.connect(c.comp);
    c.comp.connect(c.makeup);
    c.makeup.connect(c.lim);
    c.lim.connect(c.limTrim);
    c.limTrim.connect(c.anOut);
    c.limTrim.connect(c.post);
    c.post.connect(ac.destination);
    S.chains.push(c);
    return c;
  }

  // Ein- oder ausschalten: Ton durch die Kette oder direkt zum Ausgang
  function route(c) {
    var on = Boolean(S.cfg.enabled);
    if (c.on === on) return;
    c.src.disconnect();
    c.src.connect(on ? c.pre : S.ctx.destination);
    c.on = on;
    if (!on) c.gainDb = 0;
  }

  // Chromiums DynamicsCompressor hebt das Signal automatisch an (Make-up =
  // 0,6 × Pegelreduktion bei 0 dBFS). Diese Anhebung wird hier wieder
  // abgezogen, damit Threshold, Make-up und Ceiling exakt stimmen.
  function autoMakeupDb(threshold, ratio) {
    return 0.6 * (-threshold) * (1 - 1 / ratio);
  }

  function params(c) {
    var p = S.cfg;
    var t = S.ctx.currentTime;
    if (p.compEnabled) {
      c.comp.threshold.setTargetAtTime(p.threshold, t, 0.01);
      c.comp.ratio.setTargetAtTime(p.ratio, t, 0.01);
      c.comp.knee.setTargetAtTime(p.knee, t, 0.01);
      c.comp.attack.setTargetAtTime(p.attack / 1000, t, 0.01);
      c.comp.release.setTargetAtTime(p.release / 1000, t, 0.01);
    } else {
      c.comp.threshold.setTargetAtTime(0, t, 0.01);
      c.comp.ratio.setTargetAtTime(1, t, 0.01);
    }
    c.makeup.gain.setTargetAtTime(p.compEnabled ? db2lin(p.makeup - autoMakeupDb(p.threshold, p.ratio)) : 1, t, 0.01);
    c.limTrim.gain.setTargetAtTime(p.limEnabled ? db2lin(-autoMakeupDb(p.ceiling, 20)) : 1, t, 0.01);
    c.lim.threshold.setTargetAtTime(p.limEnabled ? p.ceiling : 0, t, 0.01);
    c.lim.ratio.setTargetAtTime(p.limEnabled ? 20 : 1, t, 0.01);
    c.lim.knee.setTargetAtTime(0, t, 0.01);
    c.lim.attack.setTargetAtTime(0.001, t, 0.01);
    c.lim.release.setTargetAtTime(0.05, t, 0.01);
    // Player-Lautstärke vorher herausrechnen, hinterher wieder anwenden
    var v = c.video.muted ? 0 : c.video.volume;
    c.pre.gain.setTargetAtTime(v > 0.001 ? 1 / v : 1, t, 0.01);
    c.post.gain.setTargetAtTime(v, t, 0.01);
  }

  function step(c, dt) {
    var p = S.cfg;
    c.inDb = rms(c.anIn, c.bufIn);
    c.outDb = rms(c.anOut, c.bufOut);
    if (!p.agcEnabled) {
      c.gainDb = 0;
    } else if (c.inDb > p.gate) {
      // Regelt so, dass der AUSGANG (nach Kompressor und Limiter) den Ziel-Pegel erreicht
      var err = p.target - c.outDb;
      var tau = err < 0 ? p.agcAttack : p.agcRelease;
      c.gainDb += err * (1 - Math.exp(-dt / tau));
      c.gainDb = Math.max(-p.maxCut, Math.min(p.maxBoost, c.gainDb));
    }
    c.agc.gain.setTargetAtTime(db2lin(c.gainDb), S.ctx.currentTime, 0.02);
  }

  // Neue <video>-Elemente einbinden (nur wenn aktiviert)
  if (cfg.enabled) {
    var videos = document.querySelectorAll('video');
    for (var i = 0; i < videos.length; i++) {
      var known = false;
      for (var j = 0; j < S.chains.length; j++) if (S.chains[j].video === videos[i]) known = true;
      if (!known) {
        try { build(videos[i]); } catch (e) { /* Element schon anderweitig verbunden */ }
      }
    }
  }
  S.chains.forEach(function (c) { route(c); params(c); });

  if (!S.timer) {
    var last = performance.now();
    S.timer = setInterval(function () {
      var now = performance.now();
      var dt = now - last;
      last = now;
      S.chains.forEach(function (c) {
        if (c.on) { params(c); step(c, dt); }
      });
    }, 50);
  }

  return S.chains.filter(function (c) { return c.on && document.contains(c.video); }).map(function (c) {
    return {
      in: Math.round(c.inDb * 10) / 10,
      gain: Math.round(c.gainDb * 10) / 10,
      comp: Math.round(c.comp.reduction * 10) / 10,
      lim: Math.round(c.lim.reduction * 10) / 10,
      out: Math.round(c.outDb * 10) / 10,
    };
  });
}
/* eslint-enable no-var */

function script(cfg) {
  return `(${chain.toString()})(${JSON.stringify(cfg)})`;
}

module.exports = { DEFAULTS, RANGES, PRESETS, sanitize, script, chain };
