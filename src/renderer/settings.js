'use strict';

(async () => {
  const data = await window.twitch.getSettings();
  const RANGES = {
    target: [-40, 0], maxBoost: [0, 30], maxCut: [0, 30], agcAttack: [10, 5000], agcRelease: [100, 20000],
    gate: [-90, -20], threshold: [-60, 0], ratio: [1, 20], knee: [0, 40], attack: [0, 1000], release: [10, 1000],
    makeup: [-12, 24], ceiling: [-12, 0],
  };
  let cfg = { ...data.autoLevel };

  // ---------------- Allgemeine Einstellungen ----------------
  const general = (st) => {
    for (const el of document.querySelectorAll('[data-setting]')) {
      const key = el.dataset.setting;
      if (key === 'askLogin') el.checked = !st.skipLoginPrompt;
      else if (el.type === 'checkbox') el.checked = Boolean(st[key]);
      else el.value = String(st[key]);
    }
  };
  general(data);
  for (const el of document.querySelectorAll('[data-setting]')) {
    el.addEventListener('change', () => {
      const key = el.dataset.setting;
      if (key === 'askLogin') window.twitch.setSetting('skipLoginPrompt', !el.checked);
      else if (el.type === 'checkbox') window.twitch.setSetting(key, el.checked);
      else window.twitch.setSetting(key, Number(el.value));
    });
  }
  window.twitch.onSettings(general);

  // ---------------- Auto-Level ----------------
  const enabled = document.getElementById('al-enabled');
  const card = document.getElementById('al-card');
  const inputs = {};   // key -> { range, number }

  for (const el of document.querySelectorAll('.param')) {
    const key = el.dataset.key;
    const [lo, hi] = RANGES[key];
    const step = el.dataset.step;
    el.innerHTML = `
      <label for="n-${key}">${el.dataset.label}</label>
      <input type="range" min="${lo}" max="${hi}" step="${step}" id="r-${key}">
      <span class="num"><input type="number" min="${lo}" max="${hi}" step="${step}" id="n-${key}"><em>${el.dataset.unit}</em></span>`;
    const range = el.querySelector('input[type=range]');
    const number = el.querySelector('input[type=number]');
    inputs[key] = { range, number };
    range.addEventListener('input', () => { number.value = range.value; change(key, range.value); });
    number.addEventListener('change', () => {
      const v = Math.min(hi, Math.max(lo, Number(number.value)));
      number.value = v;
      range.value = v;
      change(key, v);
    });
  }

  function render() {
    enabled.checked = cfg.enabled;
    card.classList.toggle('off', !cfg.enabled);
    for (const [key, { range, number }] of Object.entries(inputs)) {
      if (document.activeElement !== number) number.value = cfg[key];
      range.value = cfg[key];
    }
    for (const el of document.querySelectorAll('[data-al]')) el.checked = Boolean(cfg[el.dataset.al]);
    for (const stage of document.querySelectorAll('.stage')) {
      const sw = stage.querySelector('[data-al]');
      stage.classList.toggle('bypassed', Boolean(sw && !sw.checked));
    }
  }

  let timer = null;
  function save() {
    clearTimeout(timer);
    timer = setTimeout(async () => { cfg = await window.twitch.setAutoLevel(cfg); }, 60);
  }
  function change(key, value) {
    cfg[key] = Number(value);
    save();
  }

  enabled.addEventListener('change', () => { cfg.enabled = enabled.checked; render(); save(); });
  for (const el of document.querySelectorAll('[data-al]')) {
    el.addEventListener('change', () => { cfg[el.dataset.al] = el.checked; render(); save(); });
  }
  for (const btn of document.querySelectorAll('[data-preset]')) {
    btn.addEventListener('click', () => {
      cfg = { ...cfg, ...data.presets[btn.dataset.preset] };
      render();
      save();
      ui.toast(`Preset „${btn.textContent}“ geladen.`);
    });
  }
  document.getElementById('al-reset').addEventListener('click', () => {
    cfg = { ...data.autoLevelDefaults, enabled: cfg.enabled };
    render();
    save();
    ui.toast('Auto-Level auf Standardwerte zurückgesetzt.');
  });
  window.twitch.onAutoLevel((next) => { cfg = next; render(); });
  render();

  // ---------------- Pegelanzeige ----------------
  const meters = document.getElementById('meters');
  // Balken für einen dB-Wert; Pegel von -60 bis 0 dBFS, Gain von -30 bis +30 dB
  const levelBar = (db) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  const fmt = (db, plus) => (db <= -119 ? '–∞' : `${plus && db > 0 ? '+' : ''}${db.toFixed(1)}`);

  window.twitch.onAutoLevelStats((list) => {
    const active = list.filter((x) => x.stats);
    if (!cfg.enabled || !active.length) {
      meters.innerHTML = `<p class="muted small">${cfg.enabled ? 'Kein laufender Stream gefunden.' : 'Schalte Auto-Level ein, um die Pegel der laufenden Streams zu sehen.'}</p>`;
      return;
    }
    meters.innerHTML = active.map(({ channel, stats: s }) => `
      <div class="meter">
        <div class="meter-name">${channel.replace(/[^\w]/g, '')}</div>
        <div class="meter-row"><span>Eingang</span><div class="bar"><i style="width:${levelBar(s.in)}%"></i><b style="left:${levelBar(cfg.target)}%" title="Ziel-Pegel"></b></div><em>${fmt(s.in)} dBFS</em></div>
        <div class="meter-row"><span>Auto-Gain</span><div class="bar center"><i class="${s.gain >= 0 ? 'pos' : 'neg'}" style="${s.gain >= 0 ? 'left:50%' : `left:${50 + (s.gain / 30) * 50}%`};width:${Math.min(50, (Math.abs(s.gain) / 30) * 50)}%"></i></div><em>${fmt(s.gain, true)} dB</em></div>
        <div class="meter-row"><span>Kompressor</span><div class="bar gr"><i style="width:${Math.min(100, (-s.comp / 24) * 100)}%"></i></div><em>${fmt(s.comp)} dB</em></div>
        <div class="meter-row"><span>Limiter</span><div class="bar gr"><i style="width:${Math.min(100, (-s.lim / 12) * 100)}%"></i></div><em>${fmt(s.lim)} dB</em></div>
        <div class="meter-row"><span>Ausgang</span><div class="bar out"><i style="width:${levelBar(s.out)}%"></i></div><em>${fmt(s.out)} dBFS</em></div>
      </div>`).join('');
  });
})();
