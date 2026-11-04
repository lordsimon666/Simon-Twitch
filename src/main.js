'use strict';

// Simon Twitch – Hauptprozess
// Drei Fenster: Streams (bis zu 4), Chat (Chats der Streams), Browser (twitch.tv).
// Plattformneutral geschrieben (Windows zuerst, Linux-Build über electron-builder).

const { app, BrowserWindow, ipcMain, Menu, shell, screen, session, clipboard } = require('electron');
const http = require('http');
const { RaidWatcher } = require('./raids');
const fs = require('fs');
const path = require('path');

const MAX_STREAMS = 4;
const CHANNEL_RE = /^[a-zA-Z0-9_]{1,25}$/;
const RENDERER_DIR = path.join(__dirname, 'renderer');
const APP_ICON = path.join(__dirname, 'icon.png');

// Twitch-Embeds verlangen einen "parent"-Hostnamen. file:// wird nicht akzeptiert,
// deshalb liefern wir die Oberfläche über einen lokalen HTTP-Server auf localhost aus.
let baseUrl = null;

// ---------------------------------------------------------------------------
// Persistenter Zustand (Kanäle + Fensterpositionen)
// ---------------------------------------------------------------------------
const statePath = () => path.join(app.getPath('userData'), 'state.json');
let state = { channels: [], bounds: {}, skipLoginPrompt: false, followRaids: true };

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    state.channels = Array.isArray(data.channels)
      ? data.channels.filter((c) => CHANNEL_RE.test(c)).slice(0, MAX_STREAMS)
      : [];
    state.bounds = data.bounds && typeof data.bounds === 'object' ? data.bounds : {};
    state.skipLoginPrompt = data.skipLoginPrompt === true;
    state.followRaids = data.followRaids !== false;
  } catch {
    /* erster Start oder defekte Datei */
  }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(statePath()), { recursive: true });
      fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('Zustand konnte nicht gespeichert werden:', err);
    }
  }, 300);
}

// ---------------------------------------------------------------------------
// Lokaler Server für die Oberfläche
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.normalize(path.join(RENDERER_DIR, urlPath));
      if (!file.startsWith(RENDERER_DIR + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    // Nur lokal erreichbar
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

// ---------------------------------------------------------------------------
// Fenster
// ---------------------------------------------------------------------------
const windows = { streams: null, chat: null, browse: null };
let quitting = false;

function defaultBounds(name) {
  const { workArea } = screen.getPrimaryDisplay();
  const chatW = Math.round(workArea.width * 0.22);
  const streamW = workArea.width - chatW;
  const streamH = Math.round(workArea.height * 0.68);
  switch (name) {
    case 'streams':
      return { x: workArea.x, y: workArea.y, width: streamW, height: streamH };
    case 'chat':
      return { x: workArea.x + streamW, y: workArea.y, width: chatW, height: workArea.height };
    default:
      return { x: workArea.x, y: workArea.y + streamH, width: streamW, height: workArea.height - streamH };
  }
}

function boundsVisible(b) {
  return screen.getAllDisplays().some(({ workArea: w }) =>
    b.x < w.x + w.width && b.x + b.width > w.x && b.y < w.y + w.height && b.y + b.height > w.y);
}

function createWindow(name) {
  if (windows[name] && !windows[name].isDestroyed()) {
    windows[name].show();
    windows[name].focus();
    return windows[name];
  }

  const titles = { streams: 'Simon Twitch – Streams', chat: 'Simon Twitch – Chat', browse: 'Simon Twitch – Browser' };
  const saved = state.bounds[name];
  const bounds = saved && boundsVisible(saved) ? saved : defaultBounds(name);

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 240,
    title: titles[name],
    backgroundColor: '#0e0e10',
    autoHideMenuBar: true,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: name === 'browse',
    },
  });

  if (saved && saved.maximized) win.maximize();
  win.loadURL(`${baseUrl}/${name}.html`);

  const remember = () => {
    if (win.isDestroyed()) return;
    state.bounds[name] = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    saveState();
  };
  win.on('resize', remember);
  win.on('move', remember);

  // Chat und Browser werden nur versteckt; das Schließen des Stream-Fensters beendet die App.
  win.on('close', (e) => {
    if (name !== 'streams' && !quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    windows[name] = null;
    sendWindowState();
    if (name === 'streams') app.quit();
  });
  for (const ev of ['show', 'hide', 'minimize', 'restore']) win.on(ev, sendWindowState);

  windows[name] = win;
  return win;
}

// Ist ein Fenster gerade sichtbar (offen und nicht minimiert)?
function isOpen(name) {
  const win = windows[name];
  return Boolean(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized());
}

function windowState() {
  return { chat: isOpen('chat'), browse: isOpen('browse') };
}

// Damit die Buttons im Stream-Fenster zeigen, welche Fenster offen sind
function sendWindowState() {
  const win = windows.streams;
  if (win && !win.isDestroyed()) win.webContents.send('windows:state', windowState());
}

// Buttons "Chat" / "Browser": offenes Fenster schließen (verstecken), sonst öffnen
function toggleWindow(name) {
  if (name !== 'streams' && isOpen(name)) windows[name].hide();
  else createWindow(name);
}

// ---------------------------------------------------------------------------
// Anmeldung (gilt für die ganze App: Twitch-Cookies liegen in der gemeinsamen Session)
// ---------------------------------------------------------------------------
let auth = { loggedIn: false, user: null };
let loginWindow = null;   // Auswahl "Anmelden / Als Gast"
let loginPopup = null;    // twitch.tv/login
let mainOpened = false;

async function readAuth() {
  const cookies = await session.defaultSession.cookies.get({ domain: 'twitch.tv' });
  const token = cookies.find((c) => c.name === 'auth-token' && c.value);
  const login = cookies.find((c) => c.name === 'login' && c.value);
  return { loggedIn: Boolean(token), user: token && login ? decodeURIComponent(login.value) : null };
}

function sendAll(channel, payload) {
  const all = [...Object.values(windows), loginWindow];
  for (const win of all) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

// Chat und Browser neu laden, damit die eingebetteten Twitch-Seiten den neuen Login sehen
function reloadTwitchViews() {
  const chat = windows.chat;
  if (chat && !chat.isDestroyed()) chat.webContents.reload();
  const browse = windows.browse;
  if (browse && !browse.isDestroyed()) browse.webContents.send('view:reload');
}

let authTimer = null;
function scheduleAuthCheck() {
  clearTimeout(authTimer);
  authTimer = setTimeout(async () => {
    const next = await readAuth();
    const changed = next.loggedIn !== auth.loggedIn || next.user !== auth.user;
    auth = next;
    if (!changed) return;
    sendAll('auth:changed', auth);
    if (auth.loggedIn) {
      if (loginPopup && !loginPopup.isDestroyed()) loginPopup.close();
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close(); // öffnet die Hauptfenster
    }
    reloadTwitchViews();
  }, 500);
}

function openLoginPopup() {
  if (loginPopup && !loginPopup.isDestroyed()) {
    loginPopup.focus();
    return;
  }
  loginPopup = new BrowserWindow({
    width: 520,
    height: 760,
    title: 'Bei Twitch anmelden',
    backgroundColor: '#0e0e10',
    autoHideMenuBar: true,
    icon: APP_ICON,
    parent: loginWindow && !loginWindow.isDestroyed() ? loginWindow : undefined,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  loginPopup.loadURL('https://www.twitch.tv/login');
  loginPopup.on('closed', () => { loginPopup = null; });
}

async function logout() {
  const ses = session.defaultSession;
  const cookies = await ses.cookies.get({ domain: 'twitch.tv' });
  await Promise.all(cookies.map((c) => {
    const host = c.domain.replace(/^\./, '');
    return ses.cookies.remove(`http${c.secure ? 's' : ''}://${host}${c.path || '/'}`, c.name).catch(() => {});
  }));
  for (const origin of ['https://www.twitch.tv', 'https://twitch.tv', 'https://passport.twitch.tv', 'https://id.twitch.tv']) {
    await ses.clearStorageData({ origin, storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] }).catch(() => {});
  }
  scheduleAuthCheck();
}

function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 440,
    height: 480,
    resizable: false,
    maximizable: false,
    title: 'Simon Twitch – Anmelden',
    backgroundColor: '#0e0e10',
    autoHideMenuBar: true,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loginWindow.loadURL(`${baseUrl}/login.html`);
  // Schließen ohne Anmeldung = als Gast weiter
  loginWindow.on('close', () => {
    if (!quitting) openMain();
  });
  loginWindow.on('closed', () => { loginWindow = null; });
}

function openMain() {
  if (mainOpened) return;
  mainOpened = true;
  createWindow('streams');
  createWindow('chat');
  createWindow('browse');
}

ipcMain.handle('auth:get', () => auth);
ipcMain.on('auth:login', () => openLoginPopup());
ipcMain.on('auth:logout', () => logout());
ipcMain.on('auth:guest', (_e, remember) => {
  state.skipLoginPrompt = Boolean(remember);
  saveState();
  if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
});

// ---------------------------------------------------------------------------
// Kanalverwaltung
// ---------------------------------------------------------------------------
function broadcast() {
  sendAll('channels:changed', state.channels);
  raids.setChannels(state.channels);
}

function toast(message, name = 'streams') {
  const win = windows[name];
  if (win && !win.isDestroyed()) win.webContents.send('toast', message);
}

// ---------------------------------------------------------------------------
// Raids: raidet ein offener Kanal, wechselt seine Kachel (und sein Chat) zum Ziel
// ---------------------------------------------------------------------------
const raids = new RaidWatcher();
const announcedRaids = new Set();

raids.on('raid-pending', ({ from, to }) => {
  const key = `${from}>${to}`;
  if (announcedRaids.has(key) || !state.channels.includes(from)) return;
  announcedRaids.add(key);
  toast(state.followRaids
    ? `${from} raidet gleich ${to} – die Kachel wechselt automatisch.`
    : `${from} raidet gleich ${to}.`);
});

raids.on('raid-cancel', ({ from, to }) => {
  announcedRaids.delete(`${from}>${to}`);
  if (state.channels.includes(from)) toast(`${from} hat den Raid abgebrochen.`);
});

raids.on('raid', ({ from, to }) => {
  announcedRaids.delete(`${from}>${to}`);
  if (!state.channels.includes(from)) return;
  if (!state.followRaids) {
    toast(`${from} hat ${to} geraidet. Rechtsklick → „${to} öffnen“ oder Kanal hinzufügen.`);
    return;
  }
  followRaid(from, to);
});

function followRaid(from, to) {
  const index = state.channels.indexOf(from);
  if (index === -1) return;
  if (state.channels.includes(to)) {
    state.channels.splice(index, 1);   // Ziel läuft schon – alte Kachel einfach schließen
    toast(`${from} hat ${to} geraidet – ${to} läuft bereits.`);
  } else {
    state.channels[index] = to;        // gleiche Position im Raster
    toast(`${from} hat ${to} geraidet – du bist mitgekommen.`);
  }
  saveState();
  broadcast();
}

// Wandelt eine Eingabe in einen Kanalnamen um. Erlaubt sind Namen ("papaplatte", "@papaplatte")
// und Twitch-Links ("https://www.twitch.tv/papaplatte", "twitch.tv/papaplatte",
// "m.twitch.tv/papaplatte", Popout-/Embed-Links, "player.twitch.tv/?channel=papaplatte").
function parseChannelInput(raw) {
  const text = String(raw || '').trim().replace(/^@/, '');
  if (CHANNEL_RE.test(text)) return { channel: text.toLowerCase() };
  if (/twitch\.tv/i.test(text) || /^https?:\/\//i.test(text)) {
    const channel = channelFromUrl(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return channel ? { channel } : { error: `Im Link „${text}“ steckt kein Twitch-Kanal.` };
  }
  return { error: `„${text}“ ist kein gültiger Kanalname oder Twitch-Link.` };
}

function addOne(raw) {
  const { channel, error } = parseChannelInput(raw);
  if (error) return error;
  if (state.channels.includes(channel)) return `${channel} läuft bereits.`;
  if (state.channels.length >= MAX_STREAMS) {
    return `Maximal ${MAX_STREAMS} Streams – schließe zuerst einen mit dem X.`;
  }
  state.channels.push(channel);
  return null;
}

// Mehrere Einträge auf einmal sind möglich (durch Leerzeichen, Komma oder Zeilenumbruch getrennt)
function addChannel(raw) {
  const parts = String(raw || '').split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) return { ok: false, error: 'Bitte einen Kanalnamen oder Twitch-Link eingeben.' };
  const before = state.channels.length;
  const errors = parts.map(addOne).filter(Boolean);
  const added = state.channels.length - before;
  if (added) {
    saveState();
    broadcast();
  }
  return { ok: added > 0, error: errors.join(' '), channels: state.channels };
}

function removeChannel(channel) {
  state.channels = state.channels.filter((c) => c !== channel);
  saveState();
  broadcast();
  return { ok: true, channels: state.channels };
}

ipcMain.handle('channels:get', () => state.channels);
ipcMain.handle('channels:add', (_e, channel) => addChannel(channel));
ipcMain.handle('channels:remove', (_e, channel) => removeChannel(channel));
ipcMain.handle('channels:replace', (_e, from, to) => {
  const parsed = parseChannelInput(to);
  if (parsed.error) return { ok: false, error: parsed.error };
  followRaid(from, parsed.channel);
  return { ok: true, channels: state.channels };
});
ipcMain.handle('config:get', () => ({ maxStreams: MAX_STREAMS, parent: 'localhost' }));
ipcMain.on('window:open', (_e, name) => {
  if (name in windows) createWindow(name);
});
ipcMain.on('window:toggle', (_e, name) => {
  if (name in windows) toggleWindow(name);
});
ipcMain.handle('windows:get', () => windowState());

// ---------------------------------------------------------------------------
// Twitch-URLs
// ---------------------------------------------------------------------------
const RESERVED_PATHS = new Set([
  'directory', 'videos', 'settings', 'search', 'p', 'downloads', 'jobs', 'turbo', 'subscriptions',
  'inventory', 'wallet', 'drops', 'friends', 'messages', 'prime', 'store', 'u', 'login', 'signup',
  'logout', 'popout', 'moderator', 'following', 'clips', 'embed', 'team', 'collections', 'payments',
]);

function channelFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)twitch\.tv$/i.test(url.hostname)) return null;
    // player.twitch.tv/?channel=name
    const param = url.searchParams.get('channel');
    if (param && CHANNEL_RE.test(param)) return param.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    // twitch.tv/popout/name/chat, twitch.tv/embed/name/chat, twitch.tv/moderator/name
    let first = parts[0];
    if (first && ['popout', 'embed', 'moderator'].includes(first.toLowerCase())) first = parts[1];
    if (!first || RESERVED_PATHS.has(first.toLowerCase()) || !CHANNEL_RE.test(first)) return null;
    return first.toLowerCase();
  } catch {
    return null;
  }
}

ipcMain.handle('url:channel', (_e, url) => channelFromUrl(url));

// ---------------------------------------------------------------------------
// Sicherheit & Verhalten eingebetteter Inhalte
// ---------------------------------------------------------------------------
// Kanal aus einem eingebetteten Player-/Chat-Frame ermitteln
function channelFromFrame(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'player.twitch.tv') return u.searchParams.get('channel');
    const m = /^\/embed\/([a-zA-Z0-9_]+)\/chat/.exec(u.pathname);
    if (u.hostname.endsWith('twitch.tv') && m) return m[1].toLowerCase();
  } catch { /* kein gültiger Link */ }
  return null;
}

function openInBrowser(url) {
  const win = createWindow('browse');
  win.webContents.send('view:load', url);
}

const LOGIN_URL = /^https:\/\/((id|passport)\.twitch\.tv\/|www\.twitch\.tv\/(login|signup|passport-callback)|twitch\.tv\/(login|signup))/;

function buildContextMenu(contents, params) {
  const items = [];
  const sep = () => { if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' }); };
  const isWebview = contents.getType() === 'webview';
  const frameChannel = channelFromFrame(params.frameURL || '');
  const linkChannel = channelFromUrl(params.linkURL);
  const pageChannel = isWebview ? channelFromUrl(contents.getURL()) : null;

  // Eingabefelder (z. B. Chat-Nachricht): Ausschneiden/Kopieren/Einfügen
  if (params.isEditable) {
    items.push(
      { label: 'Rückgängig', role: 'undo', enabled: params.editFlags.canUndo },
      { label: 'Wiederholen', role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { label: 'Ausschneiden', role: 'cut', enabled: params.editFlags.canCut },
      { label: 'Kopieren', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'Einfügen', role: 'paste', enabled: params.editFlags.canPaste },
      { label: 'Alles auswählen', role: 'selectAll' },
    );
    if (params.dictionarySuggestions?.length) {
      sep();
      for (const word of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: word, click: () => contents.replaceMisspelling(word) });
      }
    }
  } else if (params.selectionText) {
    items.push({ label: 'Kopieren', role: 'copy' });
  }

  // Links
  if (params.linkURL) {
    sep();
    if (linkChannel) {
      items.push({ label: `„${linkChannel}“ zum Multi-Stream hinzufügen`, click: () => toast(addChannel(linkChannel).error || `${linkChannel} hinzugefügt.`, isWebview ? 'browse' : 'streams') });
      if (frameChannel && linkChannel !== frameChannel && state.channels.includes(frameChannel)) {
        items.push({ label: `„${frameChannel}“ durch „${linkChannel}“ ersetzen`, click: () => followRaid(frameChannel, linkChannel) });
      }
    }
    if (/twitch\.tv/.test(params.linkURL) && !isWebview) items.push({ label: 'Im Browser-Fenster öffnen', click: () => openInBrowser(params.linkURL) });
    items.push({ label: 'Im Systembrowser öffnen', click: () => shell.openExternal(params.linkURL) });
    items.push({ label: 'Link kopieren', click: () => clipboard.writeText(params.linkURL) });
  }

  // Stream-Kachel bzw. Chat eines Kanals
  if (frameChannel && state.channels.includes(frameChannel)) {
    sep();
    items.push(
      { label: `${frameChannel}: neu laden`, click: () => params.frame?.reload() },
      { label: `${frameChannel}: auf twitch.tv öffnen`, click: () => openInBrowser(`https://www.twitch.tv/${frameChannel}`) },
      { label: `${frameChannel}: schließen`, click: () => removeChannel(frameChannel) },
    );
  }

  // Browser-Fenster
  if (isWebview) {
    if (pageChannel && !linkChannel) {
      sep();
      items.push({ label: `„${pageChannel}“ zum Multi-Stream hinzufügen`, click: () => toast(addChannel(pageChannel).error || `${pageChannel} hinzugefügt.`, 'browse') });
    }
    sep();
    items.push(
      { label: 'Zurück', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
      { label: 'Vor', enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() },
      { label: 'Neu laden', click: () => contents.reload() },
      { label: 'Adresse kopieren', click: () => clipboard.writeText(contents.getURL()) },
    );
  }

  // Allgemeine Einträge für unsere eigenen Fenster
  if (!isWebview && !frameChannel) {
    sep();
    items.push(
      { label: 'Streams-Fenster', click: () => createWindow('streams') },
      { label: 'Chat-Fenster', click: () => createWindow('chat') },
      { label: 'Browser-Fenster', click: () => createWindow('browse') },
      { type: 'separator' },
      { label: 'Fenster neu laden', click: () => contents.reload() },
    );
  }
  if (items[items.length - 1]?.type === 'separator') items.pop();
  return items;
}

app.on('web-contents-created', (_e, contents) => {
  // <webview> im Browser-Fenster absichern
  contents.on('will-attach-webview', (_ev, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    if (!/^https:\/\/([a-z0-9-]+\.)*twitch\.tv\//.test(params.src)) params.src = 'https://www.twitch.tv/';
  });

  // Popups: Twitch-Login als eigenes Fenster, Kanal-Links (z. B. "Raid beitreten" im Chat)
  // im Browser-Fenster bzw. als Kachel, alles andere im Systembrowser
  contents.setWindowOpenHandler(({ url, referrer }) => {
    if (LOGIN_URL.test(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#0e0e10', icon: APP_ICON } };
    }
    const target = channelFromUrl(url);
    const source = channelFromFrame(referrer?.url || '');
    if (target && source && state.channels.includes(source) && target !== source) {
      followRaid(source, target);          // z. B. "Raid beitreten" im Chat von source
    } else if (/^https:\/\/([a-z0-9-]+\.)*twitch\.tv\//.test(url)) {
      openInBrowser(url);
    } else if (/^https?:\/\//.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Will ein eingebetteter Player/Chat selbst zu einer Kanalseite wechseln (Raid),
  // wechseln wir stattdessen die Kachel
  contents.on('will-frame-navigate', (details) => {
    if (!details.frame || details.frame === contents.mainFrame || contents.getType() === 'webview') return;
    const source = channelFromFrame(details.frame.url);
    const target = channelFromFrame(details.url) || channelFromUrl(details.url);
    if (source && target && target !== source && state.channels.includes(source)) {
      details.preventDefault();
      followRaid(source, target);
    }
  });

  // Rechtsklick-Menü überall (Electron bringt von sich aus keins mit)
  contents.on('context-menu', (_ev, params) => {
    const items = buildContextMenu(contents, params);
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
});

// ---------------------------------------------------------------------------
// Menü
// ---------------------------------------------------------------------------
function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'Fenster',
      submenu: [
        { label: 'Streams', accelerator: 'CmdOrCtrl+1', click: () => createWindow('streams') },
        { label: 'Chat ein/aus', accelerator: 'CmdOrCtrl+2', click: () => toggleWindow('chat') },
        { label: 'Browser ein/aus', accelerator: 'CmdOrCtrl+3', click: () => toggleWindow('browse') },
        { type: 'separator' },
        { label: 'Neu laden', role: 'reload' },
        { label: 'Vollbild', role: 'togglefullscreen' },
        { label: 'Entwicklertools', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Beenden', role: 'quit' },
      ],
    },
    {
      label: 'Konto',
      submenu: [
        { label: 'Bei Twitch anmelden', click: () => openLoginPopup() },
        { label: 'Abmelden', click: () => logout() },
        { type: 'separator' },
        {
          label: 'Beim Start nach Anmeldung fragen',
          type: 'checkbox',
          checked: !state.skipLoginPrompt,
          click: (item) => { state.skipLoginPrompt = !item.checked; saveState(); },
        },
      ],
    },
    {
      label: 'Streams',
      submenu: [
        {
          label: 'Raids automatisch folgen',
          type: 'checkbox',
          checked: state.followRaids,
          click: (item) => { state.followRaids = item.checked; saveState(); },
        },
      ],
    },
    { label: 'Bearbeiten', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => createWindow('streams'));
  app.on('before-quit', () => { quitting = true; raids.stop(); });
  app.on('window-all-closed', () => app.quit());

  // Ohne den "Electron/…"-Zusatz behandelt twitch.tv (Login, Captcha) die App wie einen normalen Chrome
  app.userAgentFallback = app.userAgentFallback
    .replace(/\s*Electron\/\S+/, '')
    .replace(new RegExp(`\\s*[^\\s/]+\\/${app.getVersion().replace(/\./g, '\\.')}(?=\\s)`), '');

  app.whenReady().then(async () => {
    loadState();
    const port = await startServer();
    baseUrl = `http://localhost:${port}`;
    auth = await readAuth();
    session.defaultSession.cookies.on('changed', (_ev, cookie) => {
      if (/twitch\.tv$/.test(cookie.domain) && (cookie.name === 'auth-token' || cookie.name === 'login')) {
        scheduleAuthCheck();
      }
    });
    buildMenu();
    raids.start();
    raids.setChannels(state.channels);
    if (auth.loggedIn || state.skipLoginPrompt) openMain();
    else createLoginWindow();
  });
}

// Nur für automatische Tests
if (process.env.SIMON_TWITCH_TEST) global.simonTest = { raids, buildContextMenu, state: () => state };
