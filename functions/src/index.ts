import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

initializeApp();
const db = getFirestore();

const APUESTA_BASE = 100;
const TOPE_INFERIOR = -1000;
const MULTIPLICADOR_MAX = 5;
/** Pronósticos por lote (el límite de Firestore es 500 operaciones). */
const PRONOSTICOS_POR_LOTE = 150;
/** Mínimo de pronósticos resueltos para calificar al ranking por %. */
const MIN_RESUELTOS = 1;

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
const opcionesCall = { enforceAppCheck: EXIGIR_APP_CHECK };
/** Minutos tras el inicio antes de empezar a consultar la API. */
const MINUTOS_ANTES_DE_CONSULTAR = 100;

/** Llave de football-data.org. Se configura con:
 *  firebase functions:secrets:set FOOTBALL_DATA_KEY */
const footballDataKey = defineSecret('FOOTBALL_DATA_KEY');
const telegramToken = defineSecret('TELEGRAM_TOKEN');
const telegramWebhookSecret = defineSecret('TELEGRAM_WEBHOOK_SECRET');

const API_BASE = 'https://api.football-data.org/v4';

interface PartidoApi {
    id: number;
    utcDate: string;
    status: string;
    homeTeam: { name: string; shortName?: string };
    awayTeam: { name: string; shortName?: string };
    score: { fullTime: { home: number | null; away: number | null } };
    competition?: { name: string };
}

/** Llama a football-data.org y devuelve la lista de partidos. */
async function consultarApi(ruta: string, key: string): Promise<PartidoApi[]> {
    // Un salto de línea o espacio invisible al pegar la llave la invalida.
    const token = (key ?? '').trim();
    console.log(`Consultando ${ruta} · llave de ${token.length} caracteres.`);

    const res = await fetch(`${API_BASE}/${ruta}`, {
        headers: { 'X-Auth-Token': token },
    });

    if (!res.ok) {
        const cuerpo = await res.text();
        console.error(`Error ${res.status} de la API:`, cuerpo);
        throw new HttpsError('internal', `La API respondió ${res.status}: ${cuerpo}`);
    }

    const data = (await res.json()) as { matches?: PartidoApi[]; count?: number };
    console.log(`API ${ruta}: ${data.matches?.length ?? 0} partido(s).`);
    return data.matches ?? [];
}

interface PronosticoDoc {
    uid: string;
    resultado: string;
    apuesta: number;
    estado: string;
}

/** Resultados válidos según el tipo de partido. */
function resultadosValidos(tipo: string): string[] {
    if (tipo === 'quien-pasa') return ['pasa-local', 'pasa-visitante'];
    if (tipo === '1-2') return ['local', 'visitante'];
    return ['local', 'empate', 'visitante'];
}


/** Actualiza las filas del ranking de los usuarios indicados. */
async function actualizarRanking(uids: string[]): Promise<void> {
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
                actualizado: FieldValue.serverTimestamp(),
            });
        }
        await batch.commit();
    }
}

/* ============================================================
   Colocar un pronóstico
   Descuenta la apuesta, crea el pronóstico e incrementa la bolsa,
   todo dentro de una transacción. El cliente nunca escribe puntos.
   ============================================================ */
export const crearPronostico = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }

    const partidoId = String(req.data?.partidoId ?? '');
    const resultado = String(req.data?.resultado ?? '');
    const multiplicador = Math.floor(Number(req.data?.multiplicador ?? 0));

    if (!partidoId || !resultado) {
        throw new HttpsError('invalid-argument', 'Faltan datos del pronóstico.');
    }
    if (multiplicador < 1 || multiplicador > MULTIPLICADOR_MAX) {
        throw new HttpsError('invalid-argument', 'Multiplicador no permitido.');
    }

    const apuesta = APUESTA_BASE * multiplicador;
    const pronRef = db.doc(`pronosticos/${uid}_${partidoId}`);
    const userRef = db.doc(`users/${uid}`);
    const partRef = db.doc(`partidos/${partidoId}`);
    const ledgerRef = db.collection('ledger').doc();

    await db.runTransaction(async (tx) => {
        const [pronSnap, userSnap, partSnap] = await Promise.all([
            tx.get(pronRef),
            tx.get(userRef),
            tx.get(partRef),
        ]);

        if (pronSnap.exists) {
            throw new HttpsError('already-exists', 'Ya hiciste un pronóstico para este partido.');
        }
        if (!userSnap.exists) {
            throw new HttpsError('not-found', 'No encontramos tu perfil.');
        }
        if (!partSnap.exists) {
            throw new HttpsError('not-found', 'El partido ya no existe.');
        }

        const me = userSnap.data() as Record<string, unknown>;
        const part = partSnap.data() as Record<string, unknown>;

        if (me['validada'] !== true) {
            throw new HttpsError(
                'permission-denied',
                'Tu cuenta aún no ha sido validada por un administrador.',
            );
        }
        if (me['bloqueado'] === true) {
            throw new HttpsError(
                'failed-precondition',
                'Tu cuenta está bloqueada. Pide al administrador que reinicie tus puntos.',
            );
        }

        const estado = String(part['status'] ?? '');
        if (estado !== 'abierto' && estado !== 'cierra-pronto') {
            throw new HttpsError('failed-precondition', 'Este partido ya no acepta pronósticos.');
        }

        // El cierre por hora manda, aunque el estado no se haya actualizado aún.
        const cierre = part['closesAt'] as Timestamp | undefined;
        if (cierre && cierre.toMillis() <= Date.now()) {
            throw new HttpsError('failed-precondition', 'El tiempo para pronosticar ya terminó.');
        }
        if (part['liquidado'] === true) {
            throw new HttpsError('failed-precondition', 'Este partido ya fue liquidado.');
        }

        const tipo = String(part['type'] ?? '1x2');
        if (!resultadosValidos(tipo).includes(resultado)) {
            throw new HttpsError('invalid-argument', 'Ese resultado no aplica para este partido.');
        }

        const puntos = Number(me['puntos'] ?? 0);
        const despues = puntos - apuesta;
        if (despues < TOPE_INFERIOR) {
            throw new HttpsError(
                'failed-precondition',
                `Con esta apuesta bajarías de ${TOPE_INFERIOR} pts. Elige un multiplicador menor.`,
            );
        }

        tx.set(pronRef, {
            uid,
            partidoId,
            partidoLabel: `${part['homeTeam'] ?? ''} vs ${part['awayTeam'] ?? ''}`,
            resultado,
            apuesta,
            multiplicador,
            estado: 'activo',
            createdAt: FieldValue.serverTimestamp(),
        });

        tx.update(userRef, {
            puntos: despues,
            // El histórico acumula todo movimiento y nunca se reinicia.
            puntosHistoricos: FieldValue.increment(-apuesta),
            bloqueado: despues - APUESTA_BASE < TOPE_INFERIOR,
        });

        // Agregados en colección privada: solo los admins pueden leerlos,
        // así el premio sigue oculto para los jugadores.
        tx.set(
            db.doc(`bolsas/${partidoId}`),
            {
                partidoId,
                total: FieldValue.increment(apuesta),
                [`porResultado.${resultado}`]: FieldValue.increment(apuesta),
                [`conteos.${resultado}`]: FieldValue.increment(1),
                actualizado: FieldValue.serverTimestamp(),
            },
            { merge: true },
        );

        tx.set(ledgerRef, {
            uid,
            tipo: 'apuesta',
            monto: -apuesta,
            saldoDespues: despues,
            partidoId,
            createdAt: FieldValue.serverTimestamp(),
        });
    });

    await actualizarRanking([uid]);

    return { ok: true, apuesta };
});

/* ============================================================
   Liquidar un partido
   Reparto proporcional, redondeo hacia abajo, sobrante a reserva
   y devoluciones si nadie acierta. Idempotente.
   ============================================================ */
export const liquidarPartido = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) {
        throw new HttpsError('permission-denied', 'Solo un administrador puede liquidar.');
    }

    const partidoId = String(req.data?.partidoId ?? '');
    const resultadoOficial = String(req.data?.resultadoOficial ?? '');
    if (!partidoId || !resultadoOficial) {
        throw new HttpsError('invalid-argument', 'Faltan datos del partido o del resultado.');
    }

    const partRef = db.doc(`partidos/${partidoId}`);
    const partSnap = await partRef.get();
    if (!partSnap.exists) {
        throw new HttpsError('not-found', 'El partido no existe.');
    }
    const partido = partSnap.data() as Record<string, unknown>;
    if (partido['liquidado'] === true) {
        throw new HttpsError('failed-precondition', 'Este partido ya fue liquidado.');
    }

    const pronSnap = await db
        .collection('pronosticos')
        .where('partidoId', '==', partidoId)
        .where('estado', '==', 'activo')
        .get();

    const pronosticos = pronSnap.docs.map((d) => ({
        ref: d.ref,
        ...(d.data() as PronosticoDoc),
    }));

    if (pronosticos.length === 0) {
        await partRef.update({
            resultadoOficial,
            status: 'cerrado',
            liquidado: true,
            liquidadoAt: FieldValue.serverTimestamp(),
        });
        return { ok: true, participantes: 0, ganadores: 0, bolsa: 0, sobrante: 0 };
    }

    const bolsa = pronosticos.reduce((acc, p) => acc + (p.apuesta ?? 0), 0);
    const ganadores = pronosticos.filter((p) => p.resultado === resultadoOficial);
    const perdedores = pronosticos.filter((p) => p.resultado !== resultadoOficial);
    const apostadoGanadores = ganadores.reduce((acc, p) => acc + (p.apuesta ?? 0), 0);

    const uidsAfectados = new Set<string>();
    let repartido = 0;

    const ops: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

    if (ganadores.length === 0) {
        for (const p of pronosticos) {
            uidsAfectados.add(p.uid);
            ops.push((batch) => {
                batch.update(p.ref, { estado: 'devuelto', premio: p.apuesta });
                batch.set(
                    db.doc(`users/${p.uid}`),
                    {
                        puntos: FieldValue.increment(p.apuesta),
                        puntosHistoricos: FieldValue.increment(p.apuesta),
                        resueltos: FieldValue.increment(1),
                    },
                    { merge: true },
                );
                batch.set(db.collection('ledger').doc(), {
                    uid: p.uid,
                    tipo: 'devolucion',
                    monto: p.apuesta,
                    partidoId,
                    createdAt: FieldValue.serverTimestamp(),
                });
            });
        }
    } else {
        for (const p of ganadores) {
            const premio = Math.floor((p.apuesta * bolsa) / apostadoGanadores);
            repartido += premio;
            uidsAfectados.add(p.uid);
            ops.push((batch) => {
                batch.update(p.ref, { estado: 'ganado', premio });
                batch.set(
                    db.doc(`users/${p.uid}`),
                    {
                        puntos: FieldValue.increment(premio),
                        puntosHistoricos: FieldValue.increment(premio),
                        resueltos: FieldValue.increment(1),
                        aciertos: FieldValue.increment(1),
                        racha: FieldValue.increment(1),
                    },
                    { merge: true },
                );
                batch.set(db.collection('ledger').doc(), {
                    uid: p.uid,
                    tipo: 'premio',
                    monto: premio,
                    partidoId,
                    createdAt: FieldValue.serverTimestamp(),
                });
            });
        }

        for (const p of perdedores) {
            uidsAfectados.add(p.uid);
            ops.push((batch) => {
                batch.update(p.ref, { estado: 'perdido', premio: 0 });
                batch.set(
                    db.doc(`users/${p.uid}`),
                    { resueltos: FieldValue.increment(1), racha: 0 },
                    { merge: true },
                );
            });
        }
    }

    for (let i = 0; i < ops.length; i += PRONOSTICOS_POR_LOTE) {
        const batch = db.batch();
        for (const op of ops.slice(i, i + PRONOSTICOS_POR_LOTE)) {
            op(batch);
        }
        await batch.commit();
    }

    const sobrante = ganadores.length === 0 ? 0 : bolsa - repartido;

    // Acumulados globales: reserva, puntos repartidos y partidos liquidados.
    await db.doc('sistema/reserva').set(
        {
            total: FieldValue.increment(sobrante),
            repartido: FieldValue.increment(repartido),
            liquidados: FieldValue.increment(1),
            actualizado: FieldValue.serverTimestamp(),
        },
        { merge: true },
    );

    if (sobrante > 0) {
        await db.collection('ledger').add({
            uid: 'reserva',
            tipo: 'sobrante',
            monto: sobrante,
            partidoId,
            createdAt: FieldValue.serverTimestamp(),
        });
    }

    const uids = [...uidsAfectados];
    for (let i = 0; i < uids.length; i += 100) {
        const refs = uids.slice(i, i + 100).map((u) => db.doc(`users/${u}`));
        if (refs.length === 0) continue;
        const snaps = await db.getAll(...refs);
        const batch = db.batch();
        for (const s of snaps) {
            if (!s.exists) continue;
            const d = s.data() ?? {};
            const puntos = Number(d['puntos'] ?? 0);
            const racha = Number(d['racha'] ?? 0);
            const mejorRacha = Math.max(Number(d['mejorRacha'] ?? 0), racha);
            batch.update(s.ref, {
                bloqueado: puntos - APUESTA_BASE < TOPE_INFERIOR,
                mejorRacha,
            });
        }
        await batch.commit();
    }

    await actualizarRanking(uids);
    await db.doc(`bolsas/${partidoId}`).delete().catch(() => undefined);

    await partRef.update({
        resultadoOficial,
        status: 'cerrado',
        liquidado: true,
        liquidadoAt: FieldValue.serverTimestamp(),
        poolTotal: bolsa,
    });

    return {
        ok: true,
        participantes: pronosticos.length,
        ganadores: ganadores.length,
        bolsa,
        sobrante,
    };
});


/* ============================================================
   Cierre automático de partidos
   Corre cada 5 minutos: marca "cierra pronto" los que están por
   cerrar y pasa a "en juego" los que ya alcanzaron su hora.
   ============================================================ */
export const cerrarPartidos = onSchedule('every 5 minutes', async () => {
    const enTreintaMin = Timestamp.fromMillis(Date.now() + 30 * 60 * 1000);
    // Ventana hacia atrás: ignora el histórico y mantiene la consulta pequeña
    // sin importar cuántos partidos se acumulen con el tiempo.
    const hace12Horas = Timestamp.fromMillis(Date.now() - 12 * 60 * 60 * 1000);

    // Rango sobre un solo campo: no requiere índice compuesto.
    const snap = await db
        .collection('partidos')
        .where('closesAt', '>=', hace12Horas)
        .where('closesAt', '<=', enTreintaMin)
        .get();

    let aJuego = 0;
    let aPronto = 0;

    for (const d of snap.docs) {
        const p = d.data() as Record<string, unknown>;
        const status = String(p['status'] ?? '');
        if (status !== 'abierto' && status !== 'cierra-pronto') continue;

        const cierre = p['closesAt'] as Timestamp | undefined;
        if (!cierre) continue;

        if (cierre.toMillis() <= Date.now()) {
            // Momento de revelar: se publican la bolsa y los premios por resultado.
            const bolsaSnap = await db.doc(`bolsas/${d.id}`).get();
            const total = Number(bolsaSnap.data()?.['total'] ?? 0);
            const porResultado = (bolsaSnap.data()?.['porResultado'] ?? {}) as Record<string, number>;

            // Cuánto pagaría cada 100 puntos apostados a ese resultado.
            const premioPor100: Record<string, number> = {};
            Object.entries(porResultado).forEach(([r, apostado]) => {
                premioPor100[r] = apostado > 0 ? Math.floor((100 * total) / apostado) : 0;
            });

            await d.ref.update({
                status: 'en-juego',
                poolTotal: total,
                porResultado,
                premioPor100,
            });
            aJuego++;
        } else if (status === 'abierto') {
            await d.ref.update({ status: 'cierra-pronto' });
            aPronto++;
        }
    }

    console.log(`Cierre automático: ${aJuego} en juego, ${aPronto} cierran pronto.`);
});

/* ============================================================
   Cancelar un partido
   Devuelve su apuesta a cada participante y marca el partido
   como cancelado. Idempotente: no devuelve dos veces.
   ============================================================ */
export const cancelarPartido = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) {
        throw new HttpsError('permission-denied', 'Solo un administrador puede cancelar.');
    }

    const partidoId = String(req.data?.partidoId ?? '');
    if (!partidoId) {
        throw new HttpsError('invalid-argument', 'Falta el partido.');
    }

    const partRef = db.doc(`partidos/${partidoId}`);
    const partSnap = await partRef.get();
    if (!partSnap.exists) {
        throw new HttpsError('not-found', 'El partido no existe.');
    }
    const partido = partSnap.data() as Record<string, unknown>;

    if (partido['liquidado'] === true) {
        throw new HttpsError('failed-precondition', 'Este partido ya fue liquidado.');
    }
    if (partido['status'] === 'cancelado') {
        throw new HttpsError('failed-precondition', 'Este partido ya está cancelado.');
    }

    const pronSnap = await db
        .collection('pronosticos')
        .where('partidoId', '==', partidoId)
        .where('estado', '==', 'activo')
        .get();

    const pronosticos = pronSnap.docs.map((d) => ({
        ref: d.ref,
        ...(d.data() as PronosticoDoc),
    }));

    let devuelto = 0;
    const ops: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

    for (const p of pronosticos) {
        devuelto += p.apuesta ?? 0;
        ops.push((batch) => {
            batch.update(p.ref, { estado: 'devuelto', premio: p.apuesta });
            batch.set(
                db.doc(`users/${p.uid}`),
                {
                    puntos: FieldValue.increment(p.apuesta),
                    puntosHistoricos: FieldValue.increment(p.apuesta),
                },
                { merge: true },
            );
            batch.set(db.collection('ledger').doc(), {
                uid: p.uid,
                tipo: 'devolucion-cancelacion',
                monto: p.apuesta,
                partidoId,
                createdAt: FieldValue.serverTimestamp(),
            });
        });
    }

    for (let i = 0; i < ops.length; i += PRONOSTICOS_POR_LOTE) {
        const batch = db.batch();
        for (const op of ops.slice(i, i + PRONOSTICOS_POR_LOTE)) {
            op(batch);
        }
        await batch.commit();
    }

    // Recalcular bloqueos de los afectados
    const uids = [...new Set(pronosticos.map((p) => p.uid))];
    for (let i = 0; i < uids.length; i += 100) {
        const refs = uids.slice(i, i + 100).map((u) => db.doc(`users/${u}`));
        if (refs.length === 0) continue;
        const snaps = await db.getAll(...refs);
        const batch = db.batch();
        for (const sn of snaps) {
            if (!sn.exists) continue;
            const puntos = Number(sn.data()?.['puntos'] ?? 0);
            batch.update(sn.ref, { bloqueado: puntos - APUESTA_BASE < TOPE_INFERIOR });
        }
        await batch.commit();
    }

    await actualizarRanking(uids);
    await db.doc(`bolsas/${partidoId}`).delete().catch(() => undefined);

    await partRef.update({
        status: 'cancelado',
        poolTotal: 0,
        canceladoAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, devoluciones: pronosticos.length, puntosDevueltos: devuelto };
});

/* Regenera todo el ranking de una vez (útil la primera vez). */
export const recalcularRanking = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) {
        throw new HttpsError('permission-denied', 'Solo un administrador.');
    }

    const users = await db.collection('users').get();
    let escritos = 0;
    const batch = db.batch();

    users.docs.forEach((d) => {
        const u = d.data();
        // Mismo criterio que actualizarRanking: fuera los no validados
        // y las cuentas de puro administrador que no compiten.
        if (u['validada'] !== true || u['noParticipa'] === true) {
            batch.delete(db.doc(`ranking/${d.id}`));
            return;
        }
        const resueltos = Number(u['resueltos'] ?? 0);
        const aciertos = Number(u['aciertos'] ?? 0);
        const email = String(u['email'] ?? '');
        batch.set(db.doc(`ranking/${d.id}`), {
            alias: String(u['alias'] ?? '').trim() || email.split('@')[0] || 'jugador',
            puntos: Number(u['puntosHistoricos'] ?? u['puntos'] ?? 0),
            saldo: Number(u['puntos'] ?? 0),
            torneosGanados: Number(u['torneosGanados'] ?? 0),
            aciertos,
            resueltos,
            porcentaje: resueltos > 0 ? Math.round((aciertos / resueltos) * 100) : 0,
            calificado: resueltos >= MIN_RESUELTOS,
            racha: Number(u['racha'] ?? 0),
            mejorRacha: Number(u['mejorRacha'] ?? 0),
            actualizado: FieldValue.serverTimestamp(),
        });
        escritos++;
    });

    await batch.commit();
    return { ok: true, jugadores: escritos };
});


/* ============================================================
   Recalcular bolsas
   Reconstruye los totales de cada partido sumando los
   pronósticos reales. Corrige cualquier dato desalineado.
   ============================================================ */
export const recalcularBolsas = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) {
        throw new HttpsError('permission-denied', 'Solo un administrador.');
    }

    // Todos los pronósticos activos, agrupados por partido.
    const pron = await db.collection('pronosticos').where('estado', '==', 'activo').get();

    const acumulado = new Map<
        string,
        { total: number; porResultado: Record<string, number>; conteos: Record<string, number> }
    >();

    pron.docs.forEach((d) => {
        const p = d.data() as PronosticoDoc & { partidoId: string };
        const partidoId = String(p.partidoId ?? '');
        if (!partidoId) return;

        const actual =
            acumulado.get(partidoId) ?? { total: 0, porResultado: {}, conteos: {} };
        const apuesta = Number(p.apuesta ?? 0);
        const r = String(p.resultado ?? '');

        actual.total += apuesta;
        actual.porResultado[r] = (actual.porResultado[r] ?? 0) + apuesta;
        actual.conteos[r] = (actual.conteos[r] ?? 0) + 1;
        acumulado.set(partidoId, actual);
    });

    // Borra las bolsas de partidos sin pronósticos activos.
    const existentes = await db.collection('bolsas').get();
    const batch = db.batch();

    existentes.docs.forEach((d) => {
        if (!acumulado.has(d.id)) batch.delete(d.ref);
    });

    acumulado.forEach((v, partidoId) => {
        batch.set(db.doc(`bolsas/${partidoId}`), {
            partidoId,
            total: v.total,
            porResultado: v.porResultado,
            conteos: v.conteos,
            actualizado: FieldValue.serverTimestamp(),
        });
    });

    await batch.commit();

    return { ok: true, partidos: acumulado.size };
});


/* ============================================================
   Buscar partidos en API-Football
   El admin elige liga y fecha, y crea el partido con un clic.
   ============================================================ */
export const buscarFixtures = onCall({ ...opcionesCall, secrets: [footballDataKey] }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) throw new HttpsError('permission-denied', 'Solo un administrador.');

    const competicion = String(req.data?.competicion ?? '');
    const desde = String(req.data?.desde ?? '');
    const hasta = String(req.data?.hasta ?? desde);
    if (!competicion || !desde) {
        throw new HttpsError('invalid-argument', 'Faltan la competición o la fecha.');
    }

    const partidos = await consultarApi(
        `competitions/${competicion}/matches?dateFrom=${desde}&dateTo=${hasta}`,
        footballDataKey.value(),
    );

    // Solo los que aún no empiezan.
    const proximos = partidos.filter((p) => ['SCHEDULED', 'TIMED'].includes(p.status));

    return {
        ok: true,
        partidos: proximos.map((p) => ({
            apiFixtureId: p.id,
            fecha: p.utcDate,
            homeTeam: p.homeTeam.shortName || p.homeTeam.name,
            awayTeam: p.awayTeam.shortName || p.awayTeam.name,
            competition: p.competition?.name ?? competicion,
        })),
    };
});

/* ============================================================
   Revisar resultados en la API
   Solo consulta si hay partidos en juego y ya pasó el tiempo
   razonable de duración. Precarga el resultado para que el
   administrador lo confirme.
   ============================================================ */
export const revisarResultados = onSchedule(
    { schedule: 'every 15 minutes', secrets: [footballDataKey] },
    async () => {
        const snap = await db.collection('partidos').where('status', '==', 'en-juego').get();
        if (snap.empty) {
            console.log('Sin partidos en juego: no se consulta la API.');
            return;
        }

        const ahora = Date.now();
        const candidatos = snap.docs.filter((d) => {
            const p = d.data();
            if (p['liquidado'] === true) return false;
            if (p['resultadoPropuesto']) return false;
            if (!p['apiFixtureId']) return false;
            const cierre = p['closesAt'] as Timestamp | undefined;
            if (!cierre) return false;
            return ahora >= cierre.toMillis() + MINUTOS_ANTES_DE_CONSULTAR * 60 * 1000;
        });

        if (candidatos.length === 0) {
            console.log('Ningún partido cumple aún el tiempo mínimo.');
            return;
        }

        const ids = candidatos.map((d) => String(d.data()['apiFixtureId'])).join(',');
        const partidos = await consultarApi(`matches?ids=${ids}`, footballDataKey.value());
        const porId = new Map(partidos.map((p) => [String(p.id), p]));

        const problemas = ['POSTPONED', 'SUSPENDED', 'CANCELLED', 'AWARDED'];

        for (const d of candidatos) {
            const p = d.data();
            const api = porId.get(String(p['apiFixtureId']));
            if (!api) continue;

            if (problemas.includes(api.status)) {
                await d.ref.update({
                    alertaApi: `El partido aparece como "${api.status}" en la API. Revísalo manualmente.`,
                });
                continue;
            }
            if (api.status !== 'FINISHED') continue;

            const local = Number(api.score.fullTime.home ?? 0);
            const visitante = Number(api.score.fullTime.away ?? 0);
            const tipo = String(p['type'] ?? '1x2');

            let resultado: string;
            if (tipo === 'quien-pasa') {
                resultado = local >= visitante ? 'pasa-local' : 'pasa-visitante';
            } else if (local > visitante) {
                resultado = 'local';
            } else if (visitante > local) {
                resultado = 'visitante';
            } else {
                resultado = tipo === '1x2' ? 'empate' : '';
            }

            if (!resultado) {
                await d.ref.update({
                    alertaApi: 'Terminó en empate y este partido no admite empate. Revísalo.',
                });
                continue;
            }

            await d.ref.update({
                resultadoPropuesto: resultado,
                marcadorPropuesto: `${local}-${visitante}`,
                propuestoAt: FieldValue.serverTimestamp(),
                alertaApi: FieldValue.delete(),
            });

            console.log(`Resultado precargado para ${d.id}: ${local}-${visitante} → ${resultado}`);
        }
    },
);


/* ============================================================
   Eliminar usuarios sin validar
   Borra la cuenta de Authentication y sus documentos.
   Por seguridad, solo permite borrar cuentas NO validadas
   y nunca a un administrador.
   ============================================================ */
export const eliminarUsuarios = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) throw new HttpsError('permission-denied', 'Solo un administrador.');

    const uids: string[] = Array.isArray(req.data?.uids) ? req.data.uids : [];
    if (uids.length === 0) {
        throw new HttpsError('invalid-argument', 'No se indicó ningún usuario.');
    }

    let borrados = 0;
    const omitidos: string[] = [];

    for (const destino of uids) {
        if (destino === uid) {
            omitidos.push('tu propia cuenta');
            continue;
        }

        const esAdmin = await db.doc(`admins/${destino}`).get();
        if (esAdmin.exists) {
            omitidos.push('una cuenta de administrador');
            continue;
        }

        const userSnap = await db.doc(`users/${destino}`).get();
        if (userSnap.exists && userSnap.data()?.['validada'] === true) {
            omitidos.push(String(userSnap.data()?.['alias'] ?? destino));
            continue;
        }

        // Documentos primero, luego la cuenta de acceso.
        const batch = db.batch();
        batch.delete(db.doc(`users/${destino}`));
        batch.delete(db.doc(`ranking/${destino}`));
        await batch.commit();

        await getAuth()
            .deleteUser(destino)
            .catch((e) => console.warn(`No se pudo borrar en Auth ${destino}:`, e));

        borrados++;
    }

    return { ok: true, borrados, omitidos };
});

/**
 * Deja constancia de un torneo ganado: un trofeo por persona y
 * el contador en su perfil. Se llama al cerrar cualquier torneo.
 */
async function registrarTrofeos(
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

/* ============================================================
   MODO SUPERVIVENCIA
   Torneos por invitación. Cada jornada eliges un equipo:
   si pierde, gastas una vida; si te quedas sin vidas, fuera.
   El empate salva y no se puede repetir equipo.
   ============================================================ */

interface JornadaDoc {
    numero: number;
    cierraAt?: Timestamp;
    estado: string;
    partidos: Array<{ local: string; visitante: string; resultado?: string | null }>;
}

/** Unirse a un torneo con el código de invitación. */
export const unirseTorneo = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const codigo = String(req.data?.codigo ?? '').trim().toUpperCase();
    if (!codigo) throw new HttpsError('invalid-argument', 'Falta el código.');

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'No encontramos tu perfil.');
    const u = userSnap.data() as Record<string, unknown>;
    if (u['validada'] !== true) {
        throw new HttpsError('permission-denied', 'Tu cuenta aún no ha sido validada.');
    }

    const encontrados = await db
        .collection('torneos')
        .where('codigo', '==', codigo)
        .limit(1)
        .get();
    if (encontrados.empty) {
        throw new HttpsError('not-found', 'Ese código de invitación no existe.');
    }

    const torneo = encontrados.docs[0];
    const t = torneo.data() as Record<string, unknown>;
    if (t['estado'] !== 'inscripcion') {
        throw new HttpsError('failed-precondition', 'Este torneo ya cerró inscripciones.');
    }

    const cierre = t['cierreInscripcion'] as Timestamp | undefined;
    if (cierre && cierre.toMillis() <= Date.now()) {
        throw new HttpsError('failed-precondition', 'El plazo para inscribirse ya terminó.');
    }

    const partRef = torneo.ref.collection('participantes').doc(uid);
    if ((await partRef.get()).exists) {
        return { ok: true, torneoId: torneo.id, yaEstaba: true, costo: 0 };
    }

    if (u['bloqueado'] === true) {
        throw new HttpsError('failed-precondition', 'Tu cuenta está bloqueada.');
    }

    const email = String(u['email'] ?? '');
    const alias = String(u['alias'] ?? '').trim() || email.split('@')[0] || 'jugador';
    const costo = Number(t['costoEntrada'] ?? 0);

    // Cobro e inscripción en una sola transacción: o pasa todo, o no pasa nada.
    await db.runTransaction(async (tx) => {
        const userRef = db.doc(`users/${uid}`);
        const fresco = await tx.get(userRef);
        const saldo = Number(fresco.data()?.['puntos'] ?? 0);

        if (costo > 0) {
            if (saldo - costo < TOPE_INFERIOR) {
                throw new HttpsError(
                    'failed-precondition',
                    `No te alcanza: la entrada cuesta ${costo} y tu saldo es ${saldo}.`,
                );
            }
            tx.update(userRef, {
                puntos: saldo - costo,
                puntosHistoricos: FieldValue.increment(-costo),
                bloqueado: saldo - costo - APUESTA_BASE < TOPE_INFERIOR,
            });
            tx.update(torneo.ref, { bolsa: FieldValue.increment(costo) });
            tx.set(db.collection('ledger').doc(), {
                uid,
                tipo: 'torneo-entrada',
                monto: -costo,
                torneoId: torneo.id,
                detalle: String(t['nombre'] ?? 'Torneo'),
                createdAt: FieldValue.serverTimestamp(),
            });
        }

        // Deja el torneo apuntado en el perfil: así el jugador solo ve los suyos.
        tx.set(userRef, { torneos: FieldValue.arrayUnion(torneo.id) }, { merge: true });

        tx.set(partRef, {
            uid,
            alias,
            puntosTorneo: 0,
            exactos: 0,
            vivo: true,
            // Las vidas las define el torneo al crearse (una por omisión).
            vidasRestantes: Number(t['vidas'] ?? 1),
            equiposUsados: [],
            pago: costo,
            createdAt: FieldValue.serverTimestamp(),
        });
    });

    // El cobro cambió los puntos históricos: hay que refrescar su fila.
    if (costo > 0) await actualizarRanking([uid]);

    return { ok: true, torneoId: torneo.id, yaEstaba: false, costo };
});

/** Busca una jornada de la competición por su número. */
async function jornadaDeCompeticion(
    competicionId: string,
    numero: number,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
    const snap = await db
        .collection(`competiciones/${competicionId}/jornadas`)
        .where('numero', '==', numero)
        .limit(1)
        .get();
    return snap.empty ? null : snap.docs[0];
}

/** Guardar el equipo elegido para la jornada en curso. */
export const guardarPick = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const torneoId = String(req.data?.torneoId ?? '');
    const equipo = String(req.data?.equipo ?? '').trim();
    if (!torneoId || !equipo) throw new HttpsError('invalid-argument', 'Faltan datos.');

    const torneoRef = db.doc(`torneos/${torneoId}`);
    const torneoSnap = await torneoRef.get();
    if (!torneoSnap.exists) throw new HttpsError('not-found', 'El torneo no existe.');
    const t = torneoSnap.data() as Record<string, unknown>;
    if (t['estado'] !== 'en-curso') {
        throw new HttpsError('failed-precondition', 'El torneo no está en curso.');
    }

    const numero = Number(t['jornadaActual'] ?? 1);
    const competicionId = String(t['competicionId'] ?? '');
    const jornadaDoc = await jornadaDeCompeticion(competicionId, numero);
    if (!jornadaDoc) {
        throw new HttpsError('not-found', `La competición aún no tiene la jornada ${numero}.`);
    }

    const j = jornadaDoc.data() as JornadaDoc;
    if (j.estado !== 'abierta') {
        throw new HttpsError('failed-precondition', 'Esta jornada ya está cerrada.');
    }
    if (j.cierraAt && j.cierraAt.toMillis() <= Date.now()) {
        throw new HttpsError('failed-precondition', 'El tiempo para elegir ya terminó.');
    }

    const juega = j.partidos.some((p) => p.local === equipo || p.visitante === equipo);
    if (!juega) {
        throw new HttpsError('invalid-argument', 'Ese equipo no juega en esta jornada.');
    }

    const partRef = torneoRef.collection('participantes').doc(uid);
    const partSnap = await partRef.get();
    if (!partSnap.exists) throw new HttpsError('permission-denied', 'No estás inscrito.');
    const p = partSnap.data() as Record<string, unknown>;
    if (p['vivo'] !== true) throw new HttpsError('failed-precondition', 'Ya estás eliminado.');

    const usados = (p['equiposUsados'] as string[]) ?? [];
    if (usados.includes(equipo)) {
        throw new HttpsError('failed-precondition', 'Ya usaste ese equipo en este torneo.');
    }

    await torneoRef.collection('picks').doc(`${uid}_${numero}`).set({
        uid,
        alias: String(p['alias'] ?? 'jugador'),
        jornada: numero,
        equipo,
        estado: 'pendiente',
        createdAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, equipo, jornada: numero };
});

/* ============================================================
   Resolver una jornada de la competición
   Un solo resultado oficial que se aplica a TODOS los torneos
   que estén jugando esa jornada. Evita que dos torneos de la
   misma liga terminen con marcadores distintos.
   ============================================================ */
export const resolverJornadaCompeticion = onCall(
    { ...opcionesCall, secrets: [telegramToken] },
    async (req) => {
        const uid = req.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

        const competicionId = String(req.data?.competicionId ?? '');
        const jornadaId = String(req.data?.jornadaId ?? '');
        if (!competicionId || !jornadaId) throw new HttpsError('invalid-argument', 'Faltan datos.');

        const compRef = db.doc(`competiciones/${competicionId}`);
        const jornadaRef = compRef.collection('jornadas').doc(jornadaId);

        const [adminSnap, compSnap, jornadaSnap] = await Promise.all([
            db.doc(`admins/${uid}`).get(),
            compRef.get(),
            jornadaRef.get(),
        ]);
        if (!compSnap.exists || !jornadaSnap.exists) {
            throw new HttpsError('not-found', 'Competición o jornada inexistente.');
        }

        const gestores = (compSnap.data()?.['gestores'] as string[]) ?? [];
        if (!adminSnap.exists && !gestores.includes(uid)) {
            throw new HttpsError('permission-denied', 'No gestionas esta competición.');
        }

        const j = jornadaSnap.data() as JornadaDoc;
        if (j.estado === 'resuelta') {
            throw new HttpsError('failed-precondition', 'Esta jornada ya fue resuelta.');
        }
        if (j.partidos.some((p) => !p.resultado)) {
            throw new HttpsError('failed-precondition', 'Faltan resultados por capturar.');
        }

        /** Suerte del equipo elegido según el marcador oficial. */
        const suerte = (equipo: string): 'gana' | 'empata' | 'pierde' | 'pospuesto' | null => {
            const p = j.partidos.find((x) => x.local === equipo || x.visitante === equipo);
            if (!p) return null;
            // Partido aplazado o anulado: no cuenta ni a favor ni en contra.
            if (p.resultado === 'pospuesto') return 'pospuesto';
            if (p.resultado === 'empate') return 'empata';
            const gano = p.resultado === 'local' ? p.local : p.visitante;
            return gano === equipo ? 'gana' : 'pierde';
        };

        // Todos los torneos de esta competición parados en esta jornada.
        const torneos = await db
            .collection('torneos')
            .where('competicionId', '==', competicionId)
            .where('estado', '==', 'en-curso')
            .get();

        const afectados = torneos.docs.filter(
            (d) => Number(d.data()['jornadaActual'] ?? 0) === j.numero,
        );

        let totalSobreviven = 0;
        let totalEliminados = 0;
        let totalPendientes = 0;
        let calificadas = 0;
        const cerrados: string[] = [];
        /** Quienes cobraron premio: hay que refrescar su fila del ranking. */
        const premiados: string[] = [];

        for (const torneoDoc of afectados) {
            const torneoRef = torneoDoc.ref;
            const torneo = torneoDoc.data() as Record<string, unknown>;

            // Quiniela por puntos: se califica y se avanza, sin eliminar a nadie.
            if (torneo['modo'] === 'quiniela') {
                const r = await calificarQuinielas(torneoRef, j);
                calificadas += r.calificadas;

                // Resumen con los tres primeros de la tabla.
                const tabla = await torneoRef
                    .collection('participantes')
                    .orderBy('puntosTorneo', 'desc')
                    .limit(3)
                    .get();
                const podio = tabla.docs
                    .map((d, i) => `${i + 1}. ${d.data()['alias']} — ${d.data()['puntosTorneo'] ?? 0} pts`)
                    .join('\n');
                const todos = await torneoRef.collection('participantes').get();

                await avisar(
                    todos.docs.map((d) => d.id),
                    `<b>${String(torneo['nombre'] ?? 'Torneo')}</b>\n` +
                    `Jornada ${j.numero} calificada.\n\n${podio}\n\n` +
                    'Ya puedes ver los cartones de todos en la app.',
                );

                const ultima = Number(torneo['jornadas'] ?? 0);
                const esFinal = ultima > 0 && j.numero >= Number(torneo['jornadaInicial'] ?? 1) + ultima - 1;

                if (esFinal) {
                    const cierre = await cerrarQuiniela(torneoRef, torneoDoc.id, torneo);
                    if (cierre) {
                        cerrados.push(cierre.nombre);
                        premiados.push(...cierre.uids);
                    }
                } else {
                    await torneoRef.update({ jornadaActual: j.numero + 1 });
                }
                continue;
            }

            const participantes = await torneoRef
                .collection('participantes')
                .where('vivo', '==', true)
                .get();
            const picks = await torneoRef.collection('picks').where('jornada', '==', j.numero).get();
            const pickPorUid = new Map(picks.docs.map((d) => [String(d.data()['uid']), d]));

            const batch = db.batch();
            /* A quien cae le llega un aviso propio; el genérico ya no le sirve. */
            const caidos: Array<{ uid: string; equipo: string; motivo: string }> = [];

            for (const part of participantes.docs) {
                const datos = part.data() as Record<string, unknown>;
                const pick = pickPorUid.get(part.id);
                const usados = (datos['equiposUsados'] as string[]) ?? [];
                const equipo = pick ? String(pick.data()['equipo']) : '';
                let vidas = Number(datos['vidasRestantes'] ?? 0);

                // Qué salva una vida en este torneo: 'empate' (por omisión, como
                // siempre) o 'tropiezo' (también cubre derrotas).
                const cubre = String(torneo['vidaCubre'] ?? 'empate');

                // Sin elección se considera derrota.
                const resultado = pick ? suerte(equipo) : 'pierde';

                // El equipo se marca como usado aunque el partido se aplace:
                // el jugador ya se comprometió con él.
                const nuevosUsados = equipo && !usados.includes(equipo) ? [...usados, equipo] : usados;

                if (resultado === 'pospuesto') {
                    // Queda en espera: ni avanza ni sale hasta que se juegue el partido.
                    totalPendientes++;
                    batch.update(part.ref, { equiposUsados: nuevosUsados });
                } else if (resultado === 'gana') {
                    // Victoria: pasa intacto.
                    totalSobreviven++;
                    batch.update(part.ref, { equiposUsados: nuevosUsados });
                    if (pick) batch.update(pick.ref, { estado: 'sobrevive' });
                } else if (vidas > 0 && (resultado === 'empata' || cubre === 'tropiezo')) {
                    // Tropezó (empate, o derrota si las vidas cubren todo), pero
                    // le quedaba vida: sigue con una menos.
                    vidas -= 1;
                    totalSobreviven++;
                    batch.update(part.ref, { vidasRestantes: vidas, equiposUsados: nuevosUsados });
                    if (pick) batch.update(pick.ref, { estado: 'sobrevive' });
                } else {
                    // Fuera del torneo: perdió sin vida que lo cubra, o empató sin vida.
                    totalEliminados++;
                    batch.update(part.ref, {
                        vivo: false,
                        eliminadoEn: j.numero,
                        equiposUsados: nuevosUsados,
                    });
                    if (pick) batch.update(pick.ref, { estado: 'eliminado' });

                    caidos.push({
                        uid: part.id,
                        equipo,
                        motivo: !pick ? 'sin-elegir' : resultado === 'empata' ? 'empate' : 'derrota',
                    });
                }
            }

            await batch.commit();

            // ¿Cómo quedó este torneo?
            const vivos = await torneoRef.collection('participantes').where('vivo', '==', true).get();

            // Aviso personal a quien quedó fuera. Es el último que recibe de este torneo.
            for (const c of caidos) {
                const razon =
                    c.motivo === 'sin-elegir'
                        ? 'No elegiste equipo en esta jornada.'
                        : c.motivo === 'empate'
                            ? `${c.equipo} empató y ya no te quedaba vida.`
                            : `${c.equipo} perdió.`;

                await avisar(
                    [c.uid],
                    `😔 <b>${String(torneo['nombre'] ?? 'Torneo')}</b>\n` +
                    `Quedaste fuera en la jornada ${j.numero}. ${razon}\n\n` +
                    `Siguen ${vivos.size} en pie. Puedes ver cómo termina en la app.`,
                );
            }
            const bolsa = Number(torneo['bolsa'] ?? 0);
            const nombreTorneo = String(torneo['nombre'] ?? 'Torneo');
            const competicion = String(torneo['competicionNombre'] ?? '');

            const pagar = async (ganadores: Array<{ uid: string; alias: string }>) => {
                if (bolsa <= 0 || ganadores.length === 0) return 0;
                const porCabeza = Math.floor(bolsa / ganadores.length);
                const sobrante = bolsa - porCabeza * ganadores.length;

                const pagos = db.batch();
                for (const g of ganadores) {
                    pagos.set(
                        db.doc(`users/${g.uid}`),
                        {
                            puntos: FieldValue.increment(porCabeza),
                            puntosHistoricos: FieldValue.increment(porCabeza),
                        },
                        { merge: true },
                    );
                    pagos.set(db.collection('ledger').doc(), {
                        uid: g.uid,
                        tipo: 'torneo-premio',
                        monto: porCabeza,
                        torneoId: torneoDoc.id,
                        detalle: nombreTorneo,
                        createdAt: FieldValue.serverTimestamp(),
                    });
                }
                if (sobrante > 0) {
                    pagos.set(
                        db.doc('sistema/reserva'),
                        { total: FieldValue.increment(sobrante) },
                        { merge: true },
                    );
                }
                await pagos.commit();
                return porCabeza;
            };

            // Con elecciones en espera no se puede declarar ganador todavía.
            const enEspera = await torneoRef
                .collection('picks')
                .where('estado', '==', 'pendiente')
                .limit(1)
                .get();

            if ((vivos.size === 1 || vivos.size === 0) && enEspera.empty) {
                let lista: Array<{ uid: string; alias: string }>;

                if (vivos.size === 1) {
                    lista = [
                        { uid: vivos.docs[0].id, alias: String(vivos.docs[0].data()['alias'] ?? 'jugador') },
                    ];
                } else {
                    const finalistas = await torneoRef
                        .collection('participantes')
                        .where('eliminadoEn', '==', j.numero)
                        .get();
                    lista = finalistas.docs.map((d) => ({
                        uid: d.id,
                        alias: String(d.data()['alias'] ?? 'jugador'),
                    }));
                }

                const premio = await pagar(lista);
                premiados.push(...lista.map((g) => g.uid));
                await registrarTrofeos(
                    lista,
                    torneoDoc.id,
                    nombreTorneo,
                    competicion,
                    premio,
                    lista.length > 1,
                );
                await torneoRef.update({
                    estado: 'finalizado',
                    ganadorAlias: lista.map((g) => g.alias).join(', ') || 'Sin sobrevivientes',
                    premioPagado: premio,
                    bolsa: 0,
                });
                cerrados.push(nombreTorneo);

                // Solo a quienes llegaron al final: los eliminados ya se despidieron.
                await avisar(
                    [...new Set([...vivos.docs.map((d) => d.id), ...lista.map((g) => g.uid)])],
                    `<b>${nombreTorneo}</b>\n` +
                    `¡Terminó el torneo! Ganó ${lista.map((g) => g.alias).join(', ')}.` +
                    (premio > 0 ? `\nPremio: ${premio} pts por cabeza.` : ''),
                );
            } else {
                await torneoRef.update({ jornadaActual: j.numero + 1 });

                const sobreviven = vivos.size;
                await avisar(
                    vivos.docs.map((d) => d.id),
                    `<b>${nombreTorneo}</b>\n` +
                    `Jornada ${j.numero} resuelta. Quedan ${sobreviven} en pie.\n` +
                    `Ya puedes elegir tu equipo para la jornada ${j.numero + 1}.`,
                );
            }
        }

        await jornadaRef.update({ estado: 'resuelta' });
        if (premiados.length > 0) await actualizarRanking(premiados);

        return {
            ok: true,
            torneos: afectados.length,
            sobreviven: totalSobreviven,
            eliminados: totalEliminados,
            pendientes: totalPendientes,
            calificadas,
            cerrados,
        };
    });

/* ============================================================
   Cerrar un torneo aunque queden varios vivos
   Útil cuando se acaban las jornadas disponibles: los que
   siguen en pie comparten la bolsa en partes iguales.
   ============================================================ */
export const finalizarTorneo = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const torneoId = String(req.data?.torneoId ?? '');
    if (!torneoId) throw new HttpsError('invalid-argument', 'Falta el torneo.');

    const torneoRef = db.doc(`torneos/${torneoId}`);
    const [adminSnap, torneoSnap] = await Promise.all([
        db.doc(`admins/${uid}`).get(),
        torneoRef.get(),
    ]);
    if (!torneoSnap.exists) throw new HttpsError('not-found', 'El torneo no existe.');

    const t = torneoSnap.data() as Record<string, unknown>;
    const gestores = (t['gestores'] as string[]) ?? [];
    if (!adminSnap.exists && !gestores.includes(uid)) {
        throw new HttpsError('permission-denied', 'No tienes permiso sobre este torneo.');
    }
    if (t['estado'] === 'finalizado') {
        throw new HttpsError('failed-precondition', 'Este torneo ya está cerrado.');
    }

    // En quiniela gana quien más puntos lleve, no quien sobreviva.
    if (t['modo'] === 'quiniela') {
        const cierre = await cerrarQuiniela(torneoRef, torneoId, t);
        if (!cierre) throw new HttpsError('failed-precondition', 'El torneo no tiene participantes.');
        await actualizarRanking(cierre.uids);
        return { ok: true, ganadores: cierre.uids.length, premioPorCabeza: Number(t['bolsa'] ?? 0) };
    }

    const vivos = await torneoRef.collection('participantes').where('vivo', '==', true).get();
    if (vivos.empty) {
        throw new HttpsError('failed-precondition', 'No queda nadie vivo en este torneo.');
    }

    const bolsa = Number(t['bolsa'] ?? 0);
    const nombreTorneo = String(t['nombre'] ?? 'Torneo');
    const ganadores = vivos.docs.map((d) => ({
        uid: d.id,
        alias: String(d.data()['alias'] ?? 'jugador'),
    }));

    let porCabeza = 0;
    if (bolsa > 0) {
        porCabeza = Math.floor(bolsa / ganadores.length);
        const sobrante = bolsa - porCabeza * ganadores.length;

        const pagos = db.batch();
        for (const g of ganadores) {
            pagos.set(
                db.doc(`users/${g.uid}`),
                {
                    puntos: FieldValue.increment(porCabeza),
                    puntosHistoricos: FieldValue.increment(porCabeza),
                },
                { merge: true },
            );
            pagos.set(db.collection('ledger').doc(), {
                uid: g.uid,
                tipo: 'torneo-premio',
                monto: porCabeza,
                torneoId,
                detalle: `${nombreTorneo} (cierre compartido)`,
                createdAt: FieldValue.serverTimestamp(),
            });
        }
        if (sobrante > 0) {
            pagos.set(db.doc('sistema/reserva'), { total: FieldValue.increment(sobrante) }, { merge: true });
        }
        await pagos.commit();
        await actualizarRanking(ganadores.map((g) => g.uid));
    }

    await registrarTrofeos(
        ganadores,
        torneoId,
        nombreTorneo,
        String(t['competicionNombre'] ?? ''),
        porCabeza,
        ganadores.length > 1,
    );

    await torneoRef.update({
        estado: 'finalizado',
        ganadorAlias: ganadores.map((g) => g.alias).join(', '),
        premioPagado: porCabeza,
        bolsa: 0,
    });

    return { ok: true, ganadores: ganadores.length, premioPorCabeza: porCabeza };
});

/* ============================================================
   Resolver elecciones que quedaron en espera
   Se usa cuando un partido aplazado por fin se juega: se captura
   su resultado y aquí se define la suerte de quienes lo eligieron.
   ============================================================ */
export const resolverPendientes = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const competicionId = String(req.data?.competicionId ?? '');
    const jornadaId = String(req.data?.jornadaId ?? '');
    if (!competicionId || !jornadaId) throw new HttpsError('invalid-argument', 'Faltan datos.');

    const compRef = db.doc(`competiciones/${competicionId}`);
    const jornadaRef = compRef.collection('jornadas').doc(jornadaId);

    const [adminSnap, compSnap, jornadaSnap] = await Promise.all([
        db.doc(`admins/${uid}`).get(),
        compRef.get(),
        jornadaRef.get(),
    ]);
    if (!compSnap.exists || !jornadaSnap.exists) {
        throw new HttpsError('not-found', 'Competición o jornada inexistente.');
    }
    const gestores = (compSnap.data()?.['gestores'] as string[]) ?? [];
    if (!adminSnap.exists && !gestores.includes(uid)) {
        throw new HttpsError('permission-denied', 'No gestionas esta competición.');
    }

    const j = jornadaSnap.data() as JornadaDoc;
    if (j.partidos.some((p) => p.resultado === 'pospuesto')) {
        throw new HttpsError(
            'failed-precondition',
            'Todavía hay partidos marcados como aplazados. Captura su resultado real primero.',
        );
    }

    const suerte = (equipo: string): 'gana' | 'empata' | 'pierde' | null => {
        const p = j.partidos.find((x) => x.local === equipo || x.visitante === equipo);
        if (!p || !p.resultado) return null;
        if (p.resultado === 'empate') return 'empata';
        const gano = p.resultado === 'local' ? p.local : p.visitante;
        return gano === equipo ? 'gana' : 'pierde';
    };

    const torneos = await db
        .collection('torneos')
        .where('competicionId', '==', competicionId)
        .get();

    let resueltos = 0;
    let eliminados = 0;
    const cerrados: string[] = [];

    for (const torneoDoc of torneos.docs) {
        const torneoRef = torneoDoc.ref;
        const torneo = torneoDoc.data() as Record<string, unknown>;

        const pendientes = await torneoRef
            .collection('picks')
            .where('jornada', '==', j.numero)
            .where('estado', '==', 'pendiente')
            .get();
        if (pendientes.empty) continue;

        const batch = db.batch();

        for (const pick of pendientes.docs) {
            const equipo = String(pick.data()['equipo']);
            const partRef = torneoRef.collection('participantes').doc(String(pick.data()['uid']));
            const partSnap = await partRef.get();
            if (!partSnap.exists) continue;

            const datos = partSnap.data() as Record<string, unknown>;
            const resultado = suerte(equipo);
            let vidas = Number(datos['vidasRestantes'] ?? 0);
            resueltos++;

            // Si ya estaba eliminado por otra jornada, solo se cierra la elección.
            if (datos['vivo'] !== true) {
                batch.update(pick.ref, { estado: 'eliminado' });
                continue;
            }

            if (resultado === 'gana') {
                batch.update(pick.ref, { estado: 'sobrevive' });
            } else if (resultado === 'empata' && vidas > 0) {
                vidas -= 1;
                batch.update(partRef, { vidasRestantes: vidas });
                batch.update(pick.ref, { estado: 'sobrevive' });
            } else {
                eliminados++;
                batch.update(partRef, { vivo: false, eliminadoEn: j.numero });
                batch.update(pick.ref, { estado: 'eliminado' });
            }
        }

        await batch.commit();

        // ¿El torneo ya tiene desenlace?
        const [vivos, quedanPendientes] = await Promise.all([
            torneoRef.collection('participantes').where('vivo', '==', true).get(),
            torneoRef.collection('picks').where('estado', '==', 'pendiente').limit(1).get(),
        ]);

        if (torneo['estado'] !== 'en-curso' || !quedanPendientes.empty) continue;
        if (vivos.size > 1) continue;

        const bolsa = Number(torneo['bolsa'] ?? 0);
        const nombreTorneo = String(torneo['nombre'] ?? 'Torneo');
        const lista =
            vivos.size === 1
                ? [{ uid: vivos.docs[0].id, alias: String(vivos.docs[0].data()['alias'] ?? 'jugador') }]
                : (
                    await torneoRef
                        .collection('participantes')
                        .where('eliminadoEn', '==', j.numero)
                        .get()
                ).docs.map((d) => ({ uid: d.id, alias: String(d.data()['alias'] ?? 'jugador') }));

        let porCabeza = 0;
        if (bolsa > 0 && lista.length > 0) {
            porCabeza = Math.floor(bolsa / lista.length);
            const sobrante = bolsa - porCabeza * lista.length;
            const pagos = db.batch();
            for (const g of lista) {
                pagos.set(
                    db.doc(`users/${g.uid}`),
                    {
                        puntos: FieldValue.increment(porCabeza),
                        puntosHistoricos: FieldValue.increment(porCabeza),
                    },
                    { merge: true },
                );
                pagos.set(db.collection('ledger').doc(), {
                    uid: g.uid,
                    tipo: 'torneo-premio',
                    monto: porCabeza,
                    torneoId: torneoDoc.id,
                    detalle: nombreTorneo,
                    createdAt: FieldValue.serverTimestamp(),
                });
            }
            if (sobrante > 0) {
                pagos.set(
                    db.doc('sistema/reserva'),
                    { total: FieldValue.increment(sobrante) },
                    { merge: true },
                );
            }
            await pagos.commit();
            await actualizarRanking(lista.map((g) => g.uid));
        }

        await registrarTrofeos(
            lista,
            torneoDoc.id,
            nombreTorneo,
            String(torneo['competicionNombre'] ?? ''),
            porCabeza,
            lista.length > 1,
        );
        await torneoRef.update({
            estado: 'finalizado',
            ganadorAlias: lista.map((g) => g.alias).join(', ') || 'Sin sobrevivientes',
            premioPagado: porCabeza,
            bolsa: 0,
        });
        cerrados.push(nombreTorneo);
    }

    return { ok: true, resueltos, eliminados, cerrados };
});

/* ============================================================
   Cierre automático de inscripciones
   Al vencer el plazo, el torneo arranca solo. Si no juntó al
   menos dos participantes, se cancela y se devuelve lo pagado.
   ============================================================ */
export const cerrarInscripciones = onSchedule(
    { schedule: 'every 15 minutes', timeZone: 'America/Mexico_City', secrets: [telegramToken] },
    async () => {
        const ahora = Timestamp.now();

        const pendientes = await db
            .collection('torneos')
            .where('estado', '==', 'inscripcion')
            .where('cierreInscripcion', '<=', ahora)
            .get();

        if (pendientes.empty) {
            logger.info('Sin torneos por arrancar.');
            return;
        }

        for (const torneoDoc of pendientes.docs) {
            const torneo = torneoDoc.data() as Record<string, unknown>;
            const participantes = await torneoDoc.ref.collection('participantes').get();

            // Con menos de dos jugadores no hay torneo: se devuelve el dinero.
            if (participantes.size < 2) {
                const devoluciones = db.batch();
                const afectados: string[] = [];

                for (const p of participantes.docs) {
                    const pago = Number(p.data()['pago'] ?? 0);
                    if (pago <= 0) continue;

                    devoluciones.set(
                        db.doc(`users/${p.id}`),
                        {
                            puntos: FieldValue.increment(pago),
                            puntosHistoricos: FieldValue.increment(pago),
                        },
                        { merge: true },
                    );
                    devoluciones.set(db.collection('ledger').doc(), {
                        uid: p.id,
                        tipo: 'torneo-devolucion',
                        monto: pago,
                        torneoId: torneoDoc.id,
                        detalle: `${String(torneo['nombre'] ?? 'Torneo')} (cancelado)`,
                        createdAt: FieldValue.serverTimestamp(),
                    });
                    afectados.push(p.id);
                }

                await devoluciones.commit();
                await torneoDoc.ref.update({
                    estado: 'finalizado',
                    ganadorAlias: 'Cancelado por falta de participantes',
                    bolsa: 0,
                });
                if (afectados.length > 0) await actualizarRanking(afectados);

                logger.info(`Torneo ${torneoDoc.id} cancelado; ${afectados.length} devolución(es).`);
                continue;
            }

            await torneoDoc.ref.update({ estado: 'en-curso' });
            logger.info(`Torneo ${torneoDoc.id} arrancó con ${participantes.size} participantes.`);

            const esQuiniela = torneo['modo'] === 'quiniela';
            const jornada = Number(torneo['jornadaActual'] ?? 1);
            await avisar(
                participantes.docs.map((p) => p.id),
                `<b>${String(torneo['nombre'] ?? 'Torneo')}</b>\n` +
                `Arrancó el torneo con ${participantes.size} jugadores.\n` +
                (esQuiniela
                    ? `Ya puedes capturar tus marcadores de la jornada ${jornada}.`
                    : `Ya puedes elegir tu equipo para la jornada ${jornada}.`),
            );
        }
    },
);

/* ============================================================
   Sincronizar puntos históricos con el saldo
   El campo puntosHistoricos se agregó cuando la app ya llevaba
   actividad, así que a las cuentas viejas les falta lo de antes.
   Esta función los iguala una sola vez. Úsala solo si todavía
   no has reiniciado el saldo de nadie: a partir de ahí los dos
   contadores deben seguir caminos distintos.
   ============================================================ */
export const sincronizarHistoricos = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) throw new HttpsError('permission-denied', 'Solo un administrador.');

    const usuarios = await db.collection('users').get();
    const batch = db.batch();
    const corregidos: string[] = [];

    for (const doc of usuarios.docs) {
        const u = doc.data() as Record<string, unknown>;
        const saldo = Number(u['puntos'] ?? 0);
        const historicos = Number(u['puntosHistoricos'] ?? 0);
        if (saldo === historicos) continue;

        batch.update(doc.ref, { puntosHistoricos: saldo });
        corregidos.push(doc.id);
    }

    await batch.commit();
    if (corregidos.length > 0) await actualizarRanking(corregidos);

    return { ok: true, corregidos: corregidos.length };
});

/* ============================================================
   MODO QUINIELA POR PUNTOS
   Pronosticas el marcador de todos los partidos de la jornada.
   Marcador exacto: 5 puntos. Solo acertar quién gana: 3 puntos.
   Nadie queda eliminado; gana quien más puntos acumule.
   ============================================================ */

const PUNTOS_EXACTO = 5;
const PUNTOS_RESULTADO = 3;

/** Guardar los pronósticos de la jornada en curso. */
export const guardarQuiniela = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const torneoId = String(req.data?.torneoId ?? '');
    const marcadores = req.data?.marcadores as Array<{ local: number; visitante: number }>;
    if (!torneoId || !Array.isArray(marcadores)) {
        throw new HttpsError('invalid-argument', 'Faltan datos.');
    }

    const torneoRef = db.doc(`torneos/${torneoId}`);
    const torneoSnap = await torneoRef.get();
    if (!torneoSnap.exists) throw new HttpsError('not-found', 'El torneo no existe.');

    const t = torneoSnap.data() as Record<string, unknown>;
    if (t['modo'] !== 'quiniela') {
        throw new HttpsError('failed-precondition', 'Este torneo no es de quiniela.');
    }
    if (t['estado'] !== 'en-curso') {
        throw new HttpsError('failed-precondition', 'El torneo no está en curso.');
    }

    const numero = Number(t['jornadaActual'] ?? 1);
    const jornadaDoc = await jornadaDeCompeticion(String(t['competicionId'] ?? ''), numero);
    if (!jornadaDoc) {
        throw new HttpsError('not-found', `La competición aún no tiene la jornada ${numero}.`);
    }

    const j = jornadaDoc.data() as JornadaDoc;
    if (j.estado !== 'abierta') {
        throw new HttpsError('failed-precondition', 'Esta jornada ya está cerrada.');
    }
    if (j.cierraAt && j.cierraAt.toMillis() <= Date.now()) {
        throw new HttpsError('failed-precondition', 'El tiempo para pronosticar ya terminó.');
    }
    if (marcadores.length !== j.partidos.length) {
        throw new HttpsError('invalid-argument', 'Faltan partidos por pronosticar.');
    }

    // Los marcadores deben ser números enteros y razonables.
    const limpios = marcadores.map((m) => {
        const local = Math.trunc(Number(m?.local));
        const visitante = Math.trunc(Number(m?.visitante));
        if (!Number.isFinite(local) || !Number.isFinite(visitante)) {
            throw new HttpsError('invalid-argument', 'Hay marcadores incompletos.');
        }
        if (local < 0 || visitante < 0 || local > 20 || visitante > 20) {
            throw new HttpsError('invalid-argument', 'Marcador fuera de rango.');
        }
        return { local, visitante };
    });

    const partRef = torneoRef.collection('participantes').doc(uid);
    const partSnap = await partRef.get();
    if (!partSnap.exists) throw new HttpsError('permission-denied', 'No estás inscrito.');

    await torneoRef.collection('quinielas').doc(`${uid}_${numero}`).set({
        uid,
        alias: String(partSnap.data()?.['alias'] ?? 'jugador'),
        jornada: numero,
        marcadores: limpios,
        estado: 'pendiente',
        createdAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, jornada: numero, partidos: limpios.length };
});

/**
 * Califica las quinielas de una jornada ya resuelta.
 * La llama resolverJornadaCompeticion para los torneos en modo quiniela.
 */
async function calificarQuinielas(
    torneoRef: FirebaseFirestore.DocumentReference,
    jornada: JornadaDoc,
): Promise<{ calificadas: number }> {
    const pronosticos = await torneoRef
        .collection('quinielas')
        .where('jornada', '==', jornada.numero)
        .where('estado', '==', 'pendiente')
        .get();
    if (pronosticos.empty) return { calificadas: 0 };

    const batch = db.batch();

    for (const doc of pronosticos.docs) {
        const datos = doc.data() as Record<string, unknown>;
        const marcadores = (datos['marcadores'] as Array<{ local: number; visitante: number }>) ?? [];

        let puntos = 0;
        let exactos = 0;

        jornada.partidos.forEach((partido, i) => {
            const p = partido as {
                resultado?: string | null;
                golesLocal?: number | null;
                golesVisitante?: number | null;
            };
            // Un partido aplazado no suma ni resta.
            if (!p.resultado || p.resultado === 'pospuesto') return;

            const mio = marcadores[i];
            if (!mio) return;

            const acertoMarcador =
                typeof p.golesLocal === 'number' &&
                typeof p.golesVisitante === 'number' &&
                mio.local === p.golesLocal &&
                mio.visitante === p.golesVisitante;

            if (acertoMarcador) {
                puntos += PUNTOS_EXACTO;
                exactos++;
                return;
            }

            const miResultado =
                mio.local > mio.visitante ? 'local' : mio.local < mio.visitante ? 'visitante' : 'empate';
            if (miResultado === p.resultado) puntos += PUNTOS_RESULTADO;
        });

        batch.update(doc.ref, { puntos, exactos, estado: 'calificada' });
        batch.set(
            torneoRef.collection('participantes').doc(String(datos['uid'])),
            {
                puntosTorneo: FieldValue.increment(puntos),
                exactos: FieldValue.increment(exactos),
            },
            { merge: true },
        );
    }

    await batch.commit();
    return { calificadas: pronosticos.size };
}

/**
 * Cierra un torneo de quiniela y reparte la bolsa entre quienes
 * hayan acumulado más puntos. Desempata por marcadores exactos.
 */
async function cerrarQuiniela(
    torneoRef: FirebaseFirestore.DocumentReference,
    torneoId: string,
    torneo: Record<string, unknown>,
): Promise<{ nombre: string; uids: string[] } | null> {
    const participantes = await torneoRef.collection('participantes').get();
    if (participantes.empty) return null;

    const tabla = participantes.docs.map((d) => ({
        uid: d.id,
        alias: String(d.data()['alias'] ?? 'jugador'),
        puntos: Number(d.data()['puntosTorneo'] ?? 0),
        exactos: Number(d.data()['exactos'] ?? 0),
    }));

    const mejorPuntaje = Math.max(...tabla.map((p) => p.puntos));
    const conMasPuntos = tabla.filter((p) => p.puntos === mejorPuntaje);

    // Si empatan en puntos, gana quien acertó más marcadores exactos.
    const mejorExactos = Math.max(...conMasPuntos.map((p) => p.exactos));
    const ganadores = conMasPuntos.filter((p) => p.exactos === mejorExactos);

    const bolsa = Number(torneo['bolsa'] ?? 0);
    const nombreTorneo = String(torneo['nombre'] ?? 'Torneo');
    let porCabeza = 0;

    if (bolsa > 0 && ganadores.length > 0) {
        porCabeza = Math.floor(bolsa / ganadores.length);
        const sobrante = bolsa - porCabeza * ganadores.length;

        const pagos = db.batch();
        for (const g of ganadores) {
            pagos.set(
                db.doc(`users/${g.uid}`),
                {
                    puntos: FieldValue.increment(porCabeza),
                    puntosHistoricos: FieldValue.increment(porCabeza),
                },
                { merge: true },
            );
            pagos.set(db.collection('ledger').doc(), {
                uid: g.uid,
                tipo: 'torneo-premio',
                monto: porCabeza,
                torneoId,
                detalle: nombreTorneo,
                createdAt: FieldValue.serverTimestamp(),
            });
        }
        if (sobrante > 0) {
            pagos.set(db.doc('sistema/reserva'), { total: FieldValue.increment(sobrante) }, { merge: true });
        }
        await pagos.commit();
    }

    await registrarTrofeos(
        ganadores.map((g) => ({ uid: g.uid, alias: g.alias })),
        torneoId,
        nombreTorneo,
        String(torneo['competicionNombre'] ?? ''),
        porCabeza,
        ganadores.length > 1,
    );

    await torneoRef.update({
        estado: 'finalizado',
        ganadorAlias: ganadores.map((g) => g.alias).join(', '),
        premioPagado: porCabeza,
        bolsa: 0,
    });

    return { nombre: nombreTorneo, uids: ganadores.map((g) => g.uid) };
}

/**
 * Datos públicos de un torneo a partir de su código de invitación.
 * Permite mostrar las reglas correctas antes de aceptar, incluso
 * a quien todavía no tiene cuenta. Solo devuelve lo indispensable.
 */
export const consultarTorneo = onCall(opcionesCall, async (req) => {
    const codigo = String(req.data?.codigo ?? '').trim().toUpperCase();
    if (!codigo) throw new HttpsError('invalid-argument', 'Falta el código.');

    const encontrados = await db
        .collection('torneos')
        .where('codigo', '==', codigo)
        .limit(1)
        .get();
    if (encontrados.empty) {
        throw new HttpsError('not-found', 'Ese código de invitación no existe.');
    }

    const t = encontrados.docs[0].data() as Record<string, unknown>;
    const participantes = await encontrados.docs[0].ref.collection('participantes').count().get();

    return {
        ok: true,
        nombre: String(t['nombre'] ?? 'Torneo'),
        modo: String(t['modo'] ?? 'supervivencia'),
        competicionNombre: String(t['competicionNombre'] ?? ''),
        costoEntrada: Number(t['costoEntrada'] ?? 0),
        jornadaInicial: Number(t['jornadaInicial'] ?? 1),
        jornadas: Number(t['jornadas'] ?? 0),
        vidas: Number(t['vidas'] ?? 1),
        vidaCubre: String(t['vidaCubre'] ?? 'empate'),
        estado: String(t['estado'] ?? 'inscripcion'),
        inscritos: participantes.data().count,
    };
});

/* ============================================================
   NOTIFICACIONES POR TELEGRAM
   Cada quien guarda su chat y decide si quiere recibirlas.
   ============================================================ */

/** Manda un mensaje. Nunca revienta: si falla, solo lo anota. */
async function enviarTelegram(chatId: string, texto: string): Promise<boolean> {
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

/** Avisa a varios de una vez, saltando a quien no quiera recibir. */
async function avisar(uids: string[], texto: string): Promise<number> {
    if (uids.length === 0) return 0;

    const docs = await db.getAll(...uids.map((uid) => db.doc(`users/${uid}`)));
    let enviados = 0;

    for (const doc of docs) {
        const u = doc.data() as Record<string, unknown> | undefined;
        if (!u || u['notificaciones'] !== true) continue;

        const chatId = String(u['telegramChatId'] ?? '');
        if (!chatId) continue;

        if (await enviarTelegram(chatId, texto)) enviados++;
    }
    return enviados;
}

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
    { secrets: [telegramToken, telegramWebhookSecret], maxInstances: 3 },
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
        );

        return { ok: true };
    },
);

/* ============================================================
   RECORDATORIO ANTES DE QUE CIERRE LA JORNADA
   Avisa solo a quien todavía no ha elegido, un par de horas
   antes del primer partido. En supervivencia, no elegir cuesta
   la eliminación: este es el aviso que más partidas salva.
   ============================================================ */

/** Cuánto antes del cierre se manda el recordatorio. */
const AVISO_HORAS_ANTES = 2;

export const recordarJornada = onSchedule(
    {
        /* Cada hora basta: con una ventana de dos, el aviso siempre
           alcanza a caer dentro con margen suficiente. */
        schedule: 'every 1 hours',
        timeZone: 'America/Mexico_City',
        secrets: [telegramToken],
    },
    async () => {
        const ahora = Date.now();
        const limite = ahora + AVISO_HORAS_ANTES * 60 * 60 * 1000;

        const torneos = await db.collection('torneos').where('estado', '==', 'en-curso').get();
        if (torneos.empty) return;

        let avisados = 0;

        for (const torneoDoc of torneos.docs) {
            const t = torneoDoc.data() as Record<string, unknown>;
            const numero = Number(t['jornadaActual'] ?? 1);

            // Un solo recordatorio por jornada.
            if (Number(t['recordatorioJornada'] ?? 0) === numero) continue;

            const jornadaDoc = await jornadaDeCompeticion(String(t['competicionId'] ?? ''), numero);
            if (!jornadaDoc) continue;

            const j = jornadaDoc.data() as JornadaDoc;
            if (j.estado !== 'abierta' || !j.cierraAt) continue;

            // Solo dentro de la ventana: ni antes de tiempo ni cuando ya cerró.
            const cierra = j.cierraAt.toMillis();
            if (cierra <= ahora || cierra > limite) continue;

            const esQuiniela = t['modo'] === 'quiniela';
            const coleccion = esQuiniela ? 'quinielas' : 'picks';

            const dentro = await torneoDoc.ref
                .collection('participantes')
                .where('vivo', '==', true)
                .get();

            const enviados = await torneoDoc.ref
                .collection(coleccion)
                .where('jornada', '==', numero)
                .get();
            const yaMandaron = new Set(enviados.docs.map((d) => String(d.data()['uid'])));

            const faltantes = dentro.docs.filter((d) => !yaMandaron.has(d.id)).map((d) => d.id);

            // Se marca aunque no falte nadie: la jornada ya quedó revisada.
            await torneoDoc.ref.update({ recordatorioJornada: numero });
            if (faltantes.length === 0) continue;

            const minutos = Math.max(1, Math.round((cierra - ahora) / 60000));
            const falta =
                minutos >= 60
                    ? `${Math.floor(minutos / 60)}h ${minutos % 60}m`
                    : `${minutos} minutos`;

            await avisar(
                faltantes,
                `⏰ <b>${String(t['nombre'] ?? 'Torneo')}</b>\n` +
                `Cierra en ${falta} y todavía no ` +
                (esQuiniela ? 'envías tus marcadores' : 'eliges equipo') +
                ` para la jornada ${numero}.\n\n` +
                (esQuiniela
                    ? 'Si no los mandas, esta jornada te quedas en ceros.'
                    : 'Si no eliges, quedas eliminado.'),
            );

            avisados += faltantes.length;
        }

        if (avisados > 0) logger.info(`Recordatorio enviado a ${avisados} jugador(es).`);
    },
);