/**
 * Backend für "Lili & Thomi Kalender"
 * ---------------------------------
 * Einrichtung:
 * 1. Neues Google Sheet erstellen (z.B. "Huetekalender-Daten")
 * 2. Erweiterungen > Apps Script öffnen
 * 3. Diesen Code einfügen (alten Inhalt ersetzen)
 * 4. Bereitstellen > Neue Bereitstellung > Web-App
 *    - Ausführen als: Ich
 *    - Zugriff: Jeder
 * 5. Die angezeigte Web-App-URL in index.html bei API_URL eintragen
 *
 * Tabellenblatt "Daten" wird automatisch angelegt mit Spalten:
 * Datum | PersonA | PersonB | HuetenNichtMoeglich | Ferien | Extra
 *
 * WICHTIG: Diese Version verhindert doppelte Zeilen durch eine Sperre
 * (LockService), die gleichzeitige Schreibvorgänge nacheinander abarbeitet.
 */

const SHEET_NAME = "Daten";

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["Datum", "PersonA", "PersonB", "HuetenNichtMoeglich", "Ferien", "Extra"]);
  }
  // Datum-Spalte als Text formatieren, damit Google Sheets sie nicht
  // automatisch in ein Datumsformat umwandelt (verhindert Zeitzonen-Verschiebung)
  sheet.getRange("A2:A").setNumberFormat("@");
  return sheet;
}

function doGet(e) {
  const action = e.parameter.action;
  if (action === "list") {
    return jsonResponse({ entries: readAllEntries() });
  }
  return jsonResponse({ error: "Unbekannte Aktion" });
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.action === "set") {
    setEntry(body.date, body.value);
    return jsonResponse({ ok: true });
  }
  return jsonResponse({ error: "Unbekannte Aktion" });
}

function readAllEntries() {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  const entries = {};
  // Bei doppelten Zeilen gewinnt die zuletzt geschriebene (unterste) Zeile,
  // da die Schleife von oben nach unten läuft und spätere Treffer überschreiben.
  for (let i = 1; i < values.length; i++) {
    const [dateVal, a, b, unavailable, vacation, extra] = values[i];
    if (!dateVal) continue;
    const key = formatDateKey(dateVal);
    entries[key] = { a: !!a, b: !!b, unavailable: !!unavailable, vacation: !!vacation, extra: !!extra };
  }
  return entries;
}

function setEntry(dateKey, value) {
  // Sperre holen, damit nicht zwei gleichzeitige Anfragen je eine neue
  // Zeile für denselben Tag anlegen (Ursache der Duplikate).
  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // bis zu 10 Sekunden auf die Sperre warten
  try {
    const sheet = getSheet();
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      const key = formatDateKey(values[i][0]);
      if (key === dateKey) {
        sheet.getRange(i + 1, 2, 1, 5).setValues([[!!value.a, !!value.b, !!value.unavailable, !!value.vacation, !!value.extra]]);
        return;
      }
    }
    // Neue Zeile, falls Datum noch nicht existiert. Datum als Text
    // schreiben (mit vorangestelltem Apostroph), damit es nicht als
    // echtes Datum interpretiert wird.
    sheet.appendRow([dateKey, !!value.a, !!value.b, !!value.unavailable, !!value.vacation, !!value.extra]);
    sheet.getRange(sheet.getLastRow(), 1).setNumberFormat("@").setValue(dateKey);
  } finally {
    lock.releaseLock();
  }
}

function formatDateKey(dateVal) {
  if (dateVal instanceof Date) {
    const y = dateVal.getFullYear();
    const m = String(dateVal.getMonth() + 1).padStart(2, "0");
    const d = String(dateVal.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(dateVal);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * EINMALIG AUSFÜHREN, um bestehende Duplikate im Sheet zu bereinigen.
 * Im Apps-Script-Editor oben in der Funktionsliste "cleanupDuplicates"
 * auswählen und auf "Ausführen" klicken.
 */
function cleanupDuplicates() {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  const latestRowForDate = {}; // dateKey -> row index (0-based in values array)

  for (let i = 1; i < values.length; i++) {
    const dateVal = values[i][0];
    if (!dateVal) continue;
    const key = formatDateKey(dateVal);
    latestRowForDate[key] = i; // spätere Zeile überschreibt frühere -> letzte gewinnt
  }

  const keepRows = new Set(Object.values(latestRowForDate));
  // Von unten nach oben löschen, damit sich Zeilennummern beim Löschen nicht verschieben
  for (let i = values.length - 1; i >= 1; i--) {
    if (!keepRows.has(i)) {
      sheet.deleteRow(i + 1);
    }
  }
  Logger.log("Bereinigung fertig. Verbleibende Zeilen: " + keepRows.size);
}
