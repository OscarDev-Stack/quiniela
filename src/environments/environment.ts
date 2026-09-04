export const environment = {
    production: false,
    firebase: {
        apiKey: "AIzaSyABu6F2GAVC3aNa1hLhVTXBdvvwNeEPPQE",
        authDomain: "quiniela-dev-d203d.firebaseapp.com",
        projectId: "quiniela-dev-d203d",
        storageBucket: "quiniela-dev-d203d.firebasestorage.app",
        messagingSenderId: "886993597039",
        appId: "1:886993597039:web:6b1e4cc0002496bb43139a",
        measurementId: 'G-F9Z8QCSFH2',
    },
    vapidKey: 'BHe6zPO4thncjT4HgJg2rIlIgjlyAjPcfthtBilHGkIzrPObCRne9--HHDWjmNhRxfT9-zctBTSfvtGKIh6I5lE',
    // Site Key pública de Cloudflare Turnstile para DEV. Debe tener permitido
    // el dominio de dev (y localhost) en el dashboard de Cloudflare, o el
    // widget saldrá en blanco. Reemplázala por la key de tu widget de dev.
    turnstileSiteKey: '0x4AAAAAAEdUWtaENzy8lzBw',
};