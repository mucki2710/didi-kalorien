# Didi Kalorien

Persönliche, installierbare Web-App zur Erfassung von Mahlzeiten.

Die App läuft vollständig im Browser:

- Mahlzeiten und Kalender werden lokal auf dem Gerät gespeichert.
- Ein frei wählbarer Zeitraum zeigt die Summe aller Kalorien an.
- Das ärztlich vereinbarte Tagesziel lässt sich auf dem Gerät einstellen.
- CSV-Dateien dienen zum Sichern, Übertragen und Wiederherstellen der Daten.
- Neue CSV-Einträge enthalten Erfassungsdatum und Uhrzeit; der Dateiname enthält
  ebenfalls Datum und Uhrzeit der Sicherung.
- Die Fotoanalyse sendet das ausgewählte Foto direkt an die OpenAI Responses API.
- Bei einer falschen Erkennung kann die Mahlzeit beschrieben und dasselbe Foto erneut analysiert werden.
- Der eigene OpenAI-API-Schlüssel wird nur auf Wunsch im lokalen Website-Speicher abgelegt.
- Ein Service Worker ermöglicht den Offline-Start nach dem ersten vollständigen Laden.

## Auf dem iPad installieren

1. <https://mucki2710.github.io/didi-kalorien/> in Safari öffnen.
2. Warten, bis „Offline-Start vorbereitet“ angezeigt wird.
3. **Teilen → Zum Home-Bildschirm** wählen.
4. Didi vom Home-Bildschirm starten.
5. Unter „Einstellungen & Installation“ den eigenen API-Schlüssel eintragen.
6. Eine vorhandene Didi-CSV über „CSV importieren“ übernehmen.

Kalender und gespeicherte Mahlzeiten funktionieren offline. Die Fotoanalyse benötigt
eine Internetverbindung. Regelmäßig „Alle Tage als CSV sichern“ verwenden, da lokale
Website-Daten beim Zurücksetzen von Safari verloren gehen können.

Kalorien, Portionsgrößen und Nährwerte aus der Fotoanalyse sind Schätzungen.
