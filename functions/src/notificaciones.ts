/* ============================================================
   NOTIFICACIONES (push + Telegram)
   Helpers compartidos para avisar a los usuarios. Los usa casi todo
   el resto de dominios (torneos, brackets, partidos, grupos), así que
   viven aquí, exportados, y el resto los importa.
   ============================================================ */
import * as logger from 'firebase-functions/logger';
import { getMessaging } from 'firebase-admin/messaging';
import { db, FieldValue, telegramToken, esProd } from './comun';

/** Manda un mensaje de Telegram. Nunca revienta: si falla, solo lo anota. */
export async function enviarTelegram(chatId: string, texto: string): Promise<boolean> {
    const token = telegramToken.value();
    if (!token || !chatId) return false;

    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: texto,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
            }),
        });

        if (!res.ok) {
            logger.warn(`Telegram respondió ${res.status} para el chat ${chatId}.`);
            return false;
        }
        return true;
    } catch (e) {
        logger.warn('No se pudo enviar el mensaje de Telegram.', e);
        return false;
    }
}

/** Quita las etiquetas HTML (que usa Telegram) para las notificaciones push. */
export function limpiarHtml(texto: string): string {
    return texto
        .replace(/<[^>]+>/g, '') // quita <b>, </b>, <i>, etc.
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}

/**
 * Base del sitio para armar los enlaces de las notificaciones push. Depende del
 * entorno: en prod apunta al dominio de producción; en dev, al de desarrollo.
 * Así el deep link de la push abre la app correcta según dónde corre la función
 * (si no, dev mandaba links a prod y el clic abría el dominio equivocado).
 */
export const APP_URL = esProd
    ? 'https://automatepowerv1.web.app'
    : 'https://quiniela-dev-d203d.web.app';

/**
 * Construye el enlace absoluto al que lleva la notificación al tocarla.
 * `ruta` es una ruta relativa de la app (ej. "/torneos/ID"); si no se pasa,
 * lleva al inicio.
 */
export function linkPush(ruta?: string): string {
    if (!ruta) return APP_URL;
    return `${APP_URL}${ruta.startsWith('/') ? ruta : '/' + ruta}`;
}

/**
 * Envía una notificación push a los dispositivos de un usuario vía FCM.
 * Limpia los tokens que el servicio reporte como inválidos (dispositivos
 * viejos o permisos revocados), para no acumular basura.
 */
export async function enviarPush(
    uid: string,
    tokens: string[],
    titulo: string,
    cuerpo: string,
    ruta?: string,
): Promise<boolean> {
    if (tokens.length === 0) return false;
    try {
        const resp = await getMessaging().sendEachForMulticast({
            tokens,
            notification: { title: titulo, body: cuerpo },
            webpush: {
                // Al tocar la notificación, abre la pantalla relevante (deep link).
                fcmOptions: { link: linkPush(ruta) },
                notification: {
                    icon: '/icons/icon-192.png',
                    // Ícono de la barra de estado (Android). Usamos el ícono
                    // disponible; el SW también fija su propio badge.
                    badge: '/icons/icon-192.png',
                },
            },
        });

        // Quita del usuario los tokens que fallaron por ser inválidos.
        const invalidos: string[] = [];
        resp.responses.forEach((r, i) => {
            if (!r.success) {
                const code = r.error?.code ?? '';
                if (
                    code === 'messaging/registration-token-not-registered' ||
                    code === 'messaging/invalid-registration-token'
                ) {
                    invalidos.push(tokens[i]);
                }
            }
        });
        if (invalidos.length > 0) {
            await db.doc(`users/${uid}`).update({
                pushTokens: FieldValue.arrayRemove(...invalidos),
            });
        }
        return resp.successCount > 0;
    } catch (e) {
        logger.warn(`No se pudo enviar push a ${uid}.`, e);
        return false;
    }
}

/** Categorías de notificación que el usuario puede activar/desactivar. */
export type CategoriaNotif = 'torneosInscritos' | 'oportunidades' | 'partidos';

/** Defaults si el usuario aún no configuró sus categorías. */
export const DEFAULT_PREFS_NOTIF: Record<CategoriaNotif, boolean> = {
    torneosInscritos: true,
    oportunidades: false,
    partidos: true,
};

/** ¿El usuario quiere recibir avisos de esta categoría? (con defaults). */
export function quiereCategoria(u: Record<string, unknown>, categoria?: CategoriaNotif): boolean {
    if (!categoria) return true; // avisos sin categoría (admin/operativos): siempre
    const prefs = (u['prefsNotif'] ?? {}) as Partial<Record<CategoriaNotif, boolean>>;
    return prefs[categoria] ?? DEFAULT_PREFS_NOTIF[categoria];
}

/**
 * Avisa a varios de una vez por push y/o Telegram, respetando el canal y la
 * CATEGORÍA de cada usuario. Si no se pasa categoría, el aviso es operativo
 * (p. ej. avisos a admin) y se envía siempre que tenga algún canal activo.
 */
export async function avisar(
    uids: string[],
    texto: string,
    categoria?: CategoriaNotif,
    ruta?: string,
): Promise<number> {
    if (uids.length === 0) return 0;

    const docs = await db.getAll(...uids.map((uid) => db.doc(`users/${uid}`)));
    let enviados = 0;

    for (const doc of docs) {
        const u = doc.data() as Record<string, unknown> | undefined;
        if (!u) continue;

        // Respeta la preferencia de categoría del usuario.
        if (!quiereCategoria(u, categoria)) continue;

        const quiereTelegram = u['notificaciones'] === true;
        const quierePush = u['pushActivo'] === true;
        // Si no quiere ninguno de los dos, nos lo saltamos.
        if (!quiereTelegram && !quierePush) continue;

        const chatId = String(u['telegramChatId'] ?? '');
        if (quiereTelegram && chatId && (await enviarTelegram(chatId, texto))) enviados++;

        // Push a sus dispositivos, si lo tiene activado.
        if (quierePush) {
            const tokens = (u['pushTokens'] ?? []) as string[];
            // La push no entiende HTML: quitamos <b>, <i>, etc. y usamos la
            // primera línea como título para que se lea mejor.
            const limpio = limpiarHtml(texto);
            const lineas = limpio.split('\n').filter((l) => l.trim());
            const titulo = lineas[0] ?? 'Quiniela';
            const cuerpo = lineas.slice(1).join('\n') || titulo;
            await enviarPush(doc.id, tokens, titulo, cuerpo, ruta);
        }
    }
    return enviados;
}
