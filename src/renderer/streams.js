'use strict';

(async () => {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');
  const addBtn = document.getElementById('add-btn');
  const addInput = document.getElementById('add-input');
  const { maxStreams, parent, settings } = await window.twitch.getConfig();
  StreamPlayer.configure({ parent, settings });
  window.twitch.onSettings((st) => StreamPlayer.configure({ settings: st }));
  const players = new Map();   // Kanal -> StreamPlayer

  ui.bindAddForm(document.getElementById('add-form'), addInput);
  ui.bindAccountButton(document.getElementById('account'));
  // Chat-/Browser-Button: Fenster ein- und ausblenden; ein offenes Fenster wird hervorgehoben
  const chatBtn = document.getElementById('open-chat');
  const browseBtn = document.getElementById('open-browse');
  chatBtn.onclick = () => window.twitch.toggleWindow('chat');
  browseBtn.onclick = () => window.twitch.toggleWindow('browse');
  document.getElementById('open-settings').onclick = () => window.twitch.openWindow('settings');
  const showWindowState = (st) => {
    chatBtn.classList.toggle('on', st.chat);
    browseBtn.classList.toggle('on', st.browse);
    chatBtn.title = `Chat-Fenster ${st.chat ? 'schließen' : 'öffnen'} (Strg+2)`;
    browseBtn.title = `Browser-Fenster ${st.browse ? 'schließen' : 'öffnen'} (Strg+3)`;
  };
  window.twitch.onWindowState(showWindowState);
  window.twitch.getWindowState().then(showWindowState);

  function createTile(channel) {
    const tile = document.createElement('div');
    tile.className = 'tile';

    const host = document.createElement('div');
    host.className = 'player-host';

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = channel;

    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.title = `${channel} schließen`;
    close.textContent = '✕';
    close.onclick = () => window.twitch.removeChannel(channel);

    tile.append(host, label, close);
    players.set(channel, StreamPlayer.create(channel, host));
    return tile;
  }

  function render(channels) {
    ui.syncList(grid, channels, createTile);
    for (const [channel, player] of players) {
      if (!channels.includes(channel)) {
        player.destroy();
        players.delete(channel);
      }
    }
    grid.className = `grid count-${channels.length}`;
    grid.style.display = channels.length ? '' : 'none';
    empty.style.display = channels.length ? 'none' : '';
    count.textContent = `${channels.length}/${maxStreams}`;
    const full = channels.length >= maxStreams;
    addBtn.disabled = full;
    addInput.disabled = full;
    addInput.placeholder = full ? 'Maximal 4 Streams – schließe einen mit ✕' : 'Kanalname oder Twitch-Link';
  }

  // Links (z. B. aus dem Browser-Fenster oder einem anderen Browser) ins Fenster ziehen
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    const links = text.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).join(' ');
    if (links) ui.add(links);
  });

  // Klicks in einen Player erkennen (Fokus wandert ins iframe). So wird eine
  // absichtlich pausierte Kachel nicht automatisch wieder gestartet.
  window.addEventListener('blur', () => {
    const frame = document.activeElement;
    if (frame?.tagName !== 'IFRAME') return;
    const tile = frame.closest('.tile');
    if (tile) tile._lastClick = Date.now();
    // Fokus zurückholen, damit auch der nächste Klick erkannt wird
    setTimeout(() => { if (document.activeElement === frame) frame.blur(); }, 800);
  });

  // Stündliches (einstellbares) Neuverbinden und Rechtsklick → "neu laden"
  window.twitch.onReconnect(() => {
    StreamPlayer.reconnectAll();
    ui.toast('Streams werden neu verbunden …');
  });
  window.twitch.onTileReload((channel) => players.get(channel)?.rebuild());

  window.twitch.onChannels(render);
  render(await window.twitch.getChannels());
})();
