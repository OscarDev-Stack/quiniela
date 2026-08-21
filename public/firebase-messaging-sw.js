/* ============================================================
   Service worker de Firebase Cloud Messaging.
   Recibe las notificaciones push cuando la app está cerrada
   o en segundo plano.

   IMPORTANTE: reemplaza los valores de firebaseConfig por los
   REALES de tu proyecto (los mismos de environment.ts). Aquí no
   se puede usar environment porque este archivo corre fuera de
   Angular, como service worker independiente. La apiKey y el
   senderId son identificadores públicos, no secretos.
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

// Notificación recibida con la app en segundo plano o cerrada.
messaging.onBackgroundMessage((payload) => {
    const titulo = payload.notification?.title ?? 'Quiniela';
    const opciones = {
        body: payload.notification?.body ?? '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: payload.fcmOptions?.link ?? 'https://automatepowerv1.web.app' },
    };
    self.registration.showNotification(titulo, opciones);
});

// Al tocar la notificación, abre (o enfoca) la app.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url ?? 'https://automatepowerv1.web.app';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
            for (const c of lista) {
                if (c.url.includes('automatepowerv1.web.app') && 'focus' in c) return c.focus();
            }
            return clients.openWindow(url);
        }),
    );
});