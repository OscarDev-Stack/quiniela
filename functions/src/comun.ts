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

/**
 * Opciones comunes de las funciones onCall (y del webhook onRequest).
 *
 * `invoker: 'public'` fija el permiso de invocación de Cloud Run a `allUsers`
 * en cada deploy. Así las funciones que llama el navegador quedan siempre en
 * "Permitir acceso público" (autenticación a nivel de red), sin depender de
 * ajustes manuales en la consola. La seguridad real la dan Firebase Auth
 * (req.auth dentro de cada función) y, cuando se active, App Check.
 * NOTA: no aplica a onSchedule (esas no usan opcionesCall; las dispara
 * Cloud Scheduler y no se exponen públicamente).
 */
export const opcionesCall = {
    enforceAppCheck: EXIGIR_APP_CHECK,
    invoker: 'public' as const,
};

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

/* --- Ranking (helper transversal) --- */
/**
 * Actualiza las filas del ranking de los usuarios indicados. Lo usan casi
 * todos los dominios (partidos, torneos, brackets, usuarios), por eso vive
 * en la base común. Reescribe la fila `ranking/{uid}` a partir del doc del
 * usuario; borra la fila si la cuenta no está validada o no participa.
 */
export async function actualizarRanking(uids: string[]): Promise<void> {
    const unicos = [...new Set(uids)];
    for (let i = 0; i < unicos.length; i += 100) {
        const refs = unicos.slice(i, i + 100).map((u) => db.doc(`users/${u}`));
        if (refs.length === 0) continue;
        const snaps = await db.getAll(...refs);
        const batch = db.batch();
        for (const sn of snaps) {
            const rankRef = db.doc(`ranking/${sn.id}`);
            // Fuera del ranking: cuentas sin validar y cuentas de puro
            // administrador que no compiten (marcadas noParticipa).
            if (
                !sn.exists ||
                sn.data()?.['validada'] !== true ||
                sn.data()?.['noParticipa'] === true
            ) {
                batch.delete(rankRef);
                continue;
            }
            const u = sn.data() as Record<string, unknown>;
            const resueltos = Number(u['resueltos'] ?? 0);
            const aciertos = Number(u['aciertos'] ?? 0);
            const email = String(u['email'] ?? '');
            const totalGastado = Number(u['totalGastado'] ?? 0);
            const totalGanado = Number(u['totalGanado'] ?? 0);
            batch.set(rankRef, {
                alias: String(u['alias'] ?? '').trim() || email.split('@')[0] || 'jugador',
                // Histórico: no lo afecta el reinicio de saldo del administrador.
                puntos: Number(u['puntosHistoricos'] ?? u['puntos'] ?? 0),
                saldo: Number(u['puntos'] ?? 0),
                torneosGanados: Number(u['torneosGanados'] ?? 0),
                aciertos,
                resueltos,
                porcentaje: resueltos > 0 ? Math.round((aciertos / resueltos) * 100) : 0,
                calificado: resueltos >= MIN_RESUELTOS,
                racha: Number(u['racha'] ?? 0),
                mejorRacha: Number(u['mejorRacha'] ?? 0),
                // Totales para la tabla de histórico (solo admin).
                totalGastado,
                totalGanado,
                balance: totalGanado - totalGastado,
                actualizado: FieldValue.serverTimestamp(),
            });
        }
        await batch.commit();
    }
}

/* --- Helpers compartidos entre torneos y brackets --- */

/**
 * Deja constancia de un torneo/eliminatoria ganado: un trofeo por persona y
 * el contador en su perfil. La usan torneos (al cerrar) y brackets (al
 * calificar), por eso vive en la base común.
 */
export async function registrarTrofeos(
    ganadores: Array<{ uid: string; alias: string }>,
    torneoId: string,
    nombreTorneo: string,
    competicion: string,
    premio: number,
    compartido: boolean,
): Promise<void> {
    if (ganadores.length === 0) return;

    const batch = db.batch();
    for (const g of ganadores) {
        batch.set(db.doc(`trofeos/${g.uid}_${torneoId}`), {
            uid: g.uid,
            alias: g.alias,
            torneoId,
            torneo: nombreTorneo,
            competicion,
            premio,
            compartido,
            ganadoEn: FieldValue.serverTimestamp(),
        });
        batch.set(
            db.doc(`users/${g.uid}`),
            { torneosGanados: FieldValue.increment(1) },
            { merge: true },
        );
    }
    await batch.commit();
}

/** Genera un código corto de invitación (6 caracteres, sin ambiguos). Lo usan
 * torneos y brackets. */
export function codigoBracket(): string {
    const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => letras.charAt(Math.floor(Math.random() * letras.length))).join('');
}

// Re-exportamos lo de firestore que usan todos, para que los módulos importen
// desde un solo lugar.
export { FieldValue, Timestamp, HttpsError };
