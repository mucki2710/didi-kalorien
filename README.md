# Didi – persönliche iPad-Web-App

Didi läuft jetzt als statische, installierbare Web-App ohne Node-Backend.
Kalender und Mahlzeiten liegen lokal in IndexedDB auf dem jeweiligen Gerät.
Die Fotoanalyse sendet das Foto direkt vom Browser an die OpenAI Responses API.
Nur dafür sind Internet und ein eigener API-Schlüssel nötig.

## Auf dem iPad einrichten

1. Den Inhalt von `public/` auf einer **HTTPS-Adresse** bereitstellen, etwa mit
   GitHub Pages (siehe unten). Der Computer muss danach nicht eingeschaltet bleiben.
2. Die Adresse auf dem iPad in Safari öffnen, dann **Teilen → Zum Home-Bildschirm**.
   Falls angeboten, **Als Web-App öffnen** aktivieren.
3. **Didi vom Home-Bildschirm starten.** Erst dort Daten importieren und den
   API-Schlüssel unter „Einstellungen & Installation“ eingeben. Safari und die
   installierte Web-App können getrennte Gerätespeicher verwenden.
4. Modell `gpt-6-luna` ist voreingestellt, weil es mit dem bisherigen Schlüssel
   funktioniert hat. Bei einem anderen API-Konto ein freigegebenes Modell mit
   Bildeingabe und Structured Outputs eintragen.
5. „Einstellungen übernehmen“ wählen. Standardmäßig bleibt der Schlüssel nur bis
   zum Neuladen/Schließen im Arbeitsspeicher. „Schlüssel auf diesem Gerät merken“
   speichert ihn bewusst unverschlüsselt im lokalen Website-Speicher.
6. Warten, bis „Offline-Start vorbereitet“ erscheint. Kalender und gespeicherte
   Mahlzeiten lassen sich dann auch ohne Internet öffnen.

Die App darf nicht als lokale HTML-Datei aus der Dateien-App geöffnet werden.
Eine unverschlüsselte LAN-Adresse (http://192.168.…, http://10.… usw.) reicht für
Service Worker/Offline-Installation nicht aus. `http://localhost` ist nur zum
Testen am jeweiligen Rechner geeignet.

## GitHub Pages

Ein manueller Workflow liegt unter `.github/workflows/pages.yml` bereit.
Es wurde noch nichts auf GitHub veröffentlicht.

1. Projekt in ein GitHub-Repository übertragen. `.env`, `data/`, `.runtime/` und
   `node_modules/` dürfen nicht hochgeladen werden; `.gitignore` schließt sie aus.
2. Im Repository **Settings → Pages → Source: GitHub Actions** wählen.
3. Unter **Actions → Didi auf GitHub Pages → Run workflow** die Veröffentlichung starten.
4. Die anschließend angezeigte HTTPS-Adresse auf dem iPad öffnen.

Der Workflow veröffentlicht ausschließlich `public/`, niemals `.env` oder CSV-Daten.
Relative Dateipfade unterstützen auch URLs wie `https://name.github.io/didi-kalorien/`.
Für Updates den Workflow erneut starten. Bei Änderungen an App-Dateien außerdem die
Cache-Version in `public/sw.js` erhöhen. Nach der Online-Aktualisierung alle Didi-Fenster
schließen und erneut öffnen, damit ein wartender Service Worker aktiv werden kann.

Für andere statische HTTPS-Hoster kann ein ZIP erstellt werden:

```bash
python3 scripts/package-static.py
```

`dist/didi-ipad.zip` enthält nur die App-Dateien. Den entpackten Inhalt als Website
bereitstellen; das ZIP allein ist kein iPad-Installationspaket.

## Mahlzeiten und CSV-Sicherungen

- Im Kalender den gewünschten Tag wählen. Neue Mahlzeiten werden diesem Tag zugeordnet.
- „Tag als CSV“ exportiert den angezeigten Tag.
- „Alle Tage als CSV sichern“ exportiert alle lokalen Mahlzeiten, ohne API-Schlüssel.
- Auf dem iPad den Download in der Dateien-App sichern, z. B. in iCloud Drive.
- „CSV importieren“ liest Didi-CSV-Dateien, auch die bisherige `data/meals.csv`.
  Vorhandene IDs werden übersprungen. Ungültige Dateien werden nicht teilweise importiert.
- CSV ist die Sicherung bzw. das Austauschformat. Die App kann keine Datei in der
  Dateien-App ohne erneute Dateiauswahl dauerhaft im Hintergrund überschreiben.
- Es gibt keine automatische Synchronisation zwischen Geräten oder Browsern.
- Website-Daten können gelöscht werden, etwa durch Zurücksetzen von Safari oder
  Speicherdruck. Daher regelmäßig CSV sichern. „Gerätespeicher anfragen“ versucht,
  dauerhafte Speicherung anzufragen; eine Zusage ist browserabhängig.

## Vorhandene Daten übernehmen

Die bisherige Datei `data/meals.csv` bleibt auf dem Rechner unverändert erhalten.
Diese Datei per Dateien/iCloud/AirDrop auf das iPad übertragen und **in der vom
Home-Bildschirm gestarteten App** über „CSV importieren“ einlesen.

Noch vorhandene alte LocalStorage-Daten unter `didi-meals` werden beim Start
unter derselben Webadresse automatisch nach IndexedDB übernommen. Nach erfolgreicher
Übernahme bleibt eine Kopie unter `didi-meals-backup`. Browserdaten einer anderen
Adresse können nur per CSV übertragen werden.

## Schlüssel und Fotos

Der vorhandene Schlüssel aus `.env` wird **nicht** in die Web-App kopiert oder
veröffentlicht. Er muss auf dem iPad persönlich eingetragen werden. Ein gespeicherter
Schlüssel ist kein geschützter iPad-Schlüsselbund-Eintrag. Diese Variante ist für den
persönlichen Gebrauch auf einem vertrauenswürdigen Gerät und einer vertrauenswürdigen
Website gedacht. „Schlüssel entfernen“ löscht ihn aus der App und ihrem lokalen Speicher.

Die App lädt keine externen Skripte. Der Service Worker speichert nur die öffentlichen
App-Dateien, keine API-Anfragen oder Fotos. Fotos werden nicht in der Mahlzeiten-Datenbank
abgelegt. OpenAI-Anfragen verwenden `store: false`; die API-Nutzung wird über das eigene
Konto abgerechnet. Nährwerte sind Schätzungen und sollten geprüft werden.

## Lokale Vorschau und Tests

Node.js 22 oder neuer. Falls die lokale Laufzeit vorhanden ist:

```bash
export PATH="$PWD/.runtime/node/bin:$PATH"
npm install
npm start
```

`http://localhost:3000` zeigt ausschließlich statische Dateien; für die Web-App werden
keine `/api`-Routen benötigt. `npm run dev` startet die Vorschau mit automatischem Neustart.
Die alte API-Implementierung bleibt für bestehende Tests und Dateizugriff erhalten und
kann bei Bedarf mit `npm run start:legacy` statt der Vorschau gestartet werden.
Die neue Oberfläche verwendet auch dann ausschließlich lokalen Gerätespeicher.

```bash
npm test
npx playwright install chromium webkit
npm run test:browser
BROWSER=webkit npm run test:browser
```

Alternativ vorhandenen Chrome verwenden:

```bash
CHROME_PATH=/opt/google/chrome/chrome npm run test:browser
```

Der Browser-Test verwendet ausschließlich einen statischen Host unter einem Unterpfad
und simuliert OpenAI. Er prüft Speicherung, Kalender, CSV, Schlüssel-Einstellungen und
Offline-Neuladen **nach Abschalten des Hosts**. Beim WebKit-Test wird der Host real abgeschaltet; dessen Protokoll-Offlinesimulation
stört Navigation und Blob-Dateizugriff, deshalb wird dort nur die Offline-Anzeige
zusätzlich simuliert. Chrome wird mit abgeschaltetem Netzwerk getestet.
WebKit-Tests ersetzen nicht die abschließende Installation auf einem echten iPad.

Referenzen: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[WebKit-Gerätespeicher](https://webkit.org/blog/14403/updates-to-storage-policy/),
[GitHub Pages Workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
