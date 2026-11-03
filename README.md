# Simon Twitch

Ein Twitch-Client für Windows (Linux-Port vorbereitet), mit dem du **bis zu 4 Streams gleichzeitig** schauen kannst.

Die App besteht aus drei Fenstern:

| Fenster | Inhalt |
|---|---|
| **Streams** | Zeigt bis zu 4 Streams im Raster (1 = Vollbild, 2 = nebeneinander, 3 = einer groß + zwei klein, 4 = 2×2). Jeder Stream hat oben rechts ein **✕** zum Schließen. Schließt du dieses Fenster, wird die App beendet. |
| **Chat** | Zeigt die Chats aller offenen Streams. **Ein Chat**: ein Chat groß, Wechsel über die Tabs. **Splitscreen**: alle Chats gleichzeitig. Je nach Fenstergröße stehen sie nebeneinander, untereinander oder 2×2. Mit ⤢ holst du einen Chat aus dem Splitscreen groß nach vorne. |
| **Browser** | twitch.tv zum Stöbern. Öffne einen Kanal und klicke **„+ … zum Multi-Stream“**, oder rechtsklicke auf einen Kanal-Link. Das Adressfeld sucht auch auf Twitch. |

Chat und Browser lassen sich schließen und über die Buttons im Stream-Fenster oder mit **Strg+2 / Strg+3** wieder öffnen (das Menü erscheint mit **Alt**).
Offene Streams und Fensterpositionen werden gespeichert und beim nächsten Start wiederhergestellt.

### Anmelden

Bist du beim Start nicht angemeldet, fragt dich ein kleines Fenster: **Bei Twitch anmelden** oder **Als Gast fortfahren**. Die Frage lässt sich mit „Beim Start nicht mehr fragen“ abschalten und im Menü *Konto* wieder einschalten.
Die Anmeldung gilt für die ganze App (Streams, Chats, Browser). Über den Button **Anmelden** bzw. **● deinname** im Stream- und Chat-Fenster meldest du dich jederzeit an oder ab.

## Download

Fertige Dateien gibt es unter **[Releases](https://github.com/lordsimon666/Simon-Twitch/releases)**:

| Datei | Für |
|---|---|
| `Simon-Twitch-x.y.z-win-x64.exe` | Windows-Installer |
| `Simon-Twitch-x.y.z-portable.exe` | Windows ohne Installation, einfach starten |
| `Simon-Twitch-x.y.z-linux-x86_64.AppImage` | Linux, alle Distributionen (`chmod +x` und starten) |
| `Simon-Twitch-x.y.z-linux-amd64.deb` | Debian/Ubuntu/Mint (`sudo apt install ./Simon-Twitch-…deb`) |

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
