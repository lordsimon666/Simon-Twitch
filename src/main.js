'use strict';

// Simon Twitch – Hauptprozess
// Drei Fenster: Streams (bis zu 4), Chat (Chats der Streams), Browser (twitch.tv).
// Plattformneutral geschrieben (Windows zuerst, Linux-Build über electron-builder).

const { app, BrowserWindow, ipcMain, Menu, shell, screen, session } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MAX_STREAMS = 4;
const CHANNEL_RE = /^[a-zA-Z0-9_]{1,25}$/;
const RENDERER_DIR = path.join(__dirname, 'renderer');

// Twitch-Embeds verlangen einen "parent"-Hostnamen. file:// wird nicht akzeptiert,
// deshalb liefern wir die Oberfläche über einen lokalen HTTP-Server auf localhost aus.
let baseUrl = null;

// ---------------------------------------------------------------------------
// Persistenter Zustand (Kanäle + Fensterpositionen)
// ---------------------------------------------------------------------------
const statePath = () => path.join(app.getPath('userData'), 'state.json');
let state = { channels: [], bounds: {}, skipLoginPrompt: false };

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    state.channels = Array.isArray(data.channels)
      ? data.channels.filter((c) => CHANNEL_RE.test(c)).slice(0, MAX_STREAMS)
      : [];
    state.bounds = data.bounds && typeof data.bounds === 'object' ? data.bounds : {};
    state.skipLoginPrompt = data.skipLoginPrompt === true;
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
    if (name === 'streams') app.quit();
  });

  windows[name] = win;
  return win;
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
}

function addChannel(raw) {
  const channel = String(raw || '').trim().replace(/^@/, '').toLowerCase();
  if (!CHANNEL_RE.test(channel)) return { ok: false, error: `„${raw}“ ist kein gültiger Kanalname.` };
  if (state.channels.includes(channel)) return { ok: false, error: `${channel} läuft bereits.` };
  if (state.channels.length >= MAX_STREAMS) {
    return { ok: false, error: `Maximal ${MAX_STREAMS} Streams – schließe zuerst einen mit dem X.` };
  }
  state.channels.push(channel);
  saveState();
  broadcast();
  return { ok: true, channels: state.channels };
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
ipcMain.handle('config:get', () => ({ maxStreams: MAX_STREAMS, parent: 'localhost' }));
ipcMain.on('window:open', (_e, name) => {
  if (name in windows) createWindow(name);
});

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
    if (!/(^|\.)twitch\.tv$/.test(url.hostname)) return null;
    const first = url.pathname.split('/').filter(Boolean)[0];
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
app.on('web-contents-created', (_e, contents) => {
  // <webview> im Browser-Fenster absichern
  contents.on('will-attach-webview', (_ev, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    if (!/^https:\/\/([a-z0-9-]+\.)*twitch\.tv\//.test(params.src)) params.src = 'https://www.twitch.tv/';
  });

  // Popups (z. B. Twitch-Login aus dem Chat) als eigenes Fenster, fremde Links im Systembrowser
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([a-z0-9-]+\.)*(twitch\.tv|id\.twitch\.tv|passport\.twitch\.tv)\//.test(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#0e0e10' } };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Rechtsklick auf einen Kanal-Link im Browser: direkt zum Multi-Stream hinzufügen
  if (contents.getType() === 'webview') {
    contents.on('context-menu', (_ev, params) => {
      const channel = channelFromUrl(params.linkURL) || channelFromUrl(contents.getURL());
      const items = [];
      if (channel) {
        items.push({ label: `„${channel}“ zum Multi-Stream hinzufügen`, click: () => notify(addChannel(channel)) });
        items.push({ type: 'separator' });
      }
      items.push(
        { label: 'Zurück', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() },
        { label: 'Vor', enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() },
        { label: 'Neu laden', click: () => contents.reload() },
      );
      if (params.selectionText) items.push({ type: 'separator' }, { role: 'copy', label: 'Kopieren' });
      Menu.buildFromTemplate(items).popup();
    });
  }
});

function notify(result) {
  const win = windows.browse;
  if (win && !win.isDestroyed()) win.webContents.send('toast', result.ok ? 'Hinzugefügt.' : result.error);
}

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
        { label: 'Chat', accelerator: 'CmdOrCtrl+2', click: () => createWindow('chat') },
        { label: 'Browser', accelerator: 'CmdOrCtrl+3', click: () => createWindow('browse') },
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
  app.on('before-quit', () => { quitting = true; });
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
    if (auth.loggedIn || state.skipLoginPrompt) openMain();
    else createLoginWindow();
  });
}
