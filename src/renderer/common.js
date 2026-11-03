'use strict';

// Gemeinsame Hilfsfunktionen für alle Fenster
window.ui = {
  toast(message) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 2800);
  },

  // Fügt einen Kanal hinzu und zeigt Fehler als Hinweis an
  async add(channel) {
    const res = await window.twitch.addChannel(channel);
    if (!res.ok) this.toast(res.error);
    return res.ok;
  },

  // Verbindet ein Eingabefeld + Button mit "Kanal hinzufügen"
  bindAddForm(form, input) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      if (await this.add(value)) input.value = '';
    });
  },

  // Synchronisiert eine Liste von DOM-Elementen mit den Kanälen, ohne bestehende
  // Elemente neu zu laden (iframes würden sonst neu starten).
  syncList(container, channels, create) {
    const existing = new Map([...container.children].map((el) => [el.dataset.channel, el]));
    for (const [channel, el] of existing) {
      if (!channels.includes(channel)) el.remove();
    }
    for (const channel of channels) {
      if (!existing.has(channel)) {
        const el = create(channel);
        el.dataset.channel = channel;
        container.appendChild(el);
      }
    }
  },
};
