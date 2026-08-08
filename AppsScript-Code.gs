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
 *
 * PUSH-BENACHRICHTIGUNGEN (optional):
 * Damit die App das jeweils andere Handy benachrichtigen kann, wenn sich
 * ein Eintrag ändert, braucht es zwei Script-Properties (Zahnrad-Icon links
 * im Apps-Script-Editor > "Projekteinstellungen" > "Script-Properties"):
 *   PUSH_RELAY_URL     = die URL deiner Netlify-Function, z.B.
 *                        https://lilithomikalender.netlify.app/.netlify/functions/send-push
 *   PUSH_RELAY_SECRET  = dasselbe Geheimnis, das auch als Umgebungsvariable
 *                        PUSH_RELAY_SECRET in den Netlify-Site-Einstellungen steht
 * Ohne diese beiden Properties funktioniert der Kalender weiterhin normal,
 * es werden einfach keine Push-Benachrichtigungen verschickt.
 */

const SHEET_NAME = "Daten";
const SUBSCRIPTIONS_SHEET_NAME = "PushSubscriptions";

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
    // Push-Benachrichtigung ans jeweils andere Handy (best effort - ein
    // Fehler hier darf das Speichern selbst nicht verhindern).
    try {
      notifyOthers(body.actor, body.date);
    } catch (err) {
      Logger.log("Push-Benachrichtigung fehlgeschlagen: " + err);
    }
    return jsonResponse({ ok: true });
  }
  if (body.action === "subscribe") {
    const saved = saveSubscription(body.person, body.subscription);
    if (!saved) return jsonResponse({ ok: false, error: "Ungueltige Subscription-Daten" });
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
    // Von unten nach oben suchen, damit bei (bereinigten) Duplikaten dieselbe
    // Zeile aktualisiert wird, die readAllEntries() als massgeblich ansieht.
    for (let i = values.length - 1; i >= 1; i--) {
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

/* ============ Push-Benachrichtigungen ============ */

function getSubscriptionsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SUBSCRIPTIONS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SUBSCRIPTIONS_SHEET_NAME);
    sheet.appendRow(["Person", "Endpoint", "P256dh", "Auth", "AktualisiertAm"]);
  }
  return sheet;
}

// Speichert/aktualisiert eine Push-Subscription. Ein Endpoint (=eindeutig
// pro Geraet+Browser) wird nur einmal gefuehrt; taucht er erneut auf (z.B.
// weil sich jemand erneut angemeldet hat), wird die bestehende Zeile
// aktualisiert statt eine neue anzulegen.
function saveSubscription(person, subscription) {
  if (!person || !subscription || !subscription.endpoint) {
    Logger.log("saveSubscription: ungueltige Daten - person=" + person + " subscription=" + JSON.stringify(subscription));
    return false;
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSubscriptionsSheet();
    const values = sheet.getDataRange().getValues();
    const keys = subscription.keys || {};
    const row = [person, subscription.endpoint, keys.p256dh || "", keys.auth || "", new Date()];
    for (let i = 1; i < values.length; i++) {
      if (values[i][1] === subscription.endpoint) {
        sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
        Logger.log("saveSubscription: bestehende Subscription fuer '" + person + "' aktualisiert (Zeile " + (i + 1) + ")");
        return true;
      }
    }
    sheet.appendRow(row);
    Logger.log("saveSubscription: neue Subscription fuer '" + person + "' gespeichert");
    return true;
  } finally {
    lock.releaseLock();
  }
}

// Alle Subscriptions ausser die der Person, die selbst die Aenderung
// gemacht hat (die braucht keine Benachrichtigung ueber ihre eigene Aktion).
function getSubscriptionsExcept(actor) {
  const sheet = getSubscriptionsSheet();
  const values = sheet.getDataRange().getValues();
  const subs = [];
  for (let i = 1; i < values.length; i++) {
    const [rowPerson, endpoint, p256dh, auth] = values[i];
    if (rowPerson && rowPerson !== actor && endpoint) {
      subs.push({ endpoint: endpoint, keys: { p256dh: p256dh, auth: auth } });
    }
  }
  return subs;
}

// Benachrichtigt alle angemeldeten Handys ausser dem, das die Aenderung
// selbst gemacht hat (z.B. Tilo aendert etwas -> Meli, Lili und Thomi
// bekommen eine Benachrichtigung, sofern sie das aktiviert haben).
// "actor" ist "a"/"b"/"c"/"d" (wer die Aenderung gemacht hat) - fehlt
// dieser Wert (z.B. altes App-Update ohne diese Info), wird nichts
// verschickt, da sonst nicht klar waere, wer die Aenderung gemacht hat.
function notifyOthers(actor, dateKey) {
  Logger.log("notifyOthers: actor=" + actor + " dateKey=" + dateKey);
  if (!actor) {
    Logger.log("notifyOthers: kein actor mitgeschickt -> abgebrochen");
    return;
  }
  const subs = getSubscriptionsExcept(actor);
  Logger.log("notifyOthers: " + subs.length + " Empfaenger-Subscription(en) gefunden (alle ausser '" + actor + "')");
  if (subs.length === 0) return;

  const props = PropertiesService.getScriptProperties();
  const relayUrl = props.getProperty("PUSH_RELAY_URL");
  const secret = props.getProperty("PUSH_RELAY_SECRET");
  Logger.log("notifyOthers: PUSH_RELAY_URL gesetzt=" + !!relayUrl + " PUSH_RELAY_SECRET gesetzt=" + !!secret);
  if (!relayUrl || !secret) return; // Push-Benachrichtigungen nicht eingerichtet

  const payload = {
    secret: secret,
    subscriptions: subs,
    title: "Lili & Thomi Kalender",
    body: "Es gibt eine Änderung am " + formatDateGerman(dateKey) + ".",
    url: "./"
  };

  const response = UrlFetchApp.fetch(relayUrl, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  Logger.log("notifyOthers: Antwort von send-push: HTTP " + response.getResponseCode() + " " + response.getContentText());
}

function formatDateGerman(dateKey) {
  const parts = String(dateKey).split("-");
  if (parts.length !== 3) return dateKey;
  return parts[2] + "." + parts[1] + "." + parts[0];
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
