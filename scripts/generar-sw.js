/* eslint-disable */
/**
 * Genera el service worker de messaging con el firebaseConfig del entorno.
 *
 * El archivo fuente `public/firebase-messaging-sw.js` es una PLANTILLA con
 * placeholders (TU_API_KEY, TU_PROYECTO, ...). El service worker corre fuera
 * de Angular, así que no puede leer environment.ts; por eso, tras `ng build`,
 * este script escribe el config REAL (público, no secreto) en el archivo ya
 * copiado a `dist/`, según el entorno (prod o dev).
 *
 * Uso:
 *   node scripts/generar-sw.js prod    (por defecto)
 *   node scripts/generar-sw.js dev
 *
 * Los valores salen de src/environments/environment(.prod).ts para no
 * duplicarlos a mano.
 */

const fs = require('fs');
const path = require('path');

const entorno = (process.argv[2] || 'prod').toLowerCase();
const esDev = entorno === 'dev';

const raiz = path.resolve(__dirname, '..');
const envFile = path.join(
    raiz,
    'src',
    'environments',
    esDev ? 'environment.ts' : 'environment.prod.ts',
);

// Extrae el objeto firebase del environment sin ejecutar TypeScript: leemos el
// archivo y sacamos los valores con expresiones simples (son claves públicas).
function leerFirebaseConfig(archivo) {
    const texto = fs.readFileSync(archivo, 'utf8');
    const campo = (nombre) => {
        const m = texto.match(new RegExp(nombre + "\\s*:\\s*[\"']([^\"']+)[\"']"));
        return m ? m[1] : '';
    };
    return {
        apiKey: campo('apiKey'),
        authDomain: campo('authDomain'),
        projectId: campo('projectId'),
        storageBucket: campo('storageBucket'),
        messagingSenderId: campo('messagingSenderId'),
        appId: campo('appId'),
    };
}

const cfg = leerFirebaseConfig(envFile);
if (!cfg.apiKey || !cfg.projectId || !cfg.messagingSenderId) {
    console.error(`[generar-sw] No pude leer el firebaseConfig de ${envFile}`);
    process.exit(1);
}

// El SW ya fue copiado a dist/ por `ng build`. Detectamos la carpeta de salida.
const candidatos = [
    path.join(raiz, 'dist', 'quiniela', 'browser', 'firebase-messaging-sw.js'),
    path.join(raiz, 'dist', 'quiniela', 'firebase-messaging-sw.js'),
];
const destino = candidatos.find((p) => fs.existsSync(p));
if (!destino) {
    console.error('[generar-sw] No encontré firebase-messaging-sw.js en dist/. ¿Corriste ng build antes?');
    process.exit(1);
}

let sw = fs.readFileSync(destino, 'utf8');
sw = sw
    .replace(/apiKey:\s*'TU_API_KEY'/, `apiKey: '${cfg.apiKey}'`)
    .replace(/authDomain:\s*'TU_PROYECTO\.firebaseapp\.com'/, `authDomain: '${cfg.authDomain}'`)
    .replace(/projectId:\s*'TU_PROYECTO'/, `projectId: '${cfg.projectId}'`)
    .replace(/storageBucket:\s*'TU_PROYECTO\.appspot\.com'/, `storageBucket: '${cfg.storageBucket}'`)
    .replace(/messagingSenderId:\s*'TU_SENDER_ID'/, `messagingSenderId: '${cfg.messagingSenderId}'`)
    .replace(/appId:\s*'TU_APP_ID'/, `appId: '${cfg.appId}'`);

fs.writeFileSync(destino, sw, 'utf8');
console.log(`[generar-sw] Service worker generado para ${esDev ? 'DEV' : 'PROD'} (${cfg.projectId}).`);
console.log(`[generar-sw] Escrito en: ${destino}`);
