'use strict';

(async () => {
  const tabs = document.getElementById('tabs');
  const chats = document.getElementById('chats');
  const empty = document.getElementById('empty');
  const splitBtn = document.getElementById('split');
  const { parent } = await window.twitch.getConfig();

  let active = null;
  let split = localStorage.getItem('chat.split') === '1';

  function createChat(channel) {
    const wrap = document.createElement('div');
    wrap.className = 'chat';
    const title = document.createElement('div');
    title.className = 'chat-title';
    title.textContent = channel;
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
    tab.onclick = () => { active = channel; split = false; update(); };
    return tab;
  }

  function update() {
    localStorage.setItem('chat.split', split ? '1' : '0');
    chats.classList.toggle('split', split);
    splitBtn.classList.toggle('primary', split);
    for (const el of chats.children) el.classList.toggle('active', el.dataset.channel === active);
    for (const el of tabs.children) el.classList.toggle('active', !split && el.dataset.channel === active);
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

  // Neu hinzugefügte Kanäle automatisch in den Vordergrund holen
  let known = [];
  window.twitch.onChannels((channels) => {
    const added = channels.find((c) => !known.includes(c));
    if (added) active = added;
    known = channels;
    render(channels);
  });

  splitBtn.onclick = () => { split = !split; update(); };

  known = await window.twitch.getChannels();
  render(known);
})();
