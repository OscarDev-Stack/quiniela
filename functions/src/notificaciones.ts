/* ============================================================
   NOTIFICACIONES (push + Telegram)
   Helpers compartidos para avisar a los usuarios. Los usa casi todo
   el resto de dominios (torneos, brackets, partidos, grupos), así que
   viven aquí, exportados, y el resto los importa.
   ============================================================ */
import * as logger from 'firebase-functions/logger';
import { onCall, onRequest } from 'firebase-functions/v2/https';
import { getMessaging } from 'firebase-admin/messaging';
import {
    db,
    FieldValue,
    Timestamp,
    HttpsError,
    opcionesCall,
    telegramToken,
    telegramWebhookSecret,
    esProd,
} from './comun';

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

/* ============================================================
   NOTIFICACIONES POR TELEGRAM
   Los helpers (avisar, enviarPush, enviarTelegram, categorías) viven
   en ./notificaciones y se importan arriba. Aquí quedan las funciones
   onCall/onRequest del canal (guardar prefs, push, telegram, webhook).
   ============================================================ */

/**
 * Guarda las preferencias de CATEGORÍA de notificaciones del usuario
 * (qué tipos quiere recibir). Es independiente del canal (push/Telegram).
 */
export const guardarPrefsNotif = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const d = req.data ?? {};
    // Solo guardamos las tres categorías conocidas, como booleanos.
    const prefsNotif = {
        torneosInscritos: d.torneosInscritos !== false, // default true
        oportunidades: d.oportunidades === true, // default false
        partidos: d.partidos !== false, // default true
    };

    await db.doc(`users/${uid}`).set({ prefsNotif }, { merge: true });
    return { ok: true };
});

export const guardarPush = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const activo = req.data?.activo === true;
    const token = String(req.data?.token ?? '').trim();

    const ref = db.doc(`users/${uid}`);
    if (activo) {
        if (!token) throw new HttpsError('invalid-argument', 'Falta el token del dispositivo.');
        await ref.update({
            pushActivo: true,
            pushTokens: FieldValue.arrayUnion(token),
        });
    } else {
        // Al desactivar, quitamos este dispositivo. Si mandó token, solo ese;
        // si no, apagamos el switch (deja de recibir en todos).
        const update: Record<string, unknown> = { pushActivo: false };
        if (token) update['pushTokens'] = FieldValue.arrayRemove(token);
        await ref.update(update);
    }
    return { ok: true };
});

/** Guarda el chat de Telegram del propio usuario y manda una prueba. */
export const guardarTelegram = onCall(
    { ...opcionesCall, secrets: [telegramToken] },
    async (req) => {
        const uid = req.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

        const yo = await db.doc(`users/${uid}`).get();
        if (yo.data()?.['validada'] !== true) {
            throw new HttpsError('permission-denied', 'Tu cuenta todavía está en revisión.');
        }

        const chatId = String(req.data?.chatId ?? '').trim();
        const activo = req.data?.activo === true;

        if (activo && !/^-?\d{5,20}$/.test(chatId)) {
            throw new HttpsError(
                'invalid-argument',
                'El identificador debe ser el número que te da @userinfobot.',
            );
        }

        await db.doc(`users/${uid}`).set(
            {
                telegramChatId: activo ? chatId : '',
                notificaciones: activo,
            },
            { merge: true },
        );

        // Al activarlas, una prueba inmediata confirma que el número es correcto.
        let prueba = false;
        if (activo) {
            prueba = await enviarTelegram(
                chatId,
                '<b>Quiniela</b>\nListo, aquí te llegarán los avisos de tus torneos.',
            );
        }

        return { ok: true, activo, prueba };
    },
);

/* ============================================================
   VINCULACIÓN CON UN TOQUE
   La app pide un código temporal y arma un enlace a Telegram.
   Al pulsar Iniciar, el bot recibe el código y guarda el chat
   solo, sin que nadie tenga que copiar números.
   ============================================================ */

/** Genera el enlace personal para conectar Telegram. */
export const vincularTelegram = onCall(
    { ...opcionesCall, secrets: [telegramToken] },
    async (req) => {
        const uid = req.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

        const yo = await db.doc(`users/${uid}`).get();
        if (yo.data()?.['validada'] !== true) {
            throw new HttpsError('permission-denied', 'Tu cuenta todavía está en revisión.');
        }

        // Código corto de un solo uso, válido por diez minutos.
        const codigo = Math.random().toString(36).slice(2, 10).toUpperCase();
        const expira = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);

        await db.doc(`users/${uid}`).set(
            { vinculoTelegram: { codigo, expira } },
            { merge: true },
        );

        // Preguntamos al propio bot cómo se llama, para armar el enlace.
        const token = telegramToken.value();
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const info = (await res.json()) as { ok: boolean; result?: { username?: string } };

        const usuario = info?.result?.username;
        if (!usuario) {
            throw new HttpsError('internal', 'No se pudo contactar al bot. Revisa el token.');
        }

        return { ok: true, enlace: `https://t.me/${usuario}?start=${codigo}` };
    },
);

/**
 * Recibe los mensajes que le llegan al bot.
 * Solo entiende dos cosas: el /start con código para conectar,
 * y /stop para dejar de recibir avisos.
 */
export const telegramWebhook = onRequest(
    // Público: lo llama Telegram (sin credencial IAM). La autenticidad se
    // valida con el header secreto (x-telegram-bot-api-secret-token).
    { secrets: [telegramToken, telegramWebhookSecret], maxInstances: 3, invoker: 'public' },
    async (req, res) => {
        // Telegram manda este encabezado; si no coincide, no es él.
        const esperado = telegramWebhookSecret.value();
        if (esperado && req.header('x-telegram-bot-api-secret-token') !== esperado) {
            res.status(403).send('no');
            return;
        }

        const mensaje = req.body?.message as
            | { text?: string; chat?: { id?: number | string } }
            | undefined;

        const chatId = String(mensaje?.chat?.id ?? '');
        const texto = String(mensaje?.text ?? '').trim();
        if (!chatId || !texto) {
            res.status(200).send('ok');
            return;
        }

        // Dejar de recibir.
        if (texto === '/stop') {
            const suyos = await db
                .collection('users')
                .where('telegramChatId', '==', chatId)
                .limit(1)
                .get();

            if (!suyos.empty) {
                await suyos.docs[0].ref.set({ notificaciones: false }, { merge: true });
            }
            await enviarTelegram(chatId, 'Listo, ya no te mandaremos avisos. Usa /start para volver.');
            res.status(200).send('ok');
            return;
        }

        // Conectar con el código del enlace.
        const codigo = texto.startsWith('/start') ? texto.split(/\s+/)[1] : '';
        if (!codigo) {
            await enviarTelegram(
                chatId,
                'Para conectar tu cuenta, entra a tu perfil en la app y toca <b>Conectar Telegram</b>.',
            );
            res.status(200).send('ok');
            return;
        }

        const encontrados = await db
            .collection('users')
            .where('vinculoTelegram.codigo', '==', codigo.toUpperCase())
            .limit(1)
            .get();

        if (encontrados.empty) {
            await enviarTelegram(chatId, 'Ese enlace ya no sirve. Genera uno nuevo desde la app.');
            res.status(200).send('ok');
            return;
        }

        const doc = encontrados.docs[0];
        const vinculo = doc.data()['vinculoTelegram'] as { expira?: Timestamp } | undefined;

        if (vinculo?.expira && vinculo.expira.toMillis() < Date.now()) {
            await enviarTelegram(chatId, 'Ese enlace ya venció. Genera uno nuevo desde la app.');
            res.status(200).send('ok');
            return;
        }

        await doc.ref.set(
            {
                telegramChatId: chatId,
                notificaciones: true,
                vinculoTelegram: FieldValue.delete(),
            },
            { merge: true },
        );

        await enviarTelegram(
            chatId,
            `¡Va, ${String(doc.data()['alias'] ?? '')}! Ya quedaste. 🏆\n\n` +
            'Te escribo cuando abra una jornada para que no se te pase elegir, ' +
            'y cuando salgan los resultados.\n\n' +
            'Para dejar de recibirlos: /stop',
        );

        logger.info(`Telegram vinculado para ${doc.id}.`);
        res.status(200).send('ok');
    },
);

/**
 * Avisa a los administradores que hay una cuenta nueva por validar.
 * La llama la propia app al terminar el registro. Solo dispara una vez
 * por cuenta y únicamente si de verdad está recién creada.
 */
export const avisarRegistro = onCall(
    { ...opcionesCall, secrets: [telegramToken] },
    async (req) => {
        const uid = req.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

        const ref = db.doc(`users/${uid}`);
        const snap = await ref.get();
        if (!snap.exists) return { ok: false };

        const u = snap.data() as Record<string, unknown>;

        // Ya se avisó, o la cuenta no es nueva: no hacemos nada.
        if (u['avisoRegistro'] === true) return { ok: false };

        const creada = u['createdAt'] as Timestamp | undefined;
        if (creada && Date.now() - creada.toMillis() > 10 * 60 * 1000) {
            await ref.set({ avisoRegistro: true }, { merge: true });
            return { ok: false };
        }

        await ref.set({ avisoRegistro: true }, { merge: true });

        const admins = await db.collection('admins').get();
        const pendientes = await db.collection('users').where('validada', '==', false).count().get();

        const enviados = await avisar(
            admins.docs.map((d) => d.id),
            '👤 <b>Cuenta nueva</b>\n' +
            `${String(u['alias'] ?? 'Sin alias')} · ${String(u['email'] ?? '')}\n\n` +
            `Hay ${pendientes.data().count} cuenta(s) esperando validación.`,
            undefined,
            '/admin/usuarios',
        );

        return { ok: true, enviados };
    },
);


/* ============================================================
   SOLICITUD DE REINICIO DE SALDO
   Solo avisa a los administradores por Telegram. No cambia nada
   en la cuenta: el reinicio lo hacen ellos a mano, como siempre.
   ============================================================ */
export const solicitarReinicio = onCall(
    { ...opcionesCall, secrets: [telegramToken] },
    async (req) => {
        const uid = req.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

        const snap = await db.doc(`users/${uid}`).get();
        if (!snap.exists) throw new HttpsError('not-found', 'No encontramos tu cuenta.');

        const u = snap.data() as Record<string, unknown>;
        if (u['validada'] !== true) {
            throw new HttpsError('permission-denied', 'Tu cuenta todavía está en revisión.');
        }

        const alias = String(u['alias'] ?? u['email'] ?? 'jugador');
        const saldo = Number(u['puntos'] ?? 0);

        // Una solicitud por saldo: mientras no se mueva, es la misma petición
        // y no tiene caso volver a molestar a los administradores.
        const anterior = u['solicitudReinicio'] as Record<string, unknown> | undefined;
        if (anterior && Number(anterior['saldo']) === saldo) {
            throw new HttpsError(
                'failed-precondition',
                'Ya pediste el reinicio con este saldo. Podrás pedirlo de nuevo cuando cambie.',
            );
        }

        await db.doc(`users/${uid}`).set(
            { solicitudReinicio: { saldo, pedidoAt: FieldValue.serverTimestamp() } },
            { merge: true },
        );

        const admins = await db.collection('admins').get();
        await avisar(
            admins.docs.map((d) => d.id),
            '♻️ <b>Solicitud de reinicio</b>\n' +
            `${alias} pide que le reinicien el saldo.\n` +
            `Va en ${saldo} pts.`,
            undefined,
            '/admin/usuarios',
        );

        return { ok: true };
    },
);
