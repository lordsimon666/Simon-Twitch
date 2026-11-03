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
    if (res.error) this.toast(res.error);
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

  // Konto-Button: "Anmelden" bzw. "<name> · Abmelden"
  async bindAccountButton(button) {
    const render = (auth) => {
      button.dataset.loggedIn = auth.loggedIn ? '1' : '';
      button.classList.toggle('primary', !auth.loggedIn);
      button.textContent = auth.loggedIn ? `● ${auth.user || 'Angemeldet'}` : 'Anmelden';
      button.title = auth.loggedIn ? 'Klicken zum Abmelden' : 'Bei Twitch anmelden (gilt für die ganze App)';
    };
    button.addEventListener('click', () => {
      if (!button.dataset.loggedIn) window.twitch.login();
      else if (confirm('Von Twitch abmelden?')) window.twitch.logout();
    });
    window.twitch.onAuth(render);
    render(await window.twitch.getAuth());
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
