'use strict';

// Chat-Fenster mit zwei Ansichten:
//  - "Ein Chat":    ein Chat füllt das ganze Fenster, Wechsel über die Tabs
//  - "Splitscreen": alle Chats gleichzeitig; die Aufteilung (nebeneinander,
//                   untereinander oder 2×2) richtet sich nach der Fenstergröße
(async () => {
  const tabs = document.getElementById('tabs');
  const chats = document.getElementById('chats');
  const empty = document.getElementById('empty');
  const singleBtn = document.getElementById('mode-single');
  const splitBtn = document.getElementById('mode-split');
  const { parent } = await window.twitch.getConfig();

  const MIN_CHAT_WIDTH = 300;
  const MIN_CHAT_HEIGHT = 220;

  let active = null;
  let mode = 'single';
  try { mode = localStorage.getItem('chat.mode') === 'split' ? 'split' : 'single'; } catch { /* egal */ }

  function setMode(next, channel) {
    mode = next;
    if (channel) active = channel;
    try { localStorage.setItem('chat.mode', mode); } catch { /* egal */ }
    update();
  }

  function createChat(channel) {
    const wrap = document.createElement('div');
    wrap.className = 'chat';

    const title = document.createElement('div');
    title.className = 'chat-title';
    const name = document.createElement('span');
    name.textContent = channel;
    const big = document.createElement('button');
    big.type = 'button';
    big.textContent = '⤢';
    big.title = 'Diesen Chat groß anzeigen';
    big.onclick = () => setMode('single', channel);
    title.append(name, big);

    const frame = document.createElement('iframe');
    frame.src = `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?parent=${parent}&darkpopout`;
    wrap.append(title, frame);
    return wrap;
  }

  function createTab(channel) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    tab.textContent = channel;
    tab.onclick = () => setMode('single', channel);
    return tab;
  }

  // Spalten/Zeilen für den Splitscreen passend zur Fenstergröße wählen
  function layoutSplit() {
    const n = chats.children.length;
    if (mode !== 'split' || n === 0) {
      chats.style.gridTemplateColumns = '';
      chats.style.gridTemplateRows = '';
      return;
    }
    const { width, height } = chats.getBoundingClientRect();
    let cols = Math.max(1, Math.min(n, Math.floor(width / MIN_CHAT_WIDTH)));
    if (n === 4 && cols === 3) cols = 2;                       // lieber 2×2 als 3+1
    if (n === 4 && cols === 1 && height < 4 * MIN_CHAT_HEIGHT) cols = 2;
    if (n === 3 && cols === 2) cols = height >= 3 * MIN_CHAT_HEIGHT ? 1 : 3;
    const rows = Math.ceil(n / cols);
    chats.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    chats.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  }

  function update() {
    const split = mode === 'split' && chats.children.length > 1;
    chats.classList.toggle('split', split);
    singleBtn.classList.toggle('active', !split);
    splitBtn.classList.toggle('active', split);
    for (const el of chats.children) el.classList.toggle('active', el.dataset.channel === active);
    for (const el of tabs.children) el.classList.toggle('active', !split && el.dataset.channel === active);
    layoutSplit();
  }

  function render(channels) {
    ui.syncList(chats, channels, createChat);
    ui.syncList(tabs, channels, createTab);
    if (!channels.includes(active)) active = channels[channels.length - 1] || null;
    chats.style.display = channels.length ? '' : 'none';
    empty.style.display = channels.length ? 'none' : '';
    splitBtn.disabled = channels.length < 2;
    update();
  }

  ui.bindAccountButton(document.getElementById('account'));

  // Regelmäßiges Neuverbinden: Chats nacheinander neu laden
  window.twitch.onReconnect(() => {
    [...chats.querySelectorAll('iframe')].forEach((frame, i) => {
      setTimeout(() => { frame.src = frame.src; }, i * 5000);
    });
  });
  singleBtn.onclick = () => setMode('single');
  splitBtn.onclick = () => setMode('split');
  new ResizeObserver(layoutSplit).observe(chats);

  // Neu hinzugefügte Kanäle automatisch in den Vordergrund holen
  let known = await window.twitch.getChannels();
  window.twitch.onChannels((channels) => {
    const added = channels.find((c) => !known.includes(c));
    if (added) active = added;
    known = channels;
    render(channels);
  });

  render(known);
})();
