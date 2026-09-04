/* ============================================================
   TORNEOS (supervivencia y quiniela por puntos)
   Funciones onCall/onSchedule del dominio de torneos, extraídas del
   index.ts. Los helpers de cierre/cálculo son privados; los que se
   comparten con brackets (registrarTrofeos, codigoBracket) viven en
   ./comun, y el refresco de tabla en ./sportsdb.
   ============================================================ */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import {
    db,
    cada,
    APUESTA_BASE,
    TOPE_INFERIOR,
    opcionesCall,
    telegramToken,
    sportsDbKey,
    calcularBote,
    registrarBote,
    actualizarRanking,
    registrarTrofeos,
    codigoBracket,
    FieldValue,
    Timestamp,
} from './comun';
import { avisar } from './notificaciones';
import { esAdminDeGrupo } from './grupos';
import { refrescarTablaCompeticion } from './sportsdb';


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

/* ============================================================
   MODO QUINIELA POR PUNTOS
   Pronosticas el marcador de todos los partidos de la jornada.
   Marcador exacto: 5 puntos. Solo acertar quién gana: 3 puntos.
   Nadie queda eliminado; gana quien más puntos acumule.
   ============================================================ */

const PUNTOS_EXACTO = 5;
const PUNTOS_RESULTADO = 3;

/**
 * Calcula los puntos de un cartón (marcadores del jugador) contra los
 * resultados de una jornada. Los partidos sin resultado o aplazados no
 * suman. La usan tanto la calificación oficial como la previa.
 */
function puntosDeCarton(
    marcadores: Array<{ local: number; visitante: number }>,
    partidos: Array<{
        resultado?: string | null;
        golesLocal?: number | null;
        golesVisitante?: number | null;
    }>,
): { puntos: number; exactos: number } {
    let puntos = 0;
    let exactos = 0;

    partidos.forEach((p, i) => {
        // Un partido sin resultado o aplazado no suma ni resta.
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

    return { puntos, exactos };
}

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

        const { puntos, exactos } = puntosDeCarton(
            marcadores,
            jornada.partidos as Array<{
                resultado?: string | null;
                golesLocal?: number | null;
                golesVisitante?: number | null;
            }>,
        );

        // Al calificar en firme, se limpia la previa del cartón: ya no aplica.
        batch.update(doc.ref, {
            puntos,
            exactos,
            estado: 'calificada',
            puntosPrevia: FieldValue.delete(),
            exactosPrevia: FieldValue.delete(),
        });
        batch.set(
            torneoRef.collection('participantes').doc(String(datos['uid'])),
            {
                puntosTorneo: FieldValue.increment(puntos),
                exactos: FieldValue.increment(exactos),
                // La previa de la jornada ya se materializó en puntosTorneo.
                puntosPrevia: FieldValue.delete(),
                exactosPrevia: FieldValue.delete(),
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
    // Idempotencia: si el torneo ya se cerró, NO repartir otra vez. Evita
    // pagos dobles o recálculos con datos a medio calificar si esta función
    // llega a ejecutarse más de una vez (reintentos, doble "Publicar", etc.).
    const frescoSnap = await torneoRef.get();
    if (frescoSnap.data()?.['estado'] === 'finalizado') {
        return null;
    }

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

    const bolsaBruta = Number(torneo['bolsa'] ?? 0);
    const nombreTorneo = String(torneo['nombre'] ?? 'Torneo');
    const alBote = calcularBote(bolsaBruta, torneo['porcentajeBote']);
    const bolsa = bolsaBruta - alBote;
    if (alBote > 0) {
        await registrarBote(alBote, `Torneo ${nombreTorneo}`);
    }
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
                    totalGanado: FieldValue.increment(porCabeza),
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

    // Si el torneo pertenece a un grupo, solo pueden unirse sus miembros.
    const grupoId = t['grupoId'];
    if (typeof grupoId === 'string' && grupoId) {
        const esMiembro = (await db.doc(`grupos/${grupoId}/miembros/${uid}`).get()).exists;
        if (!esMiembro) {
            throw new HttpsError(
                'permission-denied',
                'Este torneo es de un grupo privado. Debes ser miembro del grupo para entrar.',
            );
        }
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
                totalGastado: FieldValue.increment(costo),
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
    { ...opcionesCall, secrets: [telegramToken, sportsDbKey] },
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
                    'torneosInscritos',
                    `/torneos/${torneoDoc.id}`,
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
                    'torneosInscritos',
                    `/torneos/${torneoDoc.id}`,
                );
            }
            const bolsaBruta = Number(torneo['bolsa'] ?? 0);
            const alBote = calcularBote(bolsaBruta, torneo['porcentajeBote']);
            const bolsa = bolsaBruta - alBote;
            const nombreTorneo = String(torneo['nombre'] ?? 'Torneo');
            const competicion = String(torneo['competicionNombre'] ?? '');
            if (alBote > 0) {
                await registrarBote(alBote, `Torneo ${nombreTorneo}`);
            }

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
                            totalGanado: FieldValue.increment(porCabeza),
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
                    'torneosInscritos',
                    `/torneos/${torneoDoc.id}`,
                );
            } else {
                await torneoRef.update({ jornadaActual: j.numero + 1 });

                const sobreviven = vivos.size;
                await avisar(
                    vivos.docs.map((d) => d.id),
                    `<b>${nombreTorneo}</b>\n` +
                    `Jornada ${j.numero} resuelta. Quedan ${sobreviven} en pie.\n` +
                    `Ya puedes elegir tu equipo para la jornada ${j.numero + 1}.`,
                    'torneosInscritos',
                    `/torneos/${torneoDoc.id}`,
                );
            }
        }

        await jornadaRef.update({ estado: 'resuelta' });
        if (premiados.length > 0) await actualizarRanking(premiados);

        // Acaban de jugarse partidos: es el mejor momento para refrescar la
        // tabla oficial de la liga (si la competición está vinculada a la API).
        // Un fallo aquí no debe romper la resolución de la jornada.
        try {
            await refrescarTablaCompeticion(
                compRef,
                compSnap.data() as Record<string, unknown>,
                sportsDbKey.value(),
            );
        } catch (e) {
            logger.warn(`No se pudo refrescar la tabla de ${competicionId}.`, e);
        }

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
        // El premio por cabeza real lo dejó cerrarQuiniela en premioPagado.
        const cerrado = (await torneoRef.get()).data() as Record<string, unknown>;
        return {
            ok: true,
            ganadores: cierre.uids.length,
            premioPorCabeza: Number(cerrado['premioPagado'] ?? 0),
        };
    }

    const vivos = await torneoRef.collection('participantes').where('vivo', '==', true).get();
    if (vivos.empty) {
        throw new HttpsError('failed-precondition', 'No queda nadie vivo en este torneo.');
    }

    const bolsaBruta = Number(t['bolsa'] ?? 0);
    const nombreTorneo = String(t['nombre'] ?? 'Torneo');
    const alBote = calcularBote(bolsaBruta, t['porcentajeBote']);
    const bolsa = bolsaBruta - alBote;
    if (alBote > 0) {
        await registrarBote(alBote, `Torneo ${nombreTorneo}`);
    }
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
                    totalGanado: FieldValue.increment(porCabeza),
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

        const bolsaBruta = Number(torneo['bolsa'] ?? 0);
        const nombreTorneo = String(torneo['nombre'] ?? 'Torneo');
        const alBote = calcularBote(bolsaBruta, torneo['porcentajeBote']);
        const bolsa = bolsaBruta - alBote;
        if (alBote > 0) {
            await registrarBote(alBote, `Torneo ${nombreTorneo}`);
        }
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
                        totalGanado: FieldValue.increment(porCabeza),
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
    { schedule: cada(15), timeZone: 'America/Mexico_City', secrets: [telegramToken] },
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
                            // Torneo cancelado: revierte el gasto de la entrada.
                            totalGastado: FieldValue.increment(-pago),
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
                'torneosInscritos',
                `/torneos/${torneoDoc.id}`,
            );
        }
    },
);

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

/* ============================================================
   Previa de la quiniela (puntos parciales)
   Calcula los puntos de la jornada EN CURSO con los resultados
   capturados hasta ahora (aunque falten partidos) y los escribe en
   campos SEPARADOS (puntosPrevia). No toca los puntos oficiales ni
   el flujo de resolución/premios; solo alimenta la vista en vivo.
   ============================================================ */
export const previsualizarQuiniela = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const competicionId = String(req.data?.competicionId ?? '');
    const jornadaId = String(req.data?.jornadaId ?? '');
    if (!competicionId || !jornadaId) throw new HttpsError('invalid-argument', 'Faltan datos.');

    // Permiso: admin global o gestor de la competición (igual que resolver).
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

    // Torneos quiniela de esta competición, parados en esta jornada.
    const torneos = await db
        .collection('torneos')
        .where('competicionId', '==', competicionId)
        .where('estado', '==', 'en-curso')
        .get();

    const afectados = torneos.docs.filter(
        (d) =>
            d.data()['modo'] === 'quiniela' &&
            Number(d.data()['jornadaActual'] ?? 0) === j.numero,
    );

    let cartones = 0;
    const partidos = j.partidos as Array<{
        resultado?: string | null;
        golesLocal?: number | null;
        golesVisitante?: number | null;
    }>;

    for (const torneoDoc of afectados) {
        const torneoRef = torneoDoc.ref;
        // Solo los cartones aún pendientes: los calificados ya tienen su
        // puntaje oficial y no deben tocarse.
        const quinielas = await torneoRef
            .collection('quinielas')
            .where('jornada', '==', j.numero)
            .where('estado', '==', 'pendiente')
            .get();
        if (quinielas.empty) continue;

        const batch = db.batch();
        // Acumula la previa por participante para esta jornada.
        const previaPorUid = new Map<string, { puntos: number; exactos: number }>();

        for (const doc of quinielas.docs) {
            const datos = doc.data() as Record<string, unknown>;
            const marcadores =
                (datos['marcadores'] as Array<{ local: number; visitante: number }>) ?? [];

            const { puntos, exactos } = puntosDeCarton(marcadores, partidos);

            // Puntos de previa en el propio cartón (no cambia su estado).
            batch.update(doc.ref, { puntosPrevia: puntos, exactosPrevia: exactos });
            previaPorUid.set(String(datos['uid']), { puntos, exactos });
            cartones++;
        }

        // Escribe la previa por participante con SET absoluto (no increment):
        // así, aunque se llame varias veces al capturar más resultados, el
        // valor siempre refleja el estado actual sin acumular de más.
        previaPorUid.forEach((v, participanteUid) => {
            batch.set(
                torneoRef.collection('participantes').doc(participanteUid),
                { puntosPrevia: v.puntos, exactosPrevia: v.exactos },
                { merge: true },
            );
        });

        await batch.commit();
    }

    return { ok: true, cartones };
});

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

    // Si el torneo es de un grupo, solo un miembro puede ver sus detalles.
    const grupoId = t['grupoId'];
    if (typeof grupoId === 'string' && grupoId) {
        const uid = req.auth?.uid;
        const esMiembro = uid
            ? (await db.doc(`grupos/${grupoId}/miembros/${uid}`).get()).exists
            : false;
        if (!esMiembro) {
            throw new HttpsError(
                'permission-denied',
                'Este torneo es de un grupo privado. Únete al grupo para poder verlo.',
            );
        }
    }

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
        permiteRevivir: t['permiteRevivir'] === true,
        estado: String(t['estado'] ?? 'inscripcion'),
        inscritos: participantes.data().count,
    };
});

/** Cuánto antes del cierre se manda el recordatorio. */
const AVISO_HORAS_ANTES = 2;

export const recordarJornada = onSchedule(
    {
        /* Cada hora basta: con una ventana de dos, el aviso siempre
           alcanza a caer dentro con margen suficiente. */
        schedule: cada(60),
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
                'torneosInscritos',
                `/torneos/${torneoDoc.id}`,
            );

            avisados += faltantes.length;
        }

        if (avisados > 0) logger.info(`Recordatorio enviado a ${avisados} jugador(es).`);
    },
);

/* ============================================================
   REVIVIR EN SUPERVIVENCIA
   Si el torneo lo permite, quien cae puede volver — pero solo
   en la jornada inmediata siguiente a su eliminación, una vez
   por torneo, y vuelve con las mismas vidas que tenía al caer.
   Costo: (jornada ÷ 2) × costo de entrada.
   ============================================================ */
export const revivir = onCall(
    { ...opcionesCall, secrets: [telegramToken] },
    async (req) => {
        const uid = req.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

        const torneoId = String(req.data?.torneoId ?? '');
        if (!torneoId) throw new HttpsError('invalid-argument', 'Falta el torneo.');

        const torneoRef = db.doc(`torneos/${torneoId}`);

        // Todo en una transacción: cobro y regreso, o nada.
        const resultado = await db.runTransaction(async (tx) => {
            const torneoSnap = await tx.get(torneoRef);
            if (!torneoSnap.exists) throw new HttpsError('not-found', 'El torneo no existe.');
            const t = torneoSnap.data() as Record<string, unknown>;

            if (t['permiteRevivir'] !== true) {
                throw new HttpsError('failed-precondition', 'Este torneo no permite revivir.');
            }
            if (t['estado'] !== 'en-curso') {
                throw new HttpsError('failed-precondition', 'El torneo no está en curso.');
            }

            const partRef = torneoRef.collection('participantes').doc(uid);
            const partSnap = await tx.get(partRef);
            if (!partSnap.exists) throw new HttpsError('permission-denied', 'No estás en este torneo.');
            const p = partSnap.data() as Record<string, unknown>;

            if (p['vivo'] === true) {
                throw new HttpsError('failed-precondition', 'Sigues vivo, no necesitas revivir.');
            }
            if (p['revivioEn']) {
                throw new HttpsError('failed-precondition', 'Ya reviviste una vez en este torneo.');
            }

            // Solo en la jornada inmediata siguiente a la caída.
            const cayoEn = Number(p['eliminadoEn'] ?? 0);
            const actual = Number(t['jornadaActual'] ?? 0);
            if (cayoEn === 0 || actual !== cayoEn + 1) {
                throw new HttpsError(
                    'failed-precondition',
                    'Solo puedes revivir en la jornada justo después de tu eliminación, y ya pasó.',
                );
            }

            // Costo: (jornada ÷ 2) × entrada, con el decimal tal cual.
            const entrada = Number(t['costoEntrada'] ?? 0);
            const costo = Math.round((actual / 2) * entrada);

            const userRef = db.doc(`users/${uid}`);
            const userSnap = await tx.get(userRef);
            const saldo = Number(userSnap.data()?.['puntos'] ?? 0);
            if (saldo - costo < TOPE_INFERIOR) {
                throw new HttpsError('failed-precondition', 'No te alcanza el saldo para revivir.');
            }

            // Cobro.
            if (costo > 0) {
                tx.update(userRef, {
                    puntos: FieldValue.increment(-costo),
                    totalGastado: FieldValue.increment(costo),
                });
                tx.set(torneoRef, { bolsa: FieldValue.increment(costo) }, { merge: true });
                // Queda en el ledger, igual que la entrada: el pago por revivir
                // es auditable y aparece en el historial de movimientos.
                tx.set(db.collection('ledger').doc(), {
                    uid,
                    tipo: 'torneo-revivir',
                    monto: -costo,
                    torneoId,
                    detalle: String(t['nombre'] ?? 'Torneo'),
                    createdAt: FieldValue.serverTimestamp(),
                });
            }

            // Vuelve con las mismas vidas que tenía al caer: no se tocan, así
            // que quedan tal cual. Solo se marca vivo de nuevo y que ya revivió.
            tx.update(partRef, {
                vivo: true,
                eliminadoEn: FieldValue.delete(),
                revivioEn: actual,
            });

            return { costo, jornada: actual, alias: String(p['alias'] ?? 'jugador') };
        });

        await actualizarRanking([uid]);

        await avisar(
            [uid],
            `❤️‍🔥 <b>${String((await torneoRef.get()).data()?.['nombre'] ?? 'Torneo')}</b>\n` +
            `Reviviste en la jornada ${resultado.jornada} por ${resultado.costo} pts.\n` +
            'Vuelves con las vidas que tenías al caer. ¡Elige con cuidado!',
            'torneosInscritos',
            `/torneos/${torneoId}`,
        );

        return { ok: true, ...resultado };
    },
);

/**
 * Crea un torneo (quiniela o supervivencia). Valida el permiso en el servidor:
 * - Torneo GLOBAL (sin grupoId): solo un super administrador.
 * - Torneo DE GRUPO: solo el administrador de ese grupo.
 * Así ningún cliente puede crear torneos donde no le corresponde.
 */
export const crearTorneo = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const d = req.data ?? {};
    const nombre = String(d.nombre ?? '').trim();
    if (nombre.length < 2) {
        throw new HttpsError('invalid-argument', 'El nombre del torneo es muy corto.');
    }

    const grupoId = typeof d.grupoId === 'string' && d.grupoId ? d.grupoId : null;

    // Validación de permiso según destino.
    if (grupoId) {
        const [grupoSnap, adminSnap] = await Promise.all([
            db.doc(`grupos/${grupoId}`).get(),
            db.doc(`admins/${uid}`).get(),
        ]);
        if (!grupoSnap.exists) throw new HttpsError('not-found', 'El grupo no existe.');
        const esAdminGrupo = esAdminDeGrupo(grupoSnap.data(), uid);
        if (!esAdminGrupo && !adminSnap.exists) {
            throw new HttpsError('permission-denied', 'Solo un administrador del grupo puede crear torneos para él.');
        }
    } else {
        const esAdmin = (await db.doc(`admins/${uid}`).get()).exists;
        if (!esAdmin) {
            throw new HttpsError('permission-denied', 'Solo un administrador puede crear torneos globales.');
        }
    }

    const modo = d.modo === 'quiniela' ? 'quiniela' : 'supervivencia';
    const jornadaInicial = Number(d.jornadaInicial) || 1;
    const cierre = d.cierreInscripcion ? new Date(d.cierreInscripcion) : null;

    const codigo = codigoBracket(); // mismo generador de 6 caracteres

    const ref = await db.collection('torneos').add({
        nombre,
        competicionId: String(d.competicionId ?? ''),
        competicionNombre: String(d.competicionNombre ?? ''),
        jornadaInicial,
        jornadaActual: jornadaInicial,
        jornadas: modo === 'quiniela' ? Number(d.jornadas) || 1 : 0,
        vidas: modo === 'supervivencia' ? Number(d.vidas) || 1 : 0,
        vidaCubre: d.vidaCubre === 'tropiezo' ? 'tropiezo' : 'empate',
        permiteRevivir: modo === 'supervivencia' && d.permiteRevivir === true,
        costoEntrada: Number(d.costoEntrada) || 0,
        porcentajeBote: Number(d.porcentajeBote) || 0,
        cierreInscripcion: cierre,
        modo,
        grupoId,
        codigo,
        estado: 'inscripcion',
        bolsa: 0,
        gestores: [],
        createdAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, id: ref.id, codigo };
});
