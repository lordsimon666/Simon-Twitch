'use strict';

// Stream-Kachel mit der offiziellen Twitch-Player-Schnittstelle (Twitch.Player).
// Darüber steuert die App:
//   - Autostart beim Hinzufügen
//   - Qualität "Auto"
//   - automatisches Weiterspielen nach Verbindungsabbruch (Watchdog)
//   - Neuaufbau einer Kachel (z. B. stündlich, damit Kanalpunkte weiterlaufen)
// Ist die Schnittstelle nicht erreichbar (z. B. offline beim Start), wird ein
// einfacher Player eingebettet und später automatisch aufgerüstet.

(() => {
  const API_URL = 'https://player.twitch.tv/js/embed/v1.js';
  const WATCHDOG_MS = 5000;
  const STALL_TICKS = 4;          // 4 × 5 s ohne Fortschritt = hängt
  const PAUSED_TICKS = 3;         // so oft play() versuchen, dann neu aufbauen
  const READY_TIMEOUT_MS = 30000; // Player meldet sich nicht = neu aufbauen
  const MANUAL_PAUSE_MS = 2500;   // Pause kurz nach einem Klick = vom Nutzer gewollt

  let apiPromise = null;
  function loadApi() {
    if (window.Twitch?.Player) return Promise.resolve(true);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = API_URL;
      script.onload = () => resolve(Boolean(window.Twitch?.Player));
      script.onerror = () => {
        script.remove();
        apiPromise = null;      // später erneut versuchen
        resolve(false);
      };
      document.head.appendChild(script);
    });
    return apiPromise;
  }

  let uid = 0;
  const players = new Set();
  let settings = { autoQuality: true, autoResume: true };
  let parent = 'localhost';

  class StreamPlayer {
    constructor(channel, host) {
      this.channel = channel;
      this.host = host;            // Element, in das der Player kommt
      this.player = null;
      this.fallback = false;
      this.volume = null;
      this.muted = false;
      this.resetState();
      players.add(this);
      this.create();
    }

    resetState() {
      this.ready = false;
      this.offline = false;
      this.manualPause = false;
      this.lastTime = -1;
      this.stallTicks = 0;
      this.pausedTicks = 0;
      this.createdAt = Date.now();
      this.qualitySet = false;
      this.started = false;
      this.busy = false;
    }

    async create(keepPaused = false) {
      this.host.textContent = '';
      this.resetState();
      this.manualPause = keepPaused;
      const hasApi = await loadApi();
      if (!players.has(this)) return;   // inzwischen geschlossen
      this.host.textContent = '';
      if (!hasApi) {
        this.createFallback();
        return;
      }
      this.fallback = false;
      const box = document.createElement('div');
      box.className = 'player-box';
      box.id = `player-${++uid}`;
      this.host.appendChild(box);
      const P = window.Twitch.Player;
      this.player = new P(box.id, {
        channel: this.channel,
        parent: [parent],
        width: '100%',
        height: '100%',
        autoplay: !keepPaused,
        muted: false,
      });
      const on = (ev, fn) => this.player.addEventListener(ev, fn);
      on(P.READY, () => {
        this.ready = true;
        if (this.volume !== null) {
          this.player.setVolume(this.volume);
          this.player.setMuted(this.muted);
        }
        if (!this.manualPause) {
          this.player.play();
          setTimeout(() => this.tick(), 1500);   // gleich prüfen und notfalls Play drücken
        }
      });
      on(P.PLAYING, () => {
        this.manualPause = false;
        this.offline = false;
        this.pausedTicks = 0;
        this.applyQuality();
      });
      on(P.PLAY, () => { this.manualPause = false; });
      on(P.PAUSE, () => {
        if (Date.now() - (this.host.closest('.tile')?._lastClick || 0) < MANUAL_PAUSE_MS) this.manualPause = true;
      });
      on(P.OFFLINE, () => { this.offline = true; });
      on(P.ONLINE, () => {
        this.offline = false;
        if (!this.manualPause) this.player.play();
      });
      on(P.ENDED, () => { this.offline = true; });
    }

    createFallback() {
      this.fallback = true;
      this.player = null;
      const frame = document.createElement('iframe');
      frame.src = `https://player.twitch.tv/?channel=${encodeURIComponent(this.channel)}&parent=${parent}&autoplay=true&muted=false`;
      frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
      frame.allowFullscreen = true;
      this.host.appendChild(frame);
      frame.addEventListener('load', () => setTimeout(() => this.tick(), 2500));
    }

    applyQuality() {
      if (!settings.autoQuality || !this.player || this.qualitySet) return;
      try {
        if (this.player.getQuality() !== 'auto') this.player.setQuality('auto');
        this.qualitySet = true;
      } catch { /* Player noch nicht bereit */ }
    }

    // Kachel komplett neu aufbauen; Lautstärke und Stummschaltung bleiben erhalten
    rebuild() {
      if (this.player && this.ready) {
        try {
          this.volume = this.player.getVolume();
          this.muted = this.player.getMuted();
        } catch { /* egal */ }
      }
      this.create(this.manualPause);   // absichtlich pausiert? Dann pausiert lassen
    }

    // Wird alle paar Sekunden aufgerufen. Fragt den ECHTEN Zustand des Videos im
    // Player ab (die Twitch-Schnittstelle meldet "spielt" auch bei stehendem Bild).
    async tick() {
      if (this.busy) return;
      this.busy = true;
      try { await this.check(); } finally { this.busy = false; }
    }

    async check() {
      if (this.fallback && navigator.onLine) {
        // Schnittstelle inzwischen erreichbar? Dann aufrüsten.
        loadApi().then((ok) => ok && players.has(this) && this.fallback && this.create());
      }
      // Autostart läuft immer; das Weiterspielen nach Abbrüchen nur, wenn eingeschaltet
      if (this.started && !settings.autoResume) return;
      if (!this.fallback && !this.ready) {
        if (Date.now() - this.createdAt > READY_TIMEOUT_MS && navigator.onLine) this.rebuild();
        return;
      }
      if (this.offline || !navigator.onLine) return;

      const st = await window.twitch.playerState(this.channel);
      if (!st || !players.has(this)) return;
      if (st.paused) {
        if (this.manualPause) return;              // absichtlich pausiert
        this.pausedTicks += 1;
        if (this.pausedTicks > PAUSED_TICKS + 2) { // Klicken hilft nicht → neu aufbauen
          this.rebuild();
          return;
        }
        await window.twitch.kickPlayer(this.channel);   // Play-Taste drücken (zählt als Nutzeraktion)
        return;
      }
      this.pausedTicks = 0;
      this.started = true;
      this.applyQuality();
      if (!settings.autoResume) return;
      if (st.t === this.lastTime) {
        this.stallTicks += 1;
        if (this.stallTicks >= STALL_TICKS) this.rebuild();   // Bild steht → neu verbinden
      } else {
        this.stallTicks = 0;
        this.lastTime = st.t;
      }
    }

    destroy() {
      players.delete(this);
      this.host.textContent = '';
      this.player = null;
    }
  }

  setInterval(() => players.forEach((p) => p.tick()), WATCHDOG_MS);

  // Internet wieder da → hängende Kacheln sofort neu verbinden
  window.addEventListener('online', () => {
    players.forEach(async (p) => {
      const st = await window.twitch.playerState(p.channel);
      if ((!st || st.paused) && !p.manualPause) p.rebuild();
    });
  });

  window.StreamPlayer = {
    create: (channel, host) => new StreamPlayer(channel, host),
    configure(opts) {
      if (opts.parent) parent = opts.parent;
      if (opts.settings) {
        const turnedOnQuality = opts.settings.autoQuality && !settings.autoQuality;
        settings = { ...settings, ...opts.settings };
        if (turnedOnQuality) players.forEach((p) => { p.qualitySet = false; p.applyQuality(); });
      }
    },
    // Alle Kacheln nacheinander neu verbinden (nicht alle gleichzeitig)
    reconnectAll(gapMs = 10000) {
      [...players].forEach((p, i) => setTimeout(() => players.has(p) && p.rebuild(), i * gapMs));
    },
    all: () => [...players],
  };
})();
