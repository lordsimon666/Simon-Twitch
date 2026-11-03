'use strict';

// Raid-Erkennung für die offenen Kanäle.
//
// Die eingebetteten Twitch-Player/Chats folgen Raids nicht selbst. Deshalb
// lauscht die App auf dieselben Raid-Ereignisse, die auch twitch.tv benutzt:
//   1. Twitch-Chat (IRC, anonym) liefert die numerische Kanal-ID (room-id).
//   2. Twitchs Echtzeit-Dienst (Hermes) meldet mit dem Thema "raid.<id>",
//      wenn ein Kanal einen Raid startet ("raid_update_v2"), ihn ausführt
//      ("raid_go_v2") oder abbricht ("raid_cancel_v2").
// Beide Verbindungen sind anonym; es wird kein Login benötigt.

const { EventEmitter } = require('events');
const crypto = require('crypto');
const WebSocket = require('ws');

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const HERMES_URL = 'wss://hermes.twitch.tv/v1?clientId=kimne78kx3ncx6brgo4mv6wki5h1ko';
const HEADERS = {
  Origin: 'https://www.twitch.tv',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

const log = (...args) => console.log('[raids]', ...args);

// Hält eine WebSocket-Verbindung offen und baut sie bei Abbruch neu auf
class Connection extends EventEmitter {
  constructor(name, url) {
    super();
    this.name = name;
    this.url = url;
    this.ws = null;
    this.retry = 0;
    this.closed = false;
    this.timer = null;
  }

  open(url = this.url) {
    if (this.closed) return;
    const ws = new WebSocket(url, { headers: HEADERS });
    this.ws = ws;
    ws.on('open', () => {
      this.retry = 0;
      this.emit('open');
    });
    ws.on('message', (data) => this.emit('message', data.toString()));
    ws.on('error', (err) => log(this.name, 'Fehler:', err.message));
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.emit('close');
      this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    if (this.closed || this.timer) return;
    const delay = Math.min(60000, 1000 * 2 ** this.retry++);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.open();
    }, delay);
  }

  // Verbindung gezielt neu aufbauen (z. B. auf Anweisung des Servers)
  restart(url) {
    const old = this.ws;
    this.ws = null;
    if (old) old.terminate();
    if (url) this.open(url);
    else this.scheduleReconnect();
  }

  send(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(text);
      return true;
    }
    return false;
  }

  get ready() {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
  }
}

class RaidWatcher extends EventEmitter {
  constructor() {
    super();
    this.channels = new Set();
    this.ids = new Map();       // login -> room-id
    this.subs = new Map();      // room-id -> Hermes-Abo-ID
    this.irc = null;
    this.hermes = null;
    this.keepaliveTimer = null;
  }

  start() {
    this.startIrc();
    this.startHermes();
  }

  stop() {
    for (const conn of [this.irc, this.hermes]) {
      if (conn) {
        conn.closed = true;
        conn.restart();
      }
    }
  }

  setChannels(list) {
    const next = new Set(list);
    for (const ch of this.channels) {
      if (!next.has(ch)) {
        this.irc?.send(`PART #${ch}`);
        const id = this.ids.get(ch);
        if (id) this.unsubscribe(id);
      }
    }
    for (const ch of next) {
      if (!this.channels.has(ch)) {
        if (this.ids.has(ch)) this.subscribe(this.ids.get(ch));
        else this.irc?.send(`JOIN #${ch}`);
      }
    }
    this.channels = next;
  }

  // ---------------- IRC: room-id der Kanäle ermitteln ----------------
  startIrc() {
    const irc = new Connection('IRC', IRC_URL);
    this.irc = irc;
    irc.on('open', () => {
      irc.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      irc.send('PASS SCHMOOPIIE');
      irc.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      for (const ch of this.channels) irc.send(`JOIN #${ch}`);
    });
    irc.on('message', (text) => {
      for (const line of text.split('\r\n')) {
        if (!line) continue;
        if (line.startsWith('PING')) {
          irc.send(line.replace('PING', 'PONG'));
          continue;
        }
        const m = /^@(\S+) :\S+ ROOMSTATE #(\w+)/.exec(line);
        if (m) {
          const tags = Object.fromEntries(m[1].split(';').map((t) => t.split('=')));
          const channel = m[2].toLowerCase();
          const id = tags['room-id'];
          if (id && !this.ids.has(channel)) {
            this.ids.set(channel, id);
            if (this.channels.has(channel)) this.subscribe(id);
            // Die ID reicht uns; den Chat selbst brauchen wir nicht
            irc.send(`PART #${channel}`);
          }
        }
      }
    });
    irc.open();
  }

  // ---------------- Hermes: Raid-Ereignisse ----------------
  startHermes() {
    const hermes = new Connection('Hermes', HERMES_URL);
    this.hermes = hermes;
    hermes.on('open', () => {
      // Nach einem Neuaufbau alle Abos erneuern
      this.subs.clear();
      for (const ch of this.channels) {
        const id = this.ids.get(ch);
        if (id) this.subscribe(id);
      }
    });
    hermes.on('message', (text) => this.onHermes(text));
    hermes.on('close', () => clearTimeout(this.keepaliveTimer));
    hermes.open();
  }

  armKeepalive(seconds) {
    clearTimeout(this.keepaliveTimer);
    // Kommt länger nichts, ist die Verbindung tot
    this.keepaliveTimer = setTimeout(() => this.hermes.restart(), (seconds || 10) * 3000);
  }

  subscribe(id) {
    if (this.subs.has(id)) return;
    const subId = crypto.randomUUID();
    this.subs.set(id, subId);
    this.hermes?.send(JSON.stringify({
      type: 'subscribe',
      id: crypto.randomUUID(),
      subscribe: { id: subId, type: 'pubsub', pubsub: { topic: `raid.${id}` } },
      timestamp: new Date().toISOString(),
    }));
  }

  unsubscribe(id) {
    const subId = this.subs.get(id);
    if (!subId) return;
    this.subs.delete(id);
    this.hermes?.send(JSON.stringify({
      type: 'unsubscribe',
      id: crypto.randomUUID(),
      unsubscribe: { id: subId },
      timestamp: new Date().toISOString(),
    }));
  }

  loginForId(id) {
    for (const [login, roomId] of this.ids) if (roomId === id) return login;
    return null;
  }

  onHermes(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    switch (msg.type) {
      case 'welcome':
        this.armKeepalive(msg.welcome?.keepaliveSec);
        break;
      case 'keepalive':
        this.armKeepalive(this.lastKeepalive);
        break;
      case 'reconnect':
        this.hermes.restart(msg.reconnect?.url);
        break;
      case 'subscribeResponse':
        if (msg.subscribeResponse?.result !== 'ok') log('Abo abgelehnt:', JSON.stringify(msg.subscribeResponse));
        break;
      case 'notification': {
        let payload;
        try { payload = JSON.parse(msg.notification?.pubsub || '{}'); } catch { return; }
        this.onRaid(payload);
        break;
      }
      default:
        break;
    }
    if (msg.type === 'welcome') this.lastKeepalive = msg.welcome?.keepaliveSec;
  }

  onRaid(payload) {
    const raid = payload.raid;
    if (!raid) return;
    const from = this.loginForId(String(raid.source_id)) || this.loginForId(String(raid.creator_id));
    const to = String(raid.target_login || '').toLowerCase();
    if (!from || !to) return;
    if (payload.type === 'raid_update_v2') this.emit('raid-pending', { from, to, viewers: raid.viewer_count });
    else if (payload.type === 'raid_go_v2') this.emit('raid', { from, to, viewers: raid.viewer_count });
    else if (payload.type === 'raid_cancel_v2') this.emit('raid-cancel', { from, to });
  }
}

module.exports = { RaidWatcher };
