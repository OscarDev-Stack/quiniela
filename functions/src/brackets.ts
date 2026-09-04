/* ============================================================
   BRACKETS (eliminatorias: cuadro, dueños, pronóstico, calificación)
   Toda la lógica del cuadro vive aquí, en el servidor, para que nadie
   fuerce un avance o resultado desde el cliente. Extraído del index.ts;
   los helpers compartidos (registrarTrofeos, codigoBracket) vienen de
   ./comun.
   ============================================================ */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import {
    db,
    cada,
    TOPE_INFERIOR,
    opcionesCall,
    telegramToken,
    calcularBote,
    registrarBote,
    registrarTrofeos,
    codigoBracket,
    FieldValue,
    Timestamp,
} from './comun';
import { avisar } from './notificaciones';
import { esAdminDeGrupo } from './grupos';


/* ============================================================
   BRACKETS — eliminatoria (Fase 2: armar y capturar)
   La lógica del cuadro vive aquí, en el servidor, para que
   nadie pueda forzar un avance o un resultado desde el cliente.
   ============================================================ */

interface EquipoBk {
    nombre: string;
    siembra: number;
}
interface DuenoBk {
    equipo: string;
    uid: string | null;
    nombre: string;
    invitado: boolean;
    estado: 'invitado' | 'aceptado' | 'invitado-sin-registro';
}
interface PartidoBk {
    tipo: 'ida' | 'vuelta' | 'unico';
    golesLocal?: number | null;
    golesVisitante?: number | null;
    ganaPenales?: 'local' | 'visitante' | null;
}
interface LlaveBk {
    id: string;
    ronda: number;
    posicion: number;
    local?: EquipoBk;
    visitante?: EquipoBk;
    partidos: PartidoBk[];
    ganador?: EquipoBk;
    resueltoPor?: 'global' | 'mejor-sembrado' | 'penales';
}

function rondasDeBk(equipos: number): number {
    return Math.max(1, Math.round(Math.log2(equipos)));
}

function partidosDeLlaveBk(formato: 'ida-vuelta' | 'unico'): PartidoBk[] {
    if (formato === 'unico') return [{ tipo: 'unico', golesLocal: null, golesVisitante: null }];
    return [
        { tipo: 'ida', golesLocal: null, golesVisitante: null },
        { tipo: 'vuelta', golesLocal: null, golesVisitante: null },
    ];
}

function armarCuadroBk(config: Record<string, unknown>, equipos: EquipoBk[]): LlaveBk[] {
    const total = rondasDeBk(Number(config['equipos']));
    const llaves: LlaveBk[] = [];

    for (let ronda = 0; ronda < total; ronda++) {
        const enRonda = Number(config['equipos']) / Math.pow(2, ronda + 1);
        const esFinal = ronda === total - 1;
        const formato = String(esFinal ? config['formatoFinal'] : config['formatoRondas']) as
            | 'ida-vuelta'
            | 'unico';

        for (let pos = 0; pos < enRonda; pos++) {
            llaves.push({ id: `R${ronda}-L${pos}`, ronda, posicion: pos, partidos: partidosDeLlaveBk(formato) });
        }
    }

    if (config['armado'] === 'siembra' && equipos.length === Number(config['equipos'])) {
        const orden = [...equipos].sort((a, b) => a.siembra - b.siembra);
        let i = 0;
        let j = orden.length - 1;
        let pos = 0;
        while (i < j) {
            const llave = llaves.find((l) => l.ronda === 0 && l.posicion === pos);
            if (llave) {
                llave.local = orden[i];
                llave.visitante = orden[j];
            }
            i++;
            j--;
            pos++;
        }
    }
    return llaves;
}

function globalDeLlaveBk(llave: LlaveBk): { local: number; visitante: number } | null {
    let local = 0;
    let visitante = 0;
    let hay = false;
    for (const p of llave.partidos) {
        if (typeof p.golesLocal !== 'number' || typeof p.golesVisitante !== 'number') return null;
        hay = true;
        if (p.tipo === 'vuelta') {
            local += p.golesVisitante;
            visitante += p.golesLocal;
        } else {
            local += p.golesLocal;
            visitante += p.golesVisitante;
        }
    }
    return hay ? { local, visitante } : null;
}

function resolverLlaveBk(
    llave: LlaveBk,
    desempate: string,
): { ganador: EquipoBk; por: 'global' | 'mejor-sembrado' | 'penales' } | null {
    if (!llave.local || !llave.visitante) return null;
    const g = globalDeLlaveBk(llave);
    if (!g) return null;

    if (g.local > g.visitante) return { ganador: llave.local, por: 'global' };
    if (g.visitante > g.local) return { ganador: llave.visitante, por: 'global' };

    if (desempate === 'mejor-sembrado') {
        const gana = llave.local.siembra <= llave.visitante.siembra ? llave.local : llave.visitante;
        return { ganador: gana, por: 'mejor-sembrado' };
    }
    const ultimo = llave.partidos[llave.partidos.length - 1];
    if (ultimo.ganaPenales === 'local') return { ganador: llave.local, por: 'penales' };
    if (ultimo.ganaPenales === 'visitante') return { ganador: llave.visitante, por: 'penales' };
    return null;
}

function avanzarGanadorBk(
    llaves: LlaveBk[],
    resuelta: LlaveBk,
    ganador: EquipoBk,
    avance: string,
): void {
    const sigRonda = resuelta.ronda + 1;

    // Marca al ganador en su llave siempre.
    resuelta.ganador = ganador;

    // CRUCES FIJOS (Champions): posición predeterminada.
    if (avance !== 'reordena') {
        const sigPos = Math.floor(resuelta.posicion / 2);
        const esLocal = resuelta.posicion % 2 === 0;
        const destino = llaves.find((l) => l.ronda === sigRonda && l.posicion === sigPos);
        if (!destino) return;
        if (esLocal) destino.local = ganador;
        else destino.visitante = ganador;
        return;
    }

    // REORDENA (liguilla): solo emparejar cuando toda la ronda terminó.
    const rondaActual = llaves.filter((l) => l.ronda === resuelta.ronda);
    if (!rondaActual.every((l) => l.ganador)) return;

    const ganadores = rondaActual
        .map((l) => l.ganador as EquipoBk)
        .sort((a, b) => a.siembra - b.siembra);

    let i = 0;
    let j = ganadores.length - 1;
    let pos = 0;
    while (i < j) {
        const destino = llaves.find((l) => l.ronda === sigRonda && l.posicion === pos);
        if (destino) {
            destino.local = ganadores[i];
            destino.visitante = ganadores[j];
        }
        i++;
        j--;
        pos++;
    }
}


/** Crea un bracket. Global: super admin. De grupo: admin de ese grupo. */
export const crearBracket = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const grupoBk = typeof req.data?.grupoId === 'string' && req.data.grupoId ? req.data.grupoId : null;
    if (grupoBk) {
        const [grupoSnap, adminSnap] = await Promise.all([
            db.doc(`grupos/${grupoBk}`).get(),
            db.doc(`admins/${uid}`).get(),
        ]);
        if (!grupoSnap.exists) throw new HttpsError('not-found', 'El grupo no existe.');
        const esAdminGrupo = esAdminDeGrupo(grupoSnap.data(), uid);
        if (!esAdminGrupo && !adminSnap.exists) {
            throw new HttpsError('permission-denied', 'Solo un administrador del grupo puede crear eliminatorias para él.');
        }
    } else {
        const adminSnap = await db.doc(`admins/${uid}`).get();
        if (!adminSnap.exists) throw new HttpsError('permission-denied', 'Solo un administrador.');
    }

    const nombre = String(req.data?.nombre ?? '').trim();
    const config = req.data?.config as Record<string, unknown>;
    const puntaje = req.data?.puntaje;
    const equipos = (req.data?.equipos ?? []) as EquipoBk[];
    if (!nombre || !config) throw new HttpsError('invalid-argument', 'Faltan datos.');

    // La suma del reparto debe dar 100.
    const reparto = (config['reparto'] ?? [100]) as number[];
    if (reparto.reduce((a, b) => a + b, 0) !== 100) {
        throw new HttpsError('invalid-argument', 'El reparto de la bolsa debe sumar 100%.');
    }

    const llaves = armarCuadroBk(config, equipos);
    const cierraAt = req.data?.cierraAt ? Timestamp.fromDate(new Date(req.data.cierraAt)) : null;
    const armado = config['armado'] === 'siembra' && equipos.length === Number(config['equipos']);

    const ref = await db.collection('brackets').add({
        nombre,
        config,
        puntaje,
        llaves,
        equipos, // lista completa, para poder armar los cruces a mano si es manual
        modo: req.data?.modo === 'duenos' ? 'duenos' : 'pronostico',
        estado: armado ? 'inscripcion' : 'armando',
        codigo: codigoBracket(),
        cierraAt,
        costoEntrada: Number(req.data?.costoEntrada ?? 0),
        porcentajeBote: Number(req.data?.porcentajeBote ?? 0),
        publico: req.data?.publico === true,
        grupoId: typeof req.data?.grupoId === 'string' && req.data.grupoId ? req.data.grupoId : null,
        bolsa: 0,
        gestores: [],
        creadoPor: uid,
        createdAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, id: ref.id };
});

/** Asigna los equipos de una llave (modo manual). Solo admin/gestor. */
export const asignarLlaveBracket = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const bracketId = String(req.data?.bracketId ?? '');
    const idLlave = String(req.data?.idLlave ?? '');
    const ref = db.doc(`brackets/${bracketId}`);

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError('not-found', 'El bracket no existe.');
        const b = snap.data() as Record<string, unknown>;

        const esAdmin = (await db.doc(`admins/${uid}`).get()).exists;
        const esGestor = (b['gestores'] as string[] | undefined)?.includes(uid);
        if (!esAdmin && !esGestor) throw new HttpsError('permission-denied', 'No puedes editar este cuadro.');

        if (b['estado'] !== 'armando' && b['estado'] !== 'inscripcion') {
            throw new HttpsError('failed-precondition', 'El cuadro ya está en juego.');
        }

        const llaves = b['llaves'] as LlaveBk[];
        const llave = llaves.find((l) => l.id === idLlave);
        if (!llave) throw new HttpsError('not-found', 'Esa llave no existe.');

        llave.local = (req.data?.local as EquipoBk) ?? undefined;
        llave.visitante = (req.data?.visitante as EquipoBk) ?? undefined;

        // Si ya no queda ninguna llave de la primera ronda sin equipos, listo para inscripción.
        const primera = llaves.filter((l) => l.ronda === 0);
        const completa = primera.every((l) => l.local && l.visitante);

        tx.update(ref, { llaves, estado: completa ? 'inscripcion' : 'armando' });
    });

    return { ok: true };
});

/**
 * MODO DUEÑOS — el admin asigna un equipo a un participante.
 * Si es registrado, queda 'invitado' (le llega aviso, aún no se le cobra).
 * Si es invitado externo (sin cuenta), queda listo sin cobro.
 */
export const asignarDuenoBracket = onCall({ ...opcionesCall, secrets: [telegramToken] }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const bracketId = String(req.data?.bracketId ?? '');
    const equipo = String(req.data?.equipo ?? '').trim();
    const duenoUid = req.data?.duenoUid ? String(req.data.duenoUid) : null;
    const nombreInvitado = String(req.data?.nombre ?? '').trim();
    if (!equipo) throw new HttpsError('invalid-argument', 'Falta el equipo.');

    const ref = db.doc(`brackets/${bracketId}`);

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError('not-found', 'El bracket no existe.');
        const b = snap.data() as Record<string, unknown>;

        const esAdmin = (await db.doc(`admins/${uid}`).get()).exists;
        const esGestor = (b['gestores'] as string[] | undefined)?.includes(uid);
        if (!esAdmin && !esGestor) throw new HttpsError('permission-denied', 'No puedes editar este bracket.');

        if (b['modo'] !== 'duenos') throw new HttpsError('failed-precondition', 'Este bracket no es de dueños.');
        if (b['estado'] !== 'armando' && b['estado'] !== 'inscripcion') {
            throw new HttpsError('failed-precondition', 'El bracket ya está en juego.');
        }

        const duenos = (b['duenos'] as DuenoBk[] | undefined) ?? [];
        // Quita cualquier asignación previa de ese equipo.
        const sinEse = duenos.filter((d) => d.equipo !== equipo);

        let nuevo: DuenoBk;
        if (duenoUid) {
            // Si el bracket es de un grupo, solo se puede asignar a miembros de
            // ese grupo. Si no, el asignado no podría siquiera ver el bracket.
            const grupoId = b['grupoId'];
            if (typeof grupoId === 'string' && grupoId) {
                const esMiembro = (
                    await tx.get(db.doc(`grupos/${grupoId}/miembros/${duenoUid}`))
                ).exists;
                if (!esMiembro) {
                    throw new HttpsError(
                        'failed-precondition',
                        'Solo puedes asignar equipos a miembros de este grupo.',
                    );
                }
            }
            // Participante registrado: buscamos su alias y lo dejamos invitado.
            const userSnap = await tx.get(db.doc(`users/${duenoUid}`));
            const alias = userSnap.exists
                ? String((userSnap.data() as Record<string, unknown>)['alias'] ?? 'Jugador')
                : 'Jugador';
            nuevo = { equipo, uid: duenoUid, nombre: alias, invitado: false, estado: 'invitado' };
            // Que le aparezca en su lista para que pueda entrar a aceptar.
            tx.set(db.doc(`users/${duenoUid}`), { brackets: FieldValue.arrayUnion(bracketId) }, { merge: true });
        } else {
            // Invitado externo sin cuenta: no cobra ni avisa.
            if (!nombreInvitado) throw new HttpsError('invalid-argument', 'Falta el nombre del invitado.');
            nuevo = { equipo, uid: null, nombre: nombreInvitado, invitado: true, estado: 'invitado-sin-registro' };
        }

        tx.update(ref, { duenos: [...sinEse, nuevo] });
    });

    // Aviso al participante registrado (fuera de la transacción).
    if (duenoUid) {
        const bSnap = await ref.get();
        const bd = bSnap.data() as Record<string, unknown>;
        const costo = Number(bd['costoEntrada'] ?? 0);
        await avisar(
            [duenoUid],
            `⚽ <b>${String(bd['nombre'] ?? 'Eliminatoria')}</b>\n` +
            `Te asignaron a <b>${equipo}</b>.\n` +
            (costo > 0 ? `Entra a la app para aceptar (cuesta ${costo} pts).` : 'Entra a la app para aceptar.'),
            'torneosInscritos',
            `/eliminatorias/${bracketId}`,
        );
    }

    return { ok: true };
});

/**
 * MODO DUEÑOS — el participante registrado acepta las reglas y se le
 * cobra la entrada. Pasa su asignación a 'aceptado' y suma a la bolsa.
 */
export const aceptarDuenoBracket = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const bracketId = String(req.data?.bracketId ?? '');
    const ref = db.doc(`brackets/${bracketId}`);
    const userRef = db.doc(`users/${uid}`);

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError('not-found', 'El bracket no existe.');
        const b = snap.data() as Record<string, unknown>;

        if (b['modo'] !== 'duenos') throw new HttpsError('failed-precondition', 'Este bracket no es de dueños.');

        const duenos = (b['duenos'] as DuenoBk[] | undefined) ?? [];
        const mio = duenos.find((d) => d.uid === uid);
        if (!mio) throw new HttpsError('not-found', 'No tienes un equipo asignado aquí.');
        if (mio.estado === 'aceptado') return; // ya aceptó, no cobra doble.

        const costo = Number(b['costoEntrada'] ?? 0);
        if (costo > 0) {
            const userSnap = await tx.get(userRef);
            const puntos = Number((userSnap.data() as Record<string, unknown>)?.['puntos'] ?? 0);
            // Igual que el resto de la app: se permite saldo negativo hasta el tope.
            if (puntos - costo < TOPE_INFERIOR) {
                throw new HttpsError('failed-precondition', 'No te alcanza el saldo para entrar.');
            }
            tx.update(userRef, {
                puntos: FieldValue.increment(-costo),
                totalGastado: FieldValue.increment(costo),
            });
            // Todo movimiento de puntos queda en el ledger.
            tx.set(db.collection('ledger').doc(), {
                uid,
                tipo: 'bracket-entrada',
                monto: -costo,
                saldoDespues: puntos - costo,
                detalle: `Entrada a ${String(b['nombre'] ?? 'eliminatoria')} (${mio.equipo})`,
                bracketId,
                createdAt: FieldValue.serverTimestamp(),
            });
        }

        const actualizados = duenos.map((d) =>
            d.uid === uid ? { ...d, estado: 'aceptado' } : d,
        );
        tx.update(ref, {
            duenos: actualizados,
            bolsa: FieldValue.increment(costo),
        });
        // Que el bracket aparezca en su lista/hub.
        tx.set(userRef, { brackets: FieldValue.arrayUnion(bracketId) }, { merge: true });
    });

    return { ok: true };
});

/**
 * MODO DUEÑOS — el participante rechaza el equipo que le asignaron.
 * El equipo queda libre para que el admin lo reasigne, y se quita el
 * bracket de su lista. Solo se puede rechazar si aún no aceptó.
 */
export const rechazarDuenoBracket = onCall({ ...opcionesCall, secrets: [telegramToken] }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const bracketId = String(req.data?.bracketId ?? '');
    const ref = db.doc(`brackets/${bracketId}`);
    const userRef = db.doc(`users/${uid}`);

    let equipoLiberado = '';
    let nombreBracket = '';
    let creadoPor = '';

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError('not-found', 'El bracket no existe.');
        const b = snap.data() as Record<string, unknown>;

        if (b['modo'] !== 'duenos') throw new HttpsError('failed-precondition', 'Este bracket no es de dueños.');
        if (b['estado'] !== 'inscripcion' && b['estado'] !== 'armando') {
            throw new HttpsError('failed-precondition', 'El torneo ya arrancó, no se puede rechazar.');
        }

        const duenos = (b['duenos'] as DuenoBk[] | undefined) ?? [];
        const mio = duenos.find((d) => d.uid === uid);
        if (!mio) throw new HttpsError('not-found', 'No tienes un equipo asignado aquí.');
        if (mio.estado === 'aceptado') {
            throw new HttpsError('failed-precondition', 'Ya aceptaste; no puedes rechazar.');
        }

        equipoLiberado = mio.equipo;
        nombreBracket = String(b['nombre'] ?? 'Eliminatoria');
        creadoPor = String(b['creadoPor'] ?? '');

        // Quita la asignación (el equipo queda libre) y saca el bracket de su lista.
        const sinMio = duenos.filter((d) => d.uid !== uid);
        tx.update(ref, { duenos: sinMio });
        tx.set(userRef, { brackets: FieldValue.arrayRemove(bracketId) }, { merge: true });
    });

    // Avisar al creador para que reasigne.
    if (creadoPor) {
        await avisar(
            [creadoPor],
            `⚠️ <b>${nombreBracket}</b>\n` +
            `Un participante rechazó al equipo ${equipoLiberado}.\n` +
            `Ya quedó libre para reasignar.`,
            undefined,
            '/admin/brackets',
        );
    }

    return { ok: true };
});

/** Captura un partido y resuelve la llave si queda completa. Solo admin/gestor. */
export const capturarPartidoBracket = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const bracketId = String(req.data?.bracketId ?? '');
    const idLlave = String(req.data?.idLlave ?? '');
    const indice = Number(req.data?.indicePartido ?? 0);
    const gl = Number(req.data?.golesLocal);
    const gv = Number(req.data?.golesVisitante);
    const penales = (req.data?.ganaPenales ?? null) as 'local' | 'visitante' | null;

    if (!Number.isInteger(gl) || !Number.isInteger(gv) || gl < 0 || gv < 0) {
        throw new HttpsError('invalid-argument', 'Marcador inválido.');
    }

    const ref = db.doc(`brackets/${bracketId}`);

    // Fuera de la transacción: si una llave se resolvió, refrescamos los
    // puntos parciales de cada pronóstico para que la tabla "Pronósticos de
    // todos" se actualice ronda a ronda, no solo al finalizar.
    let llaveResuelta = false;
    let modoDuenos = false;

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError('not-found', 'El bracket no existe.');
        const b = snap.data() as Record<string, unknown>;
        modoDuenos = b['modo'] === 'duenos';

        const esAdmin = (await db.doc(`admins/${uid}`).get()).exists;
        const esGestor = (b['gestores'] as string[] | undefined)?.includes(uid);
        if (!esAdmin && !esGestor) throw new HttpsError('permission-denied', 'No puedes capturar en este cuadro.');

        const config = b['config'] as Record<string, unknown>;
        const llaves = b['llaves'] as LlaveBk[];
        const llave = llaves.find((l) => l.id === idLlave);
        if (!llave) throw new HttpsError('not-found', 'Esa llave no existe.');
        if (llave.ganador) throw new HttpsError('failed-precondition', 'Esa llave ya está resuelta.');
        if (!llave.partidos[indice]) throw new HttpsError('invalid-argument', 'Partido inexistente.');

        llave.partidos[indice].golesLocal = gl;
        llave.partidos[indice].golesVisitante = gv;
        if (penales) llave.partidos[indice].ganaPenales = penales;

        // ¿Es la final? La última ronda usa su propio desempate.
        const total = rondasDeBk(Number(config['equipos']));
        const esFinal = llave.ronda === total - 1;
        const desempate = String(esFinal ? config['desempateFinal'] : config['desempateRondas']);

        const res = resolverLlaveBk(llave, desempate);
        let ganadorAlias: string | undefined;
        if (res) {
            llave.ganador = res.ganador;
            llave.resueltoPor = res.por;
            avanzarGanadorBk(llaves, llave, res.ganador, String(config['avance'] ?? 'fijo'));
            if (esFinal) ganadorAlias = res.ganador.nombre;
            llaveResuelta = true;
        }

        const patch: Record<string, unknown> = { llaves };
        if (ganadorAlias) {
            patch['estado'] = 'finalizado';
            patch['ganadorAlias'] = ganadorAlias;
        } else if (b['estado'] === 'inscripcion') {
            // Al capturar el primer resultado, el cuadro pasa a en-curso.
            patch['estado'] = 'en-curso';
        }

        tx.update(ref, patch);
    });

    // Recalcular puntos parciales tras resolver una llave. En modo dueños no
    // hay pronósticos que calificar (gana el dueño del campeón), así que se
    // omite. El reparto de bolsa/posición/premio sigue en calificarBracket.
    if (llaveResuelta && !modoDuenos) {
        await recalcularPuntosBracket(ref);
    }

    return { ok: true };
});

/**
 * Recalcula los puntos parciales de cada pronóstico de un bracket según las
 * llaves ya resueltas hasta el momento, y los escribe en la subcolección
 * `pronosticos`. Esto mantiene actualizada la tabla "Pronósticos de todos"
 * conforme cierran las rondas, sin esperar a la calificación final (que es
 * la que reparte la bolsa y fija posiciones/premios).
 */
async function recalcularPuntosBracket(
    ref: FirebaseFirestore.DocumentReference,
): Promise<void> {
    const snap = await ref.get();
    if (!snap.exists) return;
    const b = snap.data() as Record<string, unknown>;

    const llaves = b['llaves'] as LlaveBk[];
    const puntaje = b['puntaje'] as PuntajeBk;
    if (!llaves || !puntaje) return;

    const pronosticos = await ref.collection('pronosticos').get();
    if (pronosticos.empty) return;

    const batch = db.batch();
    pronosticos.docs.forEach((doc) => {
        const p = doc.data() as Record<string, unknown>;
        // No pisar a quien ya quedó calificado (reparto final ya hecho).
        if (p['estado'] === 'calificado') return;

        const d = calificarBk(
            llaves,
            (p['avances'] ?? {}) as Record<string, string>,
            p['marcadores'] as Record<string, { local: number; visitante: number }> | undefined,
            puntaje,
        );
        batch.update(doc.ref, { puntos: d.total });
    });

    await batch.commit();
}

/* ============================================================
   BRACKETS — Fase 3: pronóstico del jugador
   ============================================================ */

/** Guarda (o actualiza) mi pronóstico del cuadro, si aún no cierra. */
export const guardarPronosticoBracket = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const bracketId = String(req.data?.bracketId ?? '');
    const avances = (req.data?.avances ?? {}) as Record<string, string>;
    const marcadores = (req.data?.marcadores ?? null) as Record<
        string,
        { local: number; visitante: number }
    > | null;

    const userSnap = await db.doc(`users/${uid}`).get();
    if (userSnap.data()?.['validada'] !== true) {
        throw new HttpsError('permission-denied', 'Tu cuenta aún no ha sido validada.');
    }
    const alias =
        String(userSnap.data()?.['alias'] ?? '').trim() ||
        String(userSnap.data()?.['email'] ?? '').split('@')[0] ||
        'jugador';

    const bracketRef = db.doc(`brackets/${bracketId}`);
    const bracketSnap = await bracketRef.get();
    if (!bracketSnap.exists) throw new HttpsError('not-found', 'La eliminatoria no existe.');
    const b = bracketSnap.data() as Record<string, unknown>;

    // Solo se puede pronosticar antes del cierre único.
    if (b['estado'] !== 'inscripcion') {
        throw new HttpsError('failed-precondition', 'El pronóstico de esta eliminatoria ya cerró.');
    }
    const cierra = b['cierraAt'] as Timestamp | undefined;
    if (cierra && cierra.toMillis() <= Date.now()) {
        throw new HttpsError('failed-precondition', 'Ya pasó la hora de cierre.');
    }

    const conMarcador = !!marcadores && Object.keys(marcadores).length > 0;
    const costo = Number(b['costoEntrada'] ?? 0);

    // Todo en una transacción: cobro (solo la primera vez) y guardado.
    await db.runTransaction(async (tx) => {
        const pronRef = bracketRef.collection('pronosticos').doc(uid);
        const yaEntro = (await tx.get(pronRef)).exists;

        // Cobro único al entrar. Editar el pronóstico después no vuelve a cobrar.
        if (!yaEntro && costo > 0) {
            const userRef = db.doc(`users/${uid}`);
            const saldo = Number((await tx.get(userRef)).data()?.['puntos'] ?? 0);
            if (saldo - costo < TOPE_INFERIOR) {
                throw new HttpsError('failed-precondition', 'No te alcanza el saldo para entrar.');
            }
            tx.update(userRef, {
                puntos: FieldValue.increment(-costo),
                totalGastado: FieldValue.increment(costo),
            });
            tx.set(bracketRef, { bolsa: FieldValue.increment(costo) }, { merge: true });
            // Todo movimiento de puntos queda en el ledger.
            tx.set(db.collection('ledger').doc(), {
                uid,
                tipo: 'bracket-entrada',
                monto: -costo,
                saldoDespues: saldo - costo,
                detalle: `Entrada a ${String(b['nombre'] ?? 'eliminatoria')}`,
                bracketId,
                createdAt: FieldValue.serverTimestamp(),
            });
        }

        tx.set(
            pronRef,
            {
                uid,
                alias,
                avances,
                marcadores: marcadores ?? {},
                conMarcador,
                estado: 'pendiente',
                actualizado: FieldValue.serverTimestamp(),
            },
            { merge: true },
        );

        tx.set(db.doc(`users/${uid}`), { brackets: FieldValue.arrayUnion(bracketId) }, { merge: true });
    });

    return { ok: true };
});

/** Une a un jugador a un bracket por su código. Devuelve el id. */
export const unirseBracket = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const codigo = String(req.data?.codigo ?? '').trim().toUpperCase();
    if (!codigo) throw new HttpsError('invalid-argument', 'Falta el código.');

    const encontrados = await db.collection('brackets').where('codigo', '==', codigo).limit(1).get();
    if (encontrados.empty) throw new HttpsError('not-found', 'No hay ninguna eliminatoria con ese código.');

    // Si la eliminatoria es de un grupo, solo sus miembros pueden entrar.
    const b = encontrados.docs[0].data() as Record<string, unknown>;
    const grupoId = b['grupoId'];
    if (typeof grupoId === 'string' && grupoId) {
        const esMiembro = (await db.doc(`grupos/${grupoId}/miembros/${uid}`).get()).exists;
        if (!esMiembro) {
            throw new HttpsError(
                'permission-denied',
                'Esta eliminatoria es de un grupo privado. Debes ser miembro del grupo para entrar.',
            );
        }
    }

    return { ok: true, id: encontrados.docs[0].id };
});

/* ============================================================
   BRACKETS — Fase 4: calificar y repartir
   Cuando el cuadro termina, se puntúa cada pronóstico contra el
   resultado real y se reparte la bolsa según config.reparto.
   ============================================================ */

interface PuntajeBk {
    avanzaPorRonda: number[];
    campeon: number;
    finalista: number;
    marcadorExacto: number;
    marcadorResultado: number;
}

interface DesgloseBk {
    total: number;
    aciertosPorRonda: number[];
    marcadoresAcertados: number;
}

function calificarBk(
    llaves: LlaveBk[],
    avances: Record<string, string>,
    marcadores: Record<string, { local: number; visitante: number }> | undefined,
    puntaje: PuntajeBk,
): DesgloseBk {
    const totalRondas = Math.max(...llaves.map((l) => l.ronda)) + 1;
    const aciertosPorRonda = new Array(totalRondas).fill(0);
    let total = 0;
    let marcadoresAcertados = 0;

    // Por EQUIPO, no por posición de llave: si dijiste que un equipo avanza
    // a una ronda y llegó, cuenta, esté donde esté en tu cuadro.
    const realesPorRonda: Array<Set<string>> = [];
    const misPorRonda: Array<Set<string>> = [];
    for (let r = 0; r < totalRondas; r++) {
        const reales = new Set<string>();
        const mios = new Set<string>();
        for (const l of llaves) {
            if (l.ronda !== r) continue;
            if (l.ganador) reales.add(l.ganador.nombre);
            if (avances[l.id]) mios.add(avances[l.id]);
        }
        realesPorRonda.push(reales);
        misPorRonda.push(mios);
    }

    for (let r = 0; r < totalRondas; r++) {
        const reales = realesPorRonda[r];
        if (reales.size === 0) continue;
        const esFinal = r === totalRondas - 1;
        const esSemis = r === totalRondas - 2;
        for (const equipo of misPorRonda[r]) {
            if (!reales.has(equipo)) continue;
            total += puntaje.avanzaPorRonda[r] ?? 0;
            aciertosPorRonda[r]++;
            if (esFinal) total += puntaje.campeon;
            else if (esSemis) total += puntaje.finalista;
        }
    }

    if (marcadores) {
        for (const llave of llaves) {
            if (!llave.ganador) continue;
            const miMarc = marcadores[llave.id];
            if (!miMarc) continue;
            const real = globalDeLlaveBk(llave);
            if (!real) continue;
            if (miMarc.local === real.local && miMarc.visitante === real.visitante) {
                total += puntaje.marcadorExacto;
                marcadoresAcertados++;
            } else {
                const mg = miMarc.local > miMarc.visitante ? 'l' : miMarc.local < miMarc.visitante ? 'v' : 'e';
                const rg = real.local > real.visitante ? 'l' : real.local < real.visitante ? 'v' : 'e';
                if (mg === rg) total += puntaje.marcadorResultado;
            }
        }
    }

    return { total, aciertosPorRonda, marcadoresAcertados };
}

function compararBk(
    a: { puntos: number; d: DesgloseBk },
    b: { puntos: number; d: DesgloseBk },
): number {
    if (a.puntos !== b.puntos) return b.puntos - a.puntos;
    if (a.d.marcadoresAcertados !== b.d.marcadoresAcertados) {
        return b.d.marcadoresAcertados - a.d.marcadoresAcertados;
    }
    const ra = a.d.aciertosPorRonda;
    const rb = b.d.aciertosPorRonda;
    for (let r = ra.length - 1; r >= 0; r--) {
        if ((ra[r] ?? 0) !== (rb[r] ?? 0)) return (rb[r] ?? 0) - (ra[r] ?? 0);
    }
    return 0;
}

/**
 * Califica una eliminatoria terminada y reparte la bolsa.
 * La puede llamar el admin, o se dispara sola al capturar la final.
 */
/**
 * MODO DUEÑOS — al terminar el cuadro, gana el dueño del equipo campeón.
 * Se lleva toda la bolsa, suma un torneo ganado y recibe su trofeo.
 */
async function calificarDuenos(
    ref: FirebaseFirestore.DocumentReference,
    b: Record<string, unknown>,
    llaves: LlaveBk[],
    bracketId: string,
): Promise<{ ok: boolean; calificados: number }> {
    const bolsaBruta = Number(b['bolsa'] ?? 0);
    const alBote = calcularBote(bolsaBruta, b['porcentajeBote']);
    const bolsa = bolsaBruta - alBote;
    if (alBote > 0) {
        await registrarBote(alBote, `Eliminatoria ${String(b['nombre'] ?? '')}`);
    }
    const duenos = (b['duenos'] as DuenoBk[] | undefined) ?? [];

    // El campeón es el ganador de la final (la llave de mayor ronda).
    const rondaFinal = Math.max(...llaves.map((l) => l.ronda));
    const final = llaves.find((l) => l.ronda === rondaFinal);
    const campeon = final?.ganador?.nombre ?? null;
    if (!campeon) {
        await ref.update({ premioPagado: 0, ganadorAlias: 'Sin campeón' });
        return { ok: true, calificados: 0 };
    }

    // ¿Quién es el dueño de ese equipo?
    const dueno = duenos.find((d) => d.equipo === campeon) ?? null;

    await ref.update({
        premioPagado: bolsa,
        ganadorAlias: dueno?.nombre ?? campeon,
    });

    // Si el dueño es un usuario registrado, cobra la bolsa, trofeo y aviso.
    if (dueno?.uid) {
        if (bolsa > 0) {
            await db.doc(`users/${dueno.uid}`).set(
                {
                    puntos: FieldValue.increment(bolsa),
                    puntosHistoricos: FieldValue.increment(bolsa),
                    totalGanado: FieldValue.increment(bolsa),
                },
                { merge: true },
            );
            // Todo movimiento de puntos queda en el ledger.
            await db.collection('ledger').add({
                uid: dueno.uid,
                tipo: 'bracket-premio',
                monto: bolsa,
                detalle: `Campeón con ${campeon} en ${String(b['nombre'] ?? 'eliminatoria')}`,
                bracketId,
                createdAt: FieldValue.serverTimestamp(),
            });
        }
        await registrarTrofeos(
            [{ uid: dueno.uid, alias: dueno.nombre }],
            bracketId,
            String(b['nombre'] ?? 'Eliminatoria'),
            String(b['competicion'] ?? b['nombre'] ?? 'Eliminatoria'),
            bolsa,
            false,
        );
        await avisar(
            [dueno.uid],
            `🏆 <b>${String(b['nombre'] ?? 'Eliminatoria')}</b>\n` +
            `¡Tu equipo ${campeon} fue campeón!\n` +
            (bolsa > 0 ? `Ganaste ${bolsa} pts. ¡Felicidades!` : '¡Felicidades!'),
            'torneosInscritos',
            `/eliminatorias/${bracketId}`,
        );
    }

    return { ok: true, calificados: dueno ? 1 : 0 };
}

export const calificarBracket = onCall(
    { ...opcionesCall, secrets: [telegramToken] },
    async (req) => {
        const uid = req.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
        const esAdmin = (await db.doc(`admins/${uid}`).get()).exists;
        if (!esAdmin) throw new HttpsError('permission-denied', 'Solo un administrador.');

        const bracketId = String(req.data?.bracketId ?? '');
        const ref = db.doc(`brackets/${bracketId}`);
        const snap = await ref.get();
        if (!snap.exists) throw new HttpsError('not-found', 'La eliminatoria no existe.');
        const b = snap.data() as Record<string, unknown>;

        if (b['estado'] !== 'finalizado') {
            throw new HttpsError('failed-precondition', 'La eliminatoria todavía no termina.');
        }

        const llaves = b['llaves'] as LlaveBk[];

        // ── MODO DUEÑOS ──────────────────────────────────────────────
        // No hay pronósticos: gana el dueño del equipo campeón.
        if (b['modo'] === 'duenos') {
            return await calificarDuenos(ref, b, llaves, bracketId);
        }

        const puntaje = b['puntaje'] as PuntajeBk;
        const reparto = (b['config'] as Record<string, unknown>)['reparto'] as number[];
        const bolsaBruta = Number(b['bolsa'] ?? 0);
        const alBote = calcularBote(bolsaBruta, b['porcentajeBote']);
        const bolsa = bolsaBruta - alBote;
        if (alBote > 0) {
            await registrarBote(alBote, `Eliminatoria ${String(b['nombre'] ?? '')}`);
        }

        const pronosticos = await ref.collection('pronosticos').get();
        if (pronosticos.empty) return { ok: true, calificados: 0 };

        // Calificar a cada quien.
        const tabla = pronosticos.docs.map((doc) => {
            const p = doc.data() as Record<string, unknown>;
            const d = calificarBk(
                llaves,
                (p['avances'] ?? {}) as Record<string, string>,
                p['marcadores'] as Record<string, { local: number; visitante: number }> | undefined,
                puntaje,
            );
            return { uid: doc.id, alias: String(p['alias'] ?? 'jugador'), puntos: d.total, d };
        });

        tabla.sort((x, y) => compararBk({ puntos: x.puntos, d: x.d }, { puntos: y.puntos, d: y.d }));

        // Guardar puntos y repartir premios por posición.
        const batch = db.batch();
        tabla.forEach((jug, i) => {
            const premio = i < reparto.length ? Math.round((bolsa * reparto[i]) / 100) : 0;
            batch.update(ref.collection('pronosticos').doc(jug.uid), {
                puntos: jug.puntos,
                posicion: i + 1,
                premio,
                estado: 'calificado',
            });
            if (premio > 0) {
                batch.set(
                    db.doc(`users/${jug.uid}`),
                    {
                        puntos: FieldValue.increment(premio),
                        puntosHistoricos: FieldValue.increment(premio),
                        totalGanado: FieldValue.increment(premio),
                    },
                    { merge: true },
                );
                // Todo movimiento de puntos queda en el ledger.
                batch.set(db.collection('ledger').doc(), {
                    uid: jug.uid,
                    tipo: 'bracket-premio',
                    monto: premio,
                    detalle: `Premio de ${String(b['nombre'] ?? 'eliminatoria')} (${i + 1}° lugar)`,
                    bracketId,
                    createdAt: FieldValue.serverTimestamp(),
                });
            }
        });

        batch.update(ref, {
            premioPagado: bolsa,
            ganadorAlias: tabla[0]?.alias ?? null,
        });

        await batch.commit();

        // El campeón (primer lugar) suma un torneo ganado y recibe su trofeo,
        // igual que quien gana un survivor o una quiniela. Solo el 1° lugar.
        const campeon = tabla[0];
        if (campeon) {
            const premioCampeon = reparto.length > 0 ? Math.round((bolsa * reparto[0]) / 100) : 0;
            await registrarTrofeos(
                [{ uid: campeon.uid, alias: campeon.alias }],
                bracketId,
                String(b['nombre'] ?? 'Eliminatoria'),
                String(b['competicion'] ?? b['nombre'] ?? 'Eliminatoria'),
                premioCampeon,
                false,
            );
        }

        // Avisar a los premiados.
        for (let i = 0; i < Math.min(reparto.length, tabla.length); i++) {
            const jug = tabla[i];
            const premio = Math.round((bolsa * reparto[i]) / 100);
            if (premio > 0) {
                await avisar(
                    [jug.uid],
                    `🏆 <b>${String(b['nombre'] ?? 'Eliminatoria')}</b>\n` +
                    `Quedaste en ${i + 1}° lugar con ${jug.puntos} pts.\n` +
                    `Ganaste ${premio} pts. ¡Felicidades!`,
                    'torneosInscritos',
                    `/eliminatorias/${bracketId}`,
                );
            }
        }

        return { ok: true, calificados: tabla.length };
    },
);

/* ============================================================
   BRACKETS — cierre automático
   Cuando llega la hora de cierre, el bracket pasa de 'inscripcion'
   a 'en-curso' solo, sin que nadie lo toque. A partir de ahí ya no
   se aceptan ni cambian pronósticos.
   ============================================================ */
/**
 * MODO DUEÑOS — avisa al creador si un bracket cierra pronto y todavía
 * hay participantes que no han aceptado. Corre cada hora y avisa una sola
 * vez por bracket (marca 'avisadoPendientes').
 */
export const avisarDuenosPendientes = onSchedule(
    { schedule: cada(60), timeZone: 'America/Mexico_City', secrets: [telegramToken] },
    async () => {
        const ahora = Timestamp.now();
        const enTresHoras = Timestamp.fromMillis(ahora.toMillis() + 3 * 60 * 60 * 1000);

        const brackets = await db
            .collection('brackets')
            .where('estado', '==', 'inscripcion')
            .where('cierraAt', '<=', enTresHoras)
            .get();

        for (const d of brackets.docs) {
            const b = d.data() as Record<string, unknown>;
            if (b['modo'] !== 'duenos' || b['avisadoPendientes'] === true) continue;

            const duenos = (b['duenos'] as DuenoBk[] | undefined) ?? [];
            const faltan = duenos.filter((dn) => dn.uid && dn.estado === 'invitado');
            const creadoPor = String(b['creadoPor'] ?? '');
            if (faltan.length === 0 || !creadoPor) continue;

            const nombres = faltan.map((f) => `${f.nombre} (${f.equipo})`).join(', ');
            await avisar(
                [creadoPor],
                `⏰ <b>${String(b['nombre'] ?? 'Eliminatoria')}</b>\n` +
                `Cierra pronto y faltan ${faltan.length} por aceptar: ${nombres}.\n` +
                `Al cerrar se les cobrará automáticamente (o se libera su equipo si no tienen puntos).`,
                undefined,
                '/admin/brackets',
            );
            await d.ref.update({ avisadoPendientes: true });
        }
    },
);

export const cerrarBrackets = onSchedule(
    { schedule: cada(15), timeZone: 'America/Mexico_City', secrets: [telegramToken] },
    async () => {
        const ahora = Timestamp.now();

        const pendientes = await db
            .collection('brackets')
            .where('estado', '==', 'inscripcion')
            .where('cierraAt', '<=', ahora)
            .get();

        if (pendientes.empty) {
            logger.info('Sin eliminatorias por cerrar.');
            return;
        }

        for (const d of pendientes.docs) {
            const b = d.data() as Record<string, unknown>;

            // En modo dueños, antes de arrancar cobramos a los que no respondieron.
            if (b['modo'] === 'duenos') {
                await cobrarDuenosPendientes(d.ref, b);
            }

            await d.ref.update({ estado: 'en-curso' });
        }

        logger.info(`Cerradas ${pendientes.size} eliminatorias.`);
    },
);

/**
 * MODO DUEÑOS — al cerrar, a quienes no aceptaron ni rechazaron se les
 * cobra igual (ya tenían el equipo apartado). Si no les alcanzan los
 * puntos, se les quita el equipo (queda sin dueño). Los que ya aceptaron
 * no se tocan.
 */
async function cobrarDuenosPendientes(
    ref: FirebaseFirestore.DocumentReference,
    b: Record<string, unknown>,
): Promise<void> {
    const duenos = (b['duenos'] as DuenoBk[] | undefined) ?? [];
    const costo = Number(b['costoEntrada'] ?? 0);
    const pendientes = duenos.filter((dn) => dn.uid && dn.estado === 'invitado');
    if (pendientes.length === 0) return;

    const finales: DuenoBk[] = [];
    // Empezamos con los que no están pendientes (aceptados o invitados externos).
    for (const dn of duenos) {
        if (!(dn.uid && dn.estado === 'invitado')) finales.push(dn);
    }

    let sumaBolsa = 0;
    for (const dn of pendientes) {
        const uid = dn.uid as string;
        const userRef = db.doc(`users/${uid}`);
        const cobrado = await db.runTransaction(async (tx) => {
            if (costo <= 0) return true; // gratis: se queda dentro sin cobro.
            const snap = await tx.get(userRef);
            const puntos = Number((snap.data() as Record<string, unknown>)?.['puntos'] ?? 0);
            if (puntos - costo < TOPE_INFERIOR) return false; //sin saldo: se le quita el equipo.
            tx.update(userRef, {
                puntos: FieldValue.increment(-costo),
                totalGastado: FieldValue.increment(costo),
            });
            // Todo movimiento de puntos queda en el ledger.
            tx.set(db.collection('ledger').doc(), {
                uid,
                tipo: 'bracket-entrada',
                monto: -costo,
                saldoDespues: puntos - costo,
                detalle: `Entrada a ${String(b['nombre'] ?? 'eliminatoria')} (${dn.equipo})`,
                bracketId: ref.id,
                createdAt: FieldValue.serverTimestamp(),
            });
            return true;
        });

        if (cobrado) {
            finales.push({ ...dn, estado: 'aceptado' });
            sumaBolsa += costo;
            await avisar(
                [uid],
                `⚽ <b>${String(b['nombre'] ?? 'Eliminatoria')}</b>\n` +
                `El torneo arrancó con tu equipo ${dn.equipo}.` +
                (costo > 0 ? ` Se te cobró la entrada de ${costo} pts.` : ''),
                'torneosInscritos',
                `/eliminatorias/${ref.id}`,
            );
        } else {
            // Sin saldo: se libera el equipo y se saca de su lista.
            await db.doc(`users/${uid}`).set({ brackets: FieldValue.arrayRemove(ref.id) }, { merge: true });
            await avisar(
                [uid],
                `⚠️ <b>${String(b['nombre'] ?? 'Eliminatoria')}</b>\n` +
                `No tenías puntos para la entrada, así que quedaste fuera y ${dn.equipo} se liberó.`,
                'torneosInscritos',
            );
        }
    }

    await ref.update({ duenos: finales, bolsa: FieldValue.increment(sumaBolsa) });
}

/**
 * Datos públicos de una eliminatoria a partir de su código de invitación.
 * Igual que consultarTorneo: permite mostrar nombre y reglas antes de aceptar,
 * incluso a quien aún no tiene cuenta.
 */
export const consultarBracket = onCall(opcionesCall, async (req) => {
    const codigo = String(req.data?.codigo ?? '').trim().toUpperCase();
    if (!codigo) throw new HttpsError('invalid-argument', 'Falta el código.');

    const encontrados = await db
        .collection('brackets')
        .where('codigo', '==', codigo)
        .limit(1)
        .get();
    if (encontrados.empty) {
        throw new HttpsError('not-found', 'Ese código de invitación no existe.');
    }

    const doc = encontrados.docs[0];
    const b = doc.data() as Record<string, unknown>;

    // Si la eliminatoria es de un grupo, solo un miembro puede ver sus detalles.
    const grupoId = b['grupoId'];
    if (typeof grupoId === 'string' && grupoId) {
        const uid = req.auth?.uid;
        const esMiembro = uid
            ? (await db.doc(`grupos/${grupoId}/miembros/${uid}`).get()).exists
            : false;
        if (!esMiembro) {
            throw new HttpsError(
                'permission-denied',
                'Esta eliminatoria es de un grupo privado. Únete al grupo para poder verla.',
            );
        }
    }

    const config = (b['config'] ?? {}) as Record<string, unknown>;

    return {
        ok: true,
        id: doc.id,
        nombre: String(b['nombre'] ?? 'Eliminatoria'),
        modo: String(b['modo'] ?? 'pronostico'),
        equipos: Number(config['equipos'] ?? 0),
        avance: String(config['avance'] ?? 'fijo'),
        formatoRondas: String(config['formatoRondas'] ?? 'unico'),
        costoEntrada: Number(b['costoEntrada'] ?? 0),
        estado: String(b['estado'] ?? 'inscripcion'),
    };
});
