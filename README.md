# Simon Twitch

Ein Twitch-Client für Windows (Linux-Port vorbereitet), mit dem du **bis zu 4 Streams gleichzeitig** schauen kannst.

Streams fügst du per **Kanalname oder Twitch-Link** hinzu (z. B. `papaplatte`, `twitch.tv/papaplatte` oder `https://www.twitch.tv/papaplatte`). Mehrere Einträge auf einmal trennst du mit Leerzeichen oder Komma. Links kannst du auch einfach ins Stream-Fenster ziehen.

Die App besteht aus drei Fenstern:

| Fenster | Inhalt |
|---|---|
| **Streams** | Zeigt bis zu 4 Streams im Raster (1 = Vollbild, 2 = nebeneinander, 3 = einer groß + zwei klein, 4 = 2×2). Jeder Stream hat oben rechts ein **✕** zum Schließen. Schließt du dieses Fenster, wird die App beendet. |
| **Chat** | Zeigt die Chats aller offenen Streams. **Ein Chat**: ein Chat groß, Wechsel über die Tabs. **Splitscreen**: alle Chats gleichzeitig. Je nach Fenstergröße stehen sie nebeneinander, untereinander oder 2×2. Mit ⤢ holst du einen Chat aus dem Splitscreen groß nach vorne. |
| **Browser** | twitch.tv zum Stöbern. Öffne einen Kanal und klicke **„+ … zum Multi-Stream“**, oder rechtsklicke auf einen Kanal-Link. Das Adressfeld sucht auch auf Twitch. |

Die Buttons **Chat** und **Browser** im Stream-Fenster (oder **Strg+2 / Strg+3**) öffnen und schließen das jeweilige Fenster. Solange ein Fenster offen ist, ist sein Button lila hervorgehoben. Das Menü erscheint mit **Alt**.
Offene Streams und Fensterpositionen werden gespeichert und beim nächsten Start wiederhergestellt.

### Raids

Raidet ein Kanal, den du gerade schaust, wechselt seine Kachel samt Chat an derselben Stelle automatisch zum Ziel-Kanal. Kurz vorher erscheint ein Hinweis.
Abschalten kannst du das im Menü *Streams → Raids automatisch folgen* (Menü mit **Alt** einblenden).

### Rechtsklick-Menü

- **Auf einem Stream oder Chat:** neu laden, auf twitch.tv öffnen, schließen
- **Im Chat-Eingabefeld:** Ausschneiden, Kopieren, Einfügen, Rechtschreibvorschläge
- **Auf einem Kanal-Link (z. B. im Chat):** zum Multi-Stream hinzufügen, den aktuellen Kanal damit ersetzen, im Browser-Fenster öffnen, Link kopieren
- **Im Browser-Fenster:** Kanal hinzufügen, Zurück/Vor/Neu laden

### Anmelden

Bist du beim Start nicht angemeldet, fragt dich ein kleines Fenster: **Bei Twitch anmelden** oder **Als Gast fortfahren**. Die Frage lässt sich mit „Beim Start nicht mehr fragen“ abschalten und im Menü *Konto* wieder einschalten.
Die Anmeldung gilt für die ganze App (Streams, Chats, Browser). Über den Button **Anmelden** bzw. **● deinname** im Stream- und Chat-Fenster meldest du dich jederzeit an oder ab.

## Download

Fertige Dateien gibt es unter **[Releases](https://github.com/lordsimon666/Simon-Twitch/releases/latest)**. Die Dateinamen enthalten keine Versionsnummer, deshalb zeigen diese Links immer auf die neueste Version:

| System | Datei | Installation |
|---|---|---|
| Windows | [Simon-Twitch-Setup.exe](https://github.com/lordsimon666/Simon-Twitch/releases/latest/download/Simon-Twitch-Setup.exe) | Installer starten |
| Windows | [Simon-Twitch-Portable.exe](https://github.com/lordsimon666/Simon-Twitch/releases/latest/download/Simon-Twitch-Portable.exe) | Ohne Installation, einfach starten |
| **Bazzite** / SteamOS / jede Distribution | [Simon-Twitch.flatpak](https://github.com/lordsimon666/Simon-Twitch/releases/latest/download/Simon-Twitch.flatpak) | Doppelklick (öffnet Bazaar/Discover) oder `flatpak install --user Simon-Twitch.flatpak` |
| Bazzite / Fedora (Alternative) | [Simon-Twitch.rpm](https://github.com/lordsimon666/Simon-Twitch/releases/latest/download/Simon-Twitch.rpm) | Fedora: `sudo dnf install ./Simon-Twitch.rpm` – Bazzite: `rpm-ostree install ./Simon-Twitch.rpm`, danach neu starten |
| Linux allgemein | [Simon-Twitch.AppImage](https://github.com/lordsimon666/Simon-Twitch/releases/latest/download/Simon-Twitch.AppImage) | `chmod +x Simon-Twitch.AppImage` und starten (auf Bazzite z. B. mit Gear Lever) |
| Debian / Ubuntu / Mint | [Simon-Twitch.deb](https://github.com/lordsimon666/Simon-Twitch/releases/latest/download/Simon-Twitch.deb) | `sudo apt install ./Simon-Twitch.deb` |

**Bazzite:** Nimm am besten die **.flatpak**-Datei. Bazzite ist ein „atomares“ System, Flatpak ist dort der vorgesehene Weg und braucht keinen Neustart.
Falls Flatpak das Freedesktop-/Electron-Laufzeitpaket noch nicht hat, lädt es dieses beim Installieren automatisch von Flathub (ist auf Bazzite schon eingerichtet).
Danach startest du die App aus dem Menü oder mit `flatpak run de.simon.twitch`.

Die Dateien sind nicht signiert. Windows zeigt beim ersten Start deshalb eventuell „Der Computer wurde durch Windows geschützt“. Klicke dann auf *Weitere Informationen → Trotzdem ausführen*.

### Automatische Builds (GitHub Actions)

`.github/workflows/build.yml` baut bei jedem Push die Windows- und Linux-Dateien. Du findest sie unter *Actions → Build → Artifacts*.
Für ein neues Release erhöhst du die Version in `package.json` und startest dann *Actions → Build → Run workflow* (Häkchen „release“ gesetzt lassen). Alternativ pushst du einen Tag:

```bash
git tag v0.2.0
git push origin v0.2.0
```

## Starten (Entwicklung)

Du brauchst [Node.js](https://nodejs.org) 18 oder neuer.

```bash
npm install
npm start
```

## Windows-App bauen

```bash
npm run dist:win
```

Erzeugt in `dist/` einen Installer (`Simon Twitch Setup x.y.z.exe`) und eine portable `.exe`.

## Linux-Port

Der Code ist plattformneutral (Electron). Unter Linux:

```bash
npm run dist:linux
```

Erzeugt ein `AppImage` und ein `.deb`-Paket in `dist/`.

## Technik

- **Electron**: `src/main.js` ist der Hauptprozess (Fenster, Kanalliste, Speichern), `src/preload.js` die abgesicherte Brücke, `src/renderer/` die Oberflächen der drei Fenster.
- Twitch-Player und -Chat sind offizielle Twitch-Embeds (`player.twitch.tv` bzw. `twitch.tv/embed/<kanal>/chat`). Diese Embeds verlangen einen `parent`-Hostnamen. Deshalb liefert die App ihre Oberfläche über einen lokalen Server aus, der nur unter `127.0.0.1` erreichbar ist (`http://localhost:<zufälliger Port>`).
- Es werden kein Twitch-API-Key und kein Konto benötigt.
