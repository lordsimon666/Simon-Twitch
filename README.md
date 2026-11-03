# Simon Twitch

Ein Twitch-Client für Windows (Linux-Port vorbereitet), mit dem du **bis zu 4 Streams gleichzeitig** schauen kannst.

Die App besteht aus drei Fenstern:

| Fenster | Inhalt |
|---|---|
| **Streams** | Zeigt bis zu 4 Streams im Raster (1 = Vollbild, 2 = nebeneinander, 3 = einer groß + zwei klein, 4 = 2×2). Jeder Stream hat oben rechts ein **✕** zum Schließen. Schließt du dieses Fenster, wird die App beendet. |
| **Chat** | Zeigt die Chats aller offenen Streams, als Tabs oder mit ▥ alle nebeneinander. Neue Streams bekommen automatisch einen Chat. |
| **Browser** | twitch.tv zum Stöbern. Öffne einen Kanal und klicke **„+ … zum Multi-Stream“**, oder rechtsklicke auf einen Kanal-Link. Das Adressfeld sucht auch auf Twitch. |

Chat und Browser lassen sich schließen und über die Buttons im Stream-Fenster oder mit **Strg+2 / Strg+3** wieder öffnen (das Menü erscheint mit **Alt**).
Offene Streams und Fensterpositionen werden gespeichert und beim nächsten Start wiederhergestellt.

Wenn du dich im Browser-Fenster oder im Chat bei Twitch anmeldest, gilt die Anmeldung für alle Fenster. Danach kannst du direkt mitschreiben.

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
