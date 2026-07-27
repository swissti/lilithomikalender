# Lili & Thomi Kalender

PWA zur Koordination von Kinderbetreuung (Hüten), gehostet über Netlify.
Backend: Google Apps Script + Google Sheets.

## Dateien

- `index.html` – Haupt-App (Single-File PWA, alle Icons/Logo als Base64 eingebettet)
- `manifest.json` – PWA-Manifest (`start_url` und `scope` sind `/`, passend zum Netlify-Root-Deployment)
- `sw.js` – Service Worker (nötig, damit die App als "echte" PWA installierbar ist, ohne Browser-Badge)
- `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` – Icon-Set
- `AppsScript-Code.gs` – Backend-Code, gehört **nicht** ins Netlify-Deployment, sondern in den Google Apps Script Editor (verknüpft mit dem Sheet "Kinder hüten App")

## API-Endpunkt (Google Apps Script)

```
https://script.google.com/macros/s/AKfycbyIW17HY09K9HWGU8HbM9b_PCgwxYlI714a4b5rcRDOEWvaRsl2mYHaIUeT2V2cfxo/exec
```

## Deployment (Netlify)

Alle Dateien außer `AppsScript-Code.gs` müssen im selben Root-Verzeichnis liegen, das Netlify deployed.
Nach jeder Änderung: neu deployen, dann auf dem Handy alte Homescreen-Verknüpfung löschen und neu hinzufügen
(iOS/Chrome cachen Icon & Manifest teils hartnäckig).

## Offene Punkte (Stand letzte Sitzung)

- `cleanupDuplicates()` im Apps-Script-Editor einmalig ausführen (Sheet hatte Duplikate durch Race Condition,
  mittlerweile per `LockService` behoben)
- Sportferien / Gemeinde-Schulferien sind noch nicht eingetragen
- Einstellungen werden aktuell nur lokal (`localStorage`) gespeichert, kein Sync über mehrere Geräte
