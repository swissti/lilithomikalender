// Netlify Function: sendet Web-Push-Benachrichtigungen.
//
// Wird vom Google-Apps-Script-Backend aufgerufen, wenn sich ein Kalender-
// Eintrag geändert hat. Übernimmt die eigentliche Verschlüsselung/Zustellung
// über die "web-push"-Bibliothek (das kann Apps Script nicht selbst).
//
// Erwartete Umgebungsvariablen (in den Netlify-Site-Einstellungen setzen,
// NICHT im Code/Repo!):
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   VAPID_SUBJECT        z.B. "mailto:deine@email.ch"
//   PUSH_RELAY_SECRET    beliebiges langes Zufalls-Geheimnis, muss mit dem
//                        Wert in den Apps-Script-Script-Properties übereinstimmen
//
// Erwarteter POST-Body (JSON):
//   {
//     "secret": "...",
//     "subscriptions": [ { endpoint, keys:{p256dh,auth} }, ... ],
//     "title": "Lili & Thomi Kalender",
//     "body": "Meli hat einen Eintrag geändert.",
//     "url": "/"
//   }

const webpush = require('web-push');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const SECRET = process.env.PUSH_RELAY_SECRET;
  const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
  const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:kein-kontakt@example.com';

  if (!SECRET || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server nicht konfiguriert: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / PUSH_RELAY_SECRET fehlen als Umgebungsvariable.' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungueltiges JSON' }) };
  }

  if (payload.secret !== SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const subscriptions = Array.isArray(payload.subscriptions) ? payload.subscriptions : [];
  if (subscriptions.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, results: [] }) };
  }

  const title = payload.title || 'Lili & Thomi Kalender';
  const body = payload.body || 'Es gibt eine Änderung im Kalender.';
  const url = payload.url || '/';

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const notificationPayload = JSON.stringify({ title, body, url });

  const results = await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, notificationPayload);
      return { ok: true, endpoint: sub.endpoint };
    } catch (err) {
      // 404/410 = Subscription existiert nicht mehr (App deinstalliert o.ä.) -> normal, kein echter Fehler
      return { ok: false, statusCode: err.statusCode, endpoint: sub.endpoint, message: err.message };
    }
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, results })
  };
};
