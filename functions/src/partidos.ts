/* ============================================================
   PARTIDOS (pronósticos sueltos, bolsa, liquidación, bote)
   Funciones onCall/onSchedule del dominio de partidos, extraídas del
   index.ts. `ejecutarLiquidacion` se exporta porque lo usan los
   schedulers de la API (revisarResultados / revisarResultadosSportsDb),
   que por ahora siguen en index.ts.
   ============================================================ */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
    db,
    cada,
    APUESTA_BASE,
    TOPE_INFERIOR,
    MULTIPLICADOR_MAX,
    PRONOSTICOS_POR_LOTE,
    opcionesCall,
    calcularBote,
    actualizarRanking,
    FieldValue,
    Timestamp,
} from './comun';
import { avisar } from './notificaciones';
import { esAdminDeGrupo } from './grupos';

/** Forma mínima de un pronóstico tal como lo leemos en las liquidaciones. */
export interface PronosticoDoc {
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

        // Si ya existe, es una EDICIÓN: revertimos lo anterior y aplicamos lo nuevo.
        const anterior = pronSnap.exists
            ? (pronSnap.data() as Record<string, unknown>)
            : null;
        if (!userSnap.exists) {
            throw new HttpsError('not-found', 'No encontramos tu perfil.');
        }
        if (!partSnap.exists) {
            throw new HttpsError('not-found', 'El partido ya no existe.');
        }

        const me = userSnap.data() as Record<string, unknown>;
        const part = partSnap.data() as Record<string, unknown>;

        // Si el partido es de un grupo, solo sus miembros pueden pronosticar.
        const grupoId = part['grupoId'];
        if (typeof grupoId === 'string' && grupoId) {
            const miembroSnap = await tx.get(db.doc(`grupos/${grupoId}/miembros/${uid}`));
            if (!miembroSnap.exists) {
                throw new HttpsError(
                    'permission-denied',
                    'Este partido es de un grupo privado. Debes ser miembro del grupo para participar.',
                );
            }
        }

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

        const apuestaPrevia = anterior ? Number(anterior['apuesta'] ?? 0) : 0;
        const resultadoPrevio = anterior ? String(anterior['resultado'] ?? '') : '';

        const puntos = Number(me['puntos'] ?? 0);
        // Devolvemos la apuesta anterior (si editaba) y cobramos la nueva.
        const despues = puntos + apuestaPrevia - apuesta;
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
            // El histórico acumula el neto: devuelve lo anterior, cobra lo nuevo.
            puntosHistoricos: FieldValue.increment(apuestaPrevia - apuesta),
            // Total gastado bruto: el delta de esta apuesta (positivo si sube,
            // negativo si baja al editar). Así refleja lo realmente apostado.
            totalGastado: FieldValue.increment(apuesta - apuestaPrevia),
            bloqueado: despues - APUESTA_BASE < TOPE_INFERIOR,
        });

        // Bolsa del partido: si editaba, quita lo anterior de su resultado viejo.
        if (anterior && apuestaPrevia > 0) {
            tx.set(
                db.doc(`bolsas/${partidoId}`),
                {
                    partidoId,
                    total: FieldValue.increment(-apuestaPrevia),
                    porResultado: { [resultadoPrevio]: FieldValue.increment(-apuestaPrevia) },
                    conteos: { [resultadoPrevio]: FieldValue.increment(-1) },
                    actualizado: FieldValue.serverTimestamp(),
                },
                { mergeFields: ['partidoId', 'total', `porResultado.${resultadoPrevio}`, `conteos.${resultadoPrevio}`, 'actualizado'] },
            );
        }

        // Agregados en colección privada: solo los admins pueden leerlos,
        // así el premio sigue oculto para los jugadores.
        tx.set(
            db.doc(`bolsas/${partidoId}`),
            {
                partidoId,
                total: FieldValue.increment(apuesta),
                porResultado: { [resultado]: FieldValue.increment(apuesta) },
                conteos: { [resultado]: FieldValue.increment(1) },
                actualizado: FieldValue.serverTimestamp(),
            },
            { mergeFields: ['partidoId', 'total', `porResultado.${resultado}`, `conteos.${resultado}`, 'actualizado'] },
        );

        tx.set(ledgerRef, {
            uid,
            tipo: anterior ? 'apuesta-edicion' : 'apuesta',
            monto: apuestaPrevia - apuesta,
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

    return ejecutarLiquidacion(partidoId, resultadoOficial);
});

/**
 * Actualiza la tabla (ranking) de un grupo tras liquidar algo de ese grupo.
 * A cada participante le suma un "resuelto"; a los que acertaron, un "acierto".
 * Recalcula el porcentaje. El alias se toma del documento de miembro.
 */
async function actualizarTablaGrupo(
    grupoId: string,
    participantes: Array<{ uid: string; acerto: boolean }>,
): Promise<void> {
    for (const { uid, acerto } of participantes) {
        const filaRef = db.doc(`grupos/${grupoId}/tabla/${uid}`);
        try {
            await db.runTransaction(async (tx) => {
                const [filaSnap, miembroSnap] = await Promise.all([
                    tx.get(filaRef),
                    tx.get(db.doc(`grupos/${grupoId}/miembros/${uid}`)),
                ]);
                // Si ya no es miembro del grupo, no lo agregamos a la tabla.
                if (!miembroSnap.exists) return;

                const prev = filaSnap.exists ? (filaSnap.data() as Record<string, unknown>) : {};
                const aciertos = Number(prev['aciertos'] ?? 0) + (acerto ? 1 : 0);
                const resueltos = Number(prev['resueltos'] ?? 0) + 1;
                const alias = String((miembroSnap.data() as Record<string, unknown>)['alias'] ?? 'Jugador');

                tx.set(
                    filaRef,
                    {
                        uid,
                        alias,
                        aciertos,
                        resueltos,
                        porcentaje: resueltos > 0 ? Math.round((aciertos / resueltos) * 100) : 0,
                        actualizado: FieldValue.serverTimestamp(),
                    },
                    { merge: true },
                );
            });
        } catch {
            // Si falla la actualización de un usuario, no rompe la liquidación:
            // la tabla del grupo es secundaria frente al reparto de puntos.
        }
    }
}

/**
 * Reparte los premios de un partido y lo marca como liquidado. La usan
 * tanto el admin (liquidarPartido) como el cierre automático por API
 * (revisarResultados). Idempotente: si ya está liquidado, no repite.
 * Exportada: la consumen los schedulers de la API en index.ts.
 */
export async function ejecutarLiquidacion(
    partidoId: string,
    resultadoOficial: string,
): Promise<{ ok: boolean; participantes: number; ganadores: number; bolsa: number; sobrante: number }> {
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
            // Al quedar liquidado ya no hay nada pendiente: limpiamos avisos.
            alertaApi: FieldValue.delete(),
            resultadoPropuesto: FieldValue.delete(),
            marcadorPropuesto: FieldValue.delete(),
        });
        return { ok: true, participantes: 0, ganadores: 0, bolsa: 0, sobrante: 0 };
    }

    const bolsaBruta = pronosticos.reduce((acc, p) => acc + (p.apuesta ?? 0), 0);
    // El % del bote sale de la bolsa: se reparte lo que queda.
    const alBote = pronosticos.length > 0
        ? calcularBote(bolsaBruta, partido['porcentajeBote'])
        : 0;
    const bolsa = bolsaBruta - alBote;
    const ganadores = pronosticos.filter((p) => p.resultado === resultadoOficial);
    const perdedores = pronosticos.filter((p) => p.resultado !== resultadoOficial);
    const apostadoGanadores = ganadores.reduce((acc, p) => acc + (p.apuesta ?? 0), 0);

    const uidsAfectados = new Set<string>();
    let repartido = 0;
    // Para el aviso de resultado: qué le pasó a cada quien.
    const premioPorUid = new Map<string, number>(); // ganó (premio) o devolución
    const devueltoUids = new Set<string>();

    const ops: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

    if (ganadores.length === 0) {
        for (const p of pronosticos) {
            uidsAfectados.add(p.uid);
            devueltoUids.add(p.uid);
            ops.push((batch) => {
                batch.update(p.ref, { estado: 'devuelto', premio: p.apuesta });
                batch.set(
                    db.doc(`users/${p.uid}`),
                    {
                        puntos: FieldValue.increment(p.apuesta),
                        puntosHistoricos: FieldValue.increment(p.apuesta),
                        // Devolución: revierte el gasto original (Opción 1). No
                        // cuenta como ganancia; deja el balance como si no apostó.
                        totalGastado: FieldValue.increment(-p.apuesta),
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
            premioPorUid.set(p.uid, premio);
            ops.push((batch) => {
                batch.update(p.ref, { estado: 'ganado', premio });
                batch.set(
                    db.doc(`users/${p.uid}`),
                    {
                        puntos: FieldValue.increment(premio),
                        puntosHistoricos: FieldValue.increment(premio),
                        totalGanado: FieldValue.increment(premio),
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
    // El bote solo se aparta si hubo reparto (si se devolvió todo, no).
    const boteFinal = ganadores.length === 0 ? 0 : alBote;

    // Acumulados globales: reserva, puntos repartidos y partidos liquidados.
    await db.doc('sistema/reserva').set(
        {
            total: FieldValue.increment(sobrante + boteFinal),
            repartido: FieldValue.increment(repartido),
            liquidados: FieldValue.increment(1),
            actualizado: FieldValue.serverTimestamp(),
        },
        { merge: true },
    );

    if (boteFinal > 0) {
        await db.collection('ledger').add({
            uid: 'reserva',
            tipo: 'bote',
            monto: boteFinal,
            detalle: `Partido (${partidoId})`,
            partidoId,
            createdAt: FieldValue.serverTimestamp(),
        });
    }

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
        // Al quedar liquidado ya no hay nada pendiente: limpiamos avisos.
        alertaApi: FieldValue.delete(),
        resultadoPropuesto: FieldValue.delete(),
        marcadorPropuesto: FieldValue.delete(),
    });

    // Si el partido es de un grupo, actualiza la tabla (ranking) de ese grupo:
    // suma un "resuelto" a cada participante y un "acierto" a los ganadores.
    const grupoId = partido['grupoId'];
    if (typeof grupoId === 'string' && grupoId) {
        const idsGanadores = new Set(ganadores.map((p) => p.uid));
        await actualizarTablaGrupo(
            grupoId,
            pronosticos.map((p) => ({ uid: p.uid, acerto: idsGanadores.has(p.uid) })),
        );
    }

    // Aviso de resultado a cada quien que pronosticó (categoría 'partidos').
    // Un solo aviso por usuario, según su desenlace.
    await avisarResultadoPartido(partido, uidsAfectados, premioPorUid, devueltoUids);

    return {
        ok: true,
        participantes: pronosticos.length,
        ganadores: ganadores.length,
        bolsa,
        sobrante,
    };
}

/**
 * Avisa a cada usuario el resultado de su pronóstico suelto ya liquidado.
 * Un mensaje por usuario, según ganó / perdió / se le devolvió. Categoría
 * 'partidos' (default ON). No detiene la liquidación si algo falla.
 */
async function avisarResultadoPartido(
    partido: Record<string, unknown>,
    uidsAfectados: Set<string>,
    premioPorUid: Map<string, number>,
    devueltoUids: Set<string>,
): Promise<void> {
    const enfrenta = `${String(partido['homeTeam'] ?? '')} vs ${String(partido['awayTeam'] ?? '')}`.trim();
    const titulo = enfrenta && enfrenta !== 'vs' ? enfrenta : 'Tu pronóstico';

    for (const uid of uidsAfectados) {
        let texto: string;
        if (devueltoUids.has(uid)) {
            texto =
                `↩️ <b>${titulo}</b>\n` +
                'Nadie le atinó, así que te devolvimos tu apuesta. La próxima será.';
        } else if (premioPorUid.has(uid)) {
            const premio = premioPorUid.get(uid) ?? 0;
            texto =
                `✅ <b>${titulo}</b>\n` +
                `¡Le atinaste! Ganaste ${premio} pts.`;
        } else {
            texto =
                `❌ <b>${titulo}</b>\n` +
                'Esta vez no se dio. ¡A la próxima!';
        }
        try {
            await avisar([uid], texto, 'partidos', '/mis-pronosticos');
        } catch {
            // Un fallo de aviso no debe tumbar la liquidación.
        }
    }
}

/* ============================================================
   Cierre automático de partidos
   Corre cada 5 minutos: marca "cierra pronto" los que están por
   cerrar y pasa a "en juego" los que ya alcanzaron su hora.
   ============================================================ */
export const cerrarPartidos = onSchedule(cada(5), async () => {
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
            const conteos = (bolsaSnap.data()?.['conteos'] ?? {}) as Record<string, number>;

            // El bote sale de la bolsa: se reparte lo que queda (bolsa neta).
            // Debe calcularse igual que en la liquidación para que el premio
            // mostrado coincida con lo que de verdad se paga.
            const alBote = calcularBote(total, p['porcentajeBote']);
            const repartible = total - alBote;

            // Cuánto pagaría cada 100 puntos apostados a ese resultado, ya
            // descontado el bote.
            const premioPor100: Record<string, number> = {};
            Object.entries(porResultado).forEach(([r, apostado]) => {
                premioPor100[r] = apostado > 0 ? Math.floor((100 * repartible) / apostado) : 0;
            });

            await d.ref.update({
                status: 'en-juego',
                // poolTotal es lo repartible (neto), que es lo que la vista usa
                // para estimar premios; así no muestra de más por el bote.
                poolTotal: repartible,
                porResultado,
                premioPor100,
                // Número de pronósticos por resultado: permite mostrar
                // cuántas apuestas hay en cada opción en la vista pública.
                conteos,
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
/**
 * Cancela un partido y devuelve su apuesta a cada participante. Idempotente:
 * no devuelve dos veces. Núcleo reutilizable, sin validación de permisos, para
 * que la use tanto cancelarPartido (admin) como la liquidación automática
 * cuando un partido que no admite empate termina empatado.
 */
async function ejecutarCancelacion(
    partidoId: string,
): Promise<{ ok: boolean; devoluciones: number; puntosDevueltos: number }> {
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
        // Ya cancelado: idempotente, no hacemos nada.
        return { ok: true, devoluciones: 0, puntosDevueltos: 0 };
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
                    // Cancelación: revierte el gasto (Opción 1), no cuenta como ganancia.
                    totalGastado: FieldValue.increment(-p.apuesta),
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
        // Ya cancelado: no queda nada pendiente, limpiamos avisos de la API.
        alertaApi: FieldValue.delete(),
        resultadoPropuesto: FieldValue.delete(),
        marcadorPropuesto: FieldValue.delete(),
    });

    return { ok: true, devoluciones: pronosticos.length, puntosDevueltos: devuelto };
}

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

    return ejecutarCancelacion(partidoId);
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

/**
 * Crea un partido para un grupo. Valida el permiso en el servidor:
 * - Solo el administrador del grupo (o un super admin) puede crearlo.
 * Sirve tanto para partidos manuales como de API (si trae apiFixtureId).
 * La liquidación de partidos de API sigue siendo automática.
 */
export const crearPartidoGrupo = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const d = req.data ?? {};
    const grupoId = typeof d.grupoId === 'string' && d.grupoId ? d.grupoId : null;
    if (!grupoId) throw new HttpsError('invalid-argument', 'Falta el grupo.');

    // Permiso: admin del grupo o super admin.
    const [grupoSnap, adminSnap] = await Promise.all([
        db.doc(`grupos/${grupoId}`).get(),
        db.doc(`admins/${uid}`).get(),
    ]);
    if (!grupoSnap.exists) throw new HttpsError('not-found', 'El grupo no existe.');
    const esAdminGrupo = esAdminDeGrupo(grupoSnap.data(), uid);
    if (!esAdminGrupo && !adminSnap.exists) {
        throw new HttpsError('permission-denied', 'Solo un administrador del grupo puede crear partidos para él.');
    }

    const homeTeam = String(d.homeTeam ?? '').trim();
    const awayTeam = String(d.awayTeam ?? '').trim();
    if (!homeTeam || !awayTeam) throw new HttpsError('invalid-argument', 'Faltan los equipos.');

    const cierreMs = Number(d.closesAtMs);
    if (!cierreMs || cierreMs <= Date.now()) {
        throw new HttpsError('invalid-argument', 'La fecha de cierre debe ser futura.');
    }

    const doc: Record<string, unknown> = {
        competition: String(d.competition ?? 'Partido'),
        homeTeam,
        awayTeam,
        type: String(d.type ?? '1x2'),
        status: 'abierto',
        closesAt: Timestamp.fromMillis(cierreMs),
        porcentajeBote: Number(d.porcentajeBote) || 0,
        grupoId,
    };
    if (typeof d.apiFixtureId === 'number') doc['apiFixtureId'] = d.apiFixtureId;
    if (typeof d.apiEventId === 'string' && d.apiEventId) doc['apiEventId'] = d.apiEventId;
    if (typeof d.apiLigaId === 'number' && d.apiLigaId) doc['apiLigaId'] = d.apiLigaId;

    const ref = await db.collection('partidos').add(doc);
    return { ok: true, id: ref.id };
});

/**
 * Liquida un partido de grupo con el resultado que indica el admin del grupo.
 * Valida que quien liquida sea el admin de ese grupo (o super admin) y que el
 * partido efectivamente pertenezca a un grupo. Reutiliza la liquidación normal.
 */
export const liquidarPartidoGrupo = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const partidoId = String(req.data?.partidoId ?? '');
    const resultadoOficial = String(req.data?.resultadoOficial ?? '');
    if (!partidoId || !resultadoOficial) {
        throw new HttpsError('invalid-argument', 'Faltan datos para liquidar.');
    }

    const partSnap = await db.doc(`partidos/${partidoId}`).get();
    if (!partSnap.exists) throw new HttpsError('not-found', 'El partido no existe.');
    const grupoId = partSnap.data()?.['grupoId'];
    if (typeof grupoId !== 'string' || !grupoId) {
        throw new HttpsError('failed-precondition', 'Este no es un partido de grupo.');
    }

    // Permiso: admin del grupo o super admin.
    const [grupoSnap, adminSnap] = await Promise.all([
        db.doc(`grupos/${grupoId}`).get(),
        db.doc(`admins/${uid}`).get(),
    ]);
    const esAdminGrupo = grupoSnap.exists && esAdminDeGrupo(grupoSnap.data(), uid);
    if (!esAdminGrupo && !adminSnap.exists) {
        throw new HttpsError('permission-denied', 'Solo un administrador del grupo puede liquidar sus partidos.');
    }

    return ejecutarLiquidacion(partidoId, resultadoOficial);
});
