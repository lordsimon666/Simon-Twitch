'use strict';

(async () => {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');
  const addBtn = document.getElementById('add-btn');
  const addInput = document.getElementById('add-input');
  const { maxStreams, parent } = await window.twitch.getConfig();

  ui.bindAddForm(document.getElementById('add-form'), addInput);
  document.getElementById('open-chat').onclick = () => window.twitch.openWindow('chat');
  document.getElementById('open-browse').onclick = () => window.twitch.openWindow('browse');

  function createTile(channel) {
    const tile = document.createElement('div');
    tile.className = 'tile';

    const frame = document.createElement('iframe');
    frame.src = `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${parent}&autoplay=true&muted=false`;
    frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
    frame.allowFullscreen = true;

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = channel;

    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.title = `${channel} schließen`;
    close.textContent = '✕';
    close.onclick = () => window.twitch.removeChannel(channel);

    tile.append(frame, label, close);
    return tile;
  }

  function render(channels) {
    ui.syncList(grid, channels, createTile);
    grid.className = `grid count-${channels.length}`;
    grid.style.display = channels.length ? '' : 'none';
    empty.style.display = channels.length ? 'none' : '';
    count.textContent = `${channels.length}/${maxStreams}`;
    const full = channels.length >= maxStreams;
    addBtn.disabled = full;
    addInput.disabled = full;
    addInput.placeholder = full ? 'Maximal 4 Streams – schließe einen mit ✕' : 'Kanalname, z. B. papaplatte';
  }

  window.twitch.onChannels(render);
  render(await window.twitch.getChannels());
})();
