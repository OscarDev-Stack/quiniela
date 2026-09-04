/* ============================================================
   Base común de las Cloud Functions.
   Aquí vive lo transversal que usan todos los dominios: la
   inicialización de Firebase Admin, el cliente de Firestore, las
   constantes del juego, los secrets, el helper de schedule por
   entorno y utilidades del "bote". Se extrajo del index.ts para
   partir el monolito por dominios sin cambiar comportamiento.
   ============================================================ */
import { HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

// Debe correr una sola vez y antes de getFirestore(). Al importar este módulo
// (que todos los demás importan), queda garantizado.
initializeApp();

/** Cliente de Firestore compartido. */
export const db = getFirestore();

/* --- Entorno --- */
const PROYECTO_PROD = 'quinelav1-e23eb';
export const esProd = process.env.GCLOUD_PROJECT === PROYECTO_PROD;

/**
 * Devuelve el schedule de un job: en prod, cada `minutos`; en dev, cada
 * `minutos * 2`. Así el mismo código sirve para ambos entornos sin tener
 * intervalos fijos regados por el archivo.
 */
export const cada = (minutos: number): string => {
    const m = esProd ? minutos : minutos * 2;
    return `every ${m} minutes`;
};

/* --- Constantes del juego --- */
export const APUESTA_BASE = 100;
export const TOPE_INFERIOR = -1000;
export const MULTIPLICADOR_MAX = 5;
/** Pronósticos por lote (el límite de Firestore es 500 operaciones). */
export const PRONOSTICOS_POR_LOTE = 150;
/** Mínimo de pronósticos resueltos para calificar al ranking por %. */
export const MIN_RESUELTOS = 1;
/** Minutos tras el inicio antes de empezar a consultar la API. */
export const MINUTOS_ANTES_DE_CONSULTAR = 100;

/**
 * Techo de instancias simultáneas por función. Evita que un pico
 * (o un abuso) escale a cientos de contenedores y dispare el costo.
 */
setGlobalOptions({ maxInstances: 10 });

/**
 * Exigir App Check en las funciones que llama el navegador.
 * Ponlo en true DESPUÉS de configurar App Check y comprobar que
 * la app funciona; si lo activas antes, dejará de responder.
 */
const EXIGIR_APP_CHECK = false;
export const opcionesCall = { enforceAppCheck: EXIGIR_APP_CHECK };

/* --- Secrets --- */
/** Llave de football-data.org. `firebase functions:secrets:set FOOTBALL_DATA_KEY` */
export const footballDataKey = defineSecret('FOOTBALL_DATA_KEY');
export const telegramToken = defineSecret('TELEGRAM_TOKEN');
export const telegramWebhookSecret = defineSecret('TELEGRAM_WEBHOOK_SECRET');
/** Secret Key de Cloudflare Turnstile. `firebase functions:secrets:set TURNSTILE_SECRET_KEY` */
export const turnstileSecret = defineSecret('TURNSTILE_SECRET_KEY');
/** Key de TheSportsDB (premium). `firebase functions:secrets:set SPORTSDB_KEY` */
export const sportsDbKey = defineSecret('SPORTSDB_KEY');

/* --- Bote (parte de la bolsa que se aparta al sistema/reserva) --- */
/**
 * Calcula cuánto de un cobro se va al "bote" acumulado (sistema/reserva),
 * según el porcentaje configurado en el torneo/partido. El % SALE de la
 * bolsa: el jugador paga igual, pero esta parte no engorda la bolsa del
 * torneo, sino el bote global que luego se jugará aparte.
 *
 * Devuelve el monto que va al bote (para restarlo de la bolsa). Escribir
 * en la reserva y el ledger es responsabilidad de quien llama, con
 * registrarBote().
 */
export function calcularBote(monto: number, porcentaje: unknown): number {
    const pct = Number(porcentaje ?? 0);
    if (!pct || pct <= 0 || monto <= 0) return 0;
    return Math.floor((monto * pct) / 100);
}

/** Suma al bote (fuera de transacción) y deja constancia en el ledger. */
export async function registrarBote(monto: number, origen: string): Promise<void> {
    if (monto <= 0) return;
    await db.doc('sistema/reserva').set({ total: FieldValue.increment(monto) }, { merge: true });
    await db.collection('ledger').add({
        uid: 'reserva',
        tipo: 'bote',
        monto,
        detalle: origen,
        createdAt: FieldValue.serverTimestamp(),
    });
}

// Re-exportamos lo de firestore que usan todos, para que los módulos importen
// desde un solo lugar.
export { FieldValue, Timestamp, HttpsError };
