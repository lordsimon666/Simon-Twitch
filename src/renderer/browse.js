'use strict';

(() => {
  const view = document.getElementById('view');
  const url = document.getElementById('url');
  const addBtn = document.getElementById('add');
  const back = document.getElementById('back');
  const forward = document.getElementById('forward');
  let current = null;

  async function onNavigate() {
    url.value = view.getURL();
    back.disabled = !view.canGoBack();
    forward.disabled = !view.canGoForward();
    current = await window.twitch.channelFromUrl(view.getURL());
    addBtn.disabled = !current;
    addBtn.textContent = current ? `+ ${current} zum Multi-Stream` : '+ Zum Multi-Stream';
  }

  view.addEventListener('did-navigate', onNavigate);
  view.addEventListener('did-navigate-in-page', onNavigate); // Twitch ist eine Single-Page-App

  // Kanalseiten spielen den Stream sonst doppelt ab – im Browser stummschalten
  view.addEventListener('dom-ready', () => view.setAudioMuted(true), { once: true });

  back.onclick = () => view.canGoBack() && view.goBack();
  forward.onclick = () => view.canGoForward() && view.goForward();
  document.getElementById('reload').onclick = () => view.reload();
  document.getElementById('home').onclick = () => view.loadURL('https://www.twitch.tv/directory');

  addBtn.onclick = async () => {
    if (current && await ui.add(current)) ui.toast(`${current} wurde hinzugefügt.`);
  };

  document.getElementById('nav-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = url.value.trim();
    if (!value) return;
    if (/^https?:\/\/([a-z0-9-]+\.)*twitch\.tv(\/|$)/i.test(value)) {
      view.loadURL(value);
    } else if (/^(www\.)?twitch\.tv(\/|$)/i.test(value)) {
      view.loadURL(`https://${value}`);
    } else {
      view.loadURL(`https://www.twitch.tv/search?term=${encodeURIComponent(value)}`);
    }
  });

  window.twitch.onViewLoad((u) => view.loadURL(u));
  window.twitch.onViewReload(() => view.reload()); // nach An-/Abmelden
})();
