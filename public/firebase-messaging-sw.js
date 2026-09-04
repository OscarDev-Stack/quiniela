/* ============================================================
   Service worker de Firebase Cloud Messaging.
   Recibe las notificaciones push cuando la app está cerrada
   o en segundo plano.

   NO edites los placeholders (TU_API_KEY, TU_PROYECTO, ...) a mano.
   Este archivo es una PLANTILLA: tras `ng build`, el script
   `scripts/generar-sw.js` reemplaza estos valores por el config real
   del entorno (prod o dev) en la carpeta dist/. Se usa así porque el
   service worker corre fuera de Angular y no puede leer environment.ts.
   Usa `npm run build:prod` o `npm run build:dev`.
   La apiKey y el senderId son identificadores públicos, no secretos.
   ============================================================ */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: 'TU_API_KEY',
    authDomain: 'TU_PROYECTO.firebaseapp.com',
    projectId: 'TU_PROYECTO',
    storageBucket: 'TU_PROYECTO.appspot.com',
    messagingSenderId: 'TU_SENDER_ID',
    appId: 'TU_APP_ID',
});

const messaging = firebase.messaging();

// Dominio de ESTA app. Es un placeholder que `scripts/generar-sw.js` reemplaza
// por el dominio real según el entorno (prod o dev), igual que el firebaseConfig.
// Así en dev la notificación enfoca la app de dev, y en prod la de prod, sin
// abrir el dominio equivocado en una pestaña nueva.
const APP_URL = 'TU_APP_URL';

// Notificación recibida con la app en segundo plano o cerrada.
messaging.onBackgroundMessage((payload) => {
    const titulo = payload.notification?.title ?? 'Quiniela';
    const opciones = {
        body: payload.notification?.body ?? '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: payload.fcmOptions?.link ?? APP_URL },
    };
    self.registration.showNotification(titulo, opciones);
});

// Al tocar la notificación, abre la pantalla del deep link (o enfoca la app
// ya abierta y la LLEVA a esa pantalla, no solo la enfoca donde estaba).
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url ?? APP_URL;
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
            for (const c of lista) {
                if (c.url.startsWith(APP_URL) && 'focus' in c) {
                    // Navega la ventana existente al destino y la enfoca.
                    if ('navigate' in c) {
                        return c.navigate(url).then((cl) => (cl || c).focus());
                    }
                    return c.focus();
                }
            }
            return clients.openWindow(url);
        }),
    );
});