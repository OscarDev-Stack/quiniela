import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import * as logger from 'firebase-functions/logger';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import { nombreOficial as nombreOficialEquipo } from './equipos';

initializeApp();

/* ============================================================
   Entorno: en dev los schedulers corren al DOBLE del intervalo de
   prod (más espaciados, para no saturar el proyecto de pruebas),
   pero siguen corriendo. En prod usan su intervalo normal.
   ============================================================ */
const PROYECTO_PROD = 'quinelav1-e23eb';
const esProd = process.env.GCLOUD_PROJECT === PROYECTO_PROD;

/**
 * Devuelve el schedule de un job: en prod, cada `minutos`; en dev, cada
 * `minutos * 2`. Así el mismo código sirve para ambos entornos sin tener
 * intervalos fijos regados por el archivo.
 */
const cada = (minutos: number): string => {
    const m = esProd ? minutos : minutos * 2;
    return `every ${m} minutes`;
};

const db = getFirestore();

const APUESTA_BASE = 100;
const TOPE_INFERIOR = -1000;
const MULTIPLICADOR_MAX = 5;
/** Pronósticos por lote (el límite de Firestore es 500 operaciones). */
const PRONOSTICOS_POR_LOTE = 150;
/** Mínimo de pronósticos resueltos para calificar al ranking por %. */
const MIN_RESUELTOS = 1;

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
function calcularBote(monto: number, porcentaje: unknown): number {
    const pct = Number(porcentaje ?? 0);
    if (!pct || pct <= 0 || monto <= 0) return 0;
    return Math.floor((monto * pct) / 100);
}

/** Suma al bote (fuera de transacción) y deja constancia en el ledger. */
async function registrarBote(monto: number, origen: string): Promise<void> {
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
/** Secret Key de Cloudflare Turnstile. Se configura con:
 *  firebase functions:secrets:set TURNSTILE_SECRET_KEY */
const turnstileSecret = defineSecret('TURNSTILE_SECRET_KEY');
/** Key de TheSportsDB (premium). Se configura con:
 *  firebase functions:secrets:set SPORTSDB_KEY
 *  Debe declararse en cada función que consulte TheSportsDB. */
const sportsDbKey = defineSecret('SPORTSDB_KEY');

const API_BASE = 'https://api.football-data.org/v4';

/** URL base de TheSportsDB para una key dada. */
const sportsDbBase = (key: string): string =>
    `https://www.thesportsdb.com/api/v1/json/${(key ?? '').trim() || '123'}`;

/** Un evento (partido) de TheSportsDB, con los campos que usamos. */
interface EventoSportsDb {
    idEvent?: string;
    intRound?: string;
    strHomeTeam?: string;
    strAwayTeam?: string;
    idHomeTeam?: string;
    idAwayTeam?: string;
    strLeague?: string;
    intHomeScore?: string | null;
    intAwayScore?: string | null;
    strTimestamp?: string;
    strStatus?: string;
    strProgress?: string;
    strPostponed?: string;
}

/**
 * Ligas soportadas por el buscador de partidos de TheSportsDB. La clave es un
 * código corto que usa el front; el valor es el id de liga de TheSportsDB y su
 * nombre visible. Cubrimos las mismas que football-data (menos Brasileirão) y
 * agregamos Liga MX.
 */
const LIGAS_SPORTSDB: Record<string, { id: number; nombre: string }> = {
    LIGAMX: { id: 4350, nombre: 'Liga MX' },
    CL: { id: 4480, nombre: 'Champions League' },
    PL: { id: 4328, nombre: 'Premier League' },
    PD: { id: 4335, nombre: 'LaLiga' },
    SA: { id: 4332, nombre: 'Serie A' },
    BL1: { id: 4331, nombre: 'Bundesliga' },
    FL1: { id: 4334, nombre: 'Ligue 1' },
    // EC (Eurocopa): torneo de selecciones inactivo la mayor parte del tiempo;
    // se deja fuera hasta poder confirmar su id cuando haya edición en curso.
};

/**
 * Trae los partidos de UNA jornada (ronda) de una liga de TheSportsDB.
 *
 * Usa el endpoint `eventsround`, que devuelve la jornada completa. NO se usa
 * `eventsseason` porque con la key gratuita esa respuesta viene truncada (solo
 * las primeras jornadas), lo que hacía que jornadas altas parecieran vacías.
 */
async function eventosRondaSportsDb(
    ligaId: number,
    ronda: number,
    temporada: string,
    key: string,
): Promise<EventoSportsDb[]> {
    const url =
        `${sportsDbBase(key)}/eventsround.php?id=${ligaId}&r=${ronda}&s=${encodeURIComponent(temporada)}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new HttpsError('internal', `TheSportsDB respondió ${res.status}.`);
    }
    const data = (await res.json()) as { events?: EventoSportsDb[] | null };
    return data.events ?? [];
}

/** Una fila de la tabla de posiciones tal como la devuelve TheSportsDB. */
interface StandingSportsDb {
    intRank?: string;
    strTeam?: string;
    intPlayed?: string;
    intWin?: string;
    intDraw?: string;
    intLoss?: string;
    intGoalsFor?: string;
    intGoalsAgainst?: string;
    intGoalDifference?: string;
    intPoints?: string;
    strForm?: string;
    strDescription?: string;
}

/** Fila de tabla ya normalizada, como la guardamos en Firestore. */
interface FilaTablaLiga {
    posicion: number;
    equipo: string; // nombre oficial (normalizado)
    jugados: number;
    ganados: number;
    empatados: number;
    perdidos: number;
    golesFavor: number;
    golesContra: number;
    diferencia: number;
    puntos: number;
    /* Racha reciente tipo "WDWLD" (más reciente al final). */
    forma: string;
    /* Zona: "Playoffs", "Relegation"... viene de la API. Vacío si no trae. */
    zona: string;
}

/**
 * Trae la tabla de posiciones de una liga/temporada de TheSportsDB y la
 * devuelve normalizada. Los nombres de equipo pasan por nombreOficialEquipo
 * para que calcen con los escudos del catálogo. Devuelve [] si no hay datos.
 */
async function tablaLigaSportsDb(
    ligaId: number,
    temporada: string,
    key: string,
): Promise<FilaTablaLiga[]> {
    const url =
        `${sportsDbBase(key)}/lookuptable.php?l=${ligaId}&s=${encodeURIComponent(temporada)}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new HttpsError('internal', `TheSportsDB respondió ${res.status}.`);
    }
    const data = (await res.json()) as { table?: StandingSportsDb[] | null };
    const filas = data.table ?? [];

    return filas.map((f, i) => ({
        posicion: Number(f.intRank ?? i + 1),
        equipo: nombreOficialEquipo(f.strTeam ?? ''),
        jugados: Number(f.intPlayed ?? 0),
        ganados: Number(f.intWin ?? 0),
        empatados: Number(f.intDraw ?? 0),
        perdidos: Number(f.intLoss ?? 0),
        golesFavor: Number(f.intGoalsFor ?? 0),
        golesContra: Number(f.intGoalsAgainst ?? 0),
        diferencia: Number(f.intGoalDifference ?? 0),
        puntos: Number(f.intPoints ?? 0),
        forma: String(f.strForm ?? ''),
        zona: String(f.strDescription ?? ''),
    }));
}

/**
 * Refresca la tabla de posiciones de una competición vinculada a la API y la
 * guarda en su documento (`tabla` + `tablaActualizada`). No lanza si la
 * competición no está vinculada o la API no trae datos: simplemente no hace
 * nada. Devuelve cuántas filas quedaron guardadas.
 */
async function refrescarTablaCompeticion(
    compRef: FirebaseFirestore.DocumentReference,
    comp: Record<string, unknown>,
    key: string,
): Promise<number> {
    const ligaId = Number(comp['apiLigaId'] ?? 0);
    const temporada = String(comp['apiTemporada'] ?? '');
    if (!ligaId || !temporada) return 0;

    const tabla = await tablaLigaSportsDb(ligaId, temporada, key);
    if (tabla.length === 0) return 0;

    await compRef.set(
        { tabla, tablaActualizada: FieldValue.serverTimestamp() },
        { merge: true },
    );
    return tabla.length;
}

/** Convierte el resultado de la API (marcador) al formato de la jornada. */
function resultadoDesdeMarcador(
    gl: number | null,
    gv: number | null,
): 'local' | 'empate' | 'visitante' | null {
    if (gl === null || gv === null) return null;
    if (gl > gv) return 'local';
    if (gl < gv) return 'visitante';
    return 'empate';
}

/** Un partido de jornada tras cruzar con la API (puede traer marcador o no). */
interface PartidoJornadaApi {
    local: string;
    visitante: string;
    resultado?: 'local' | 'empate' | 'visitante' | 'pospuesto' | null;
    golesLocal?: number | null;
    golesVisitante?: number | null;
}

/**
 * Cruza los partidos de una jornada con los eventos de la API y devuelve los
 * mismos partidos con su marcador precargado (solo los que ya terminaron; los
 * aplazados quedan como 'pospuesto'). Empareja por par de equipos normalizados.
 * NO resuelve nada: solo precarga. Lo usan la función manual (traerResultadosApi)
 * y el scheduler automático.
 */
function cruzarResultadosJornada(
    partidos: Array<{ local: string; visitante: string }>,
    eventos: EventoSportsDb[],
): { conResultado: number; partidos: PartidoJornadaApi[] } {
    // Índice por par de equipos normalizados -> evento de la API.
    const clave = (local: string, visitante: string) =>
        `${nombreOficialEquipo(local)}|${nombreOficialEquipo(visitante)}`;
    const porPar = new Map<string, EventoSportsDb>();
    for (const e of eventos) porPar.set(clave(e.strHomeTeam ?? '', e.strAwayTeam ?? ''), e);

    let conResultado = 0;
    const salida = partidos.map((p): PartidoJornadaApi => {
        const e = porPar.get(clave(p.local, p.visitante));
        if (!e) return { ...p };

        // Aplazado en la API: lo marcamos como pospuesto.
        if (e.strPostponed === 'yes') {
            conResultado++;
            return { ...p, resultado: 'pospuesto', golesLocal: null, golesVisitante: null };
        }

        // Solo tomamos el marcador si el partido ya terminó (FT / AET / PEN...).
        const terminado = ['FT', 'AET', 'PEN', 'Match Finished'].includes(String(e.strStatus ?? ''));
        const gl = e.intHomeScore != null && e.intHomeScore !== '' ? Number(e.intHomeScore) : null;
        const gv = e.intAwayScore != null && e.intAwayScore !== '' ? Number(e.intAwayScore) : null;
        if (!terminado || gl === null || gv === null) return { ...p };

        conResultado++;
        return { ...p, golesLocal: gl, golesVisitante: gv, resultado: resultadoDesdeMarcador(gl, gv) };
    });

    return { conResultado, partidos: salida };
}

interface PartidoApi {
    id: number;
    utcDate: string;
    status: string;
    homeTeam: { id?: number; name: string; shortName?: string };
    awayTeam: { id?: number; name: string; shortName?: string };
    score: { winner?: string | null; fullTime: { home: number | null; away: number | null } };
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
 * Reparte los premios de un partido y lo marca como liquidado. La usan
 * tanto el admin (liquidarPartido) como el cierre automático por API
 * (revisarResultados). Idempotente: si ya está liquidado, no repite.
 */
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

async function ejecutarLiquidacion(
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

    return {
        ok: true,
        participantes: pronosticos.length,
        ganadores: ganadores.length,
        bolsa,
        sobrante,
    };
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
        const totalGastado = Number(u['totalGastado'] ?? 0);
        const totalGanado = Number(u['totalGanado'] ?? 0);
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
            totalGastado,
            totalGanado,
            balance: totalGanado - totalGastado,
            actualizado: FieldValue.serverTimestamp(),
        });
        escritos++;
    });

    await batch.commit();
    return { ok: true, jugadores: escritos };
});

/* ============================================================
   BACKFILL de totales gastado/ganado (admin, una sola vez)
   Recorre TODO el ledger y reconstruye totalGastado y totalGanado
   por usuario, para las cuentas que ya existían antes de que se
   empezaran a acumular estos campos. Luego regenera el ranking.
   Idempotente: siempre parte de cero y reescribe el total exacto.
   ============================================================ */
export const backfillTotales = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) throw new HttpsError('permission-denied', 'Solo un administrador.');

    // Tipos que cuentan como GANANCIA (premios reales).
    const TIPOS_GANADO = new Set(['premio', 'torneo-premio', 'bracket-premio']);
    // Tipos que afectan el GASTO. El signo del monto ya lo resuelve la fórmula
    // (gasto = -monto): en apuestas/entradas el monto es negativo (suma gasto),
    // en devoluciones el monto es positivo (resta gasto).
    const TIPOS_GASTO = new Set([
        'apuesta',
        'apuesta-edicion',
        'torneo-entrada',
        'torneo-revivir',
        'bracket-entrada',
        'devolucion',
        'devolucion-cancelacion',
        'torneo-devolucion',
    ]);

    const totales = new Map<string, { gastado: number; ganado: number }>();
    const acc = (u: string) => {
        let t = totales.get(u);
        if (!t) {
            t = { gastado: 0, ganado: 0 };
            totales.set(u, t);
        }
        return t;
    };

    // Recorre el ledger por páginas para no cargar todo en memoria de golpe.
    const PAGINA = 2000;
    let ultimo: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    for (;;) {
        let q = db.collection('ledger').orderBy('__name__').limit(PAGINA);
        if (ultimo) q = q.startAfter(ultimo);
        const snap = await q.get();
        if (snap.empty) break;

        for (const d of snap.docs) {
            const m = d.data() as Record<string, unknown>;
            const u = String(m['uid'] ?? '');
            // Movimientos del sistema (reserva) y ajustes de admin no cuentan.
            if (!u || u === 'reserva') continue;
            const tipo = String(m['tipo'] ?? '');
            const monto = Number(m['monto'] ?? 0);

            if (TIPOS_GANADO.has(tipo)) {
                acc(u).ganado += monto;
            } else if (TIPOS_GASTO.has(tipo)) {
                // gasto = -monto (monto negativo suma; positivo/devolución resta)
                acc(u).gastado += -monto;
            }
            // 'reinicio', 'bote', 'sobrante' y otros se ignoran.
        }

        ultimo = snap.docs[snap.docs.length - 1];
        if (snap.size < PAGINA) break;
    }

    // Escribe los totales en cada usuario, en lotes.
    const entradas = [...totales.entries()];
    let escritos = 0;
    for (let i = 0; i < entradas.length; i += 400) {
        const batch = db.batch();
        for (const [u, t] of entradas.slice(i, i + 400)) {
            batch.set(
                db.doc(`users/${u}`),
                { totalGastado: Math.max(0, t.gastado), totalGanado: Math.max(0, t.ganado) },
                { merge: true },
            );
            escritos++;
        }
        await batch.commit();
    }

    // Regenera el ranking para que las nuevas columnas queden reflejadas.
    const users = await db.collection('users').get();
    const rank = db.batch();
    users.docs.forEach((d) => {
        const uu = d.data();
        if (uu['validada'] !== true || uu['noParticipa'] === true) {
            rank.delete(db.doc(`ranking/${d.id}`));
            return;
        }
        const resueltos = Number(uu['resueltos'] ?? 0);
        const aciertos = Number(uu['aciertos'] ?? 0);
        const email = String(uu['email'] ?? '');
        const totalGastado = Number(uu['totalGastado'] ?? 0);
        const totalGanado = Number(uu['totalGanado'] ?? 0);
        rank.set(db.doc(`ranking/${d.id}`), {
            alias: String(uu['alias'] ?? '').trim() || email.split('@')[0] || 'jugador',
            puntos: Number(uu['puntosHistoricos'] ?? uu['puntos'] ?? 0),
            saldo: Number(uu['puntos'] ?? 0),
            torneosGanados: Number(uu['torneosGanados'] ?? 0),
            aciertos,
            resueltos,
            porcentaje: resueltos > 0 ? Math.round((aciertos / resueltos) * 100) : 0,
            calificado: resueltos >= MIN_RESUELTOS,
            racha: Number(uu['racha'] ?? 0),
            mejorRacha: Number(uu['mejorRacha'] ?? 0),
            totalGastado,
            totalGanado,
            balance: totalGanado - totalGastado,
            actualizado: FieldValue.serverTimestamp(),
        });
    });
    await rank.commit();

    return { ok: true, usuarios: escritos };
});

/* ============================================================
   REINICIO DE SALDO (admin)
   Pone el saldo del jugador en 0 y DEJA CONSTANCIA en el ledger
   del ajuste, para que el historial no tenga huecos. Todo en una
   transacción: o se hacen las dos cosas o ninguna.
   ============================================================ */
export const reiniciarPuntos = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) {
        throw new HttpsError('permission-denied', 'Solo un administrador.');
    }

    const objetivo = String((req.data as { uid?: string })?.uid ?? '');
    if (!objetivo) {
        throw new HttpsError('invalid-argument', 'Falta el jugador a reiniciar.');
    }

    const ajuste = await db.runTransaction(async (tx) => {
        const userRef = db.doc(`users/${objetivo}`);
        const snap = await tx.get(userRef);
        if (!snap.exists) {
            throw new HttpsError('not-found', 'No existe ese jugador.');
        }
        const saldoAntes = Number(snap.data()?.['puntos'] ?? 0);

        // El ajuste es lo que se suma/resta para llegar a 0. Si tenía -300,
        // el ajuste es +300; si tenía +500, es -500.
        const delta = -saldoAntes;

        tx.update(userRef, { puntos: 0, bloqueado: false });

        // Solo se registra si de verdad hubo cambio de saldo.
        if (delta !== 0) {
            tx.set(db.collection('ledger').doc(), {
                uid: objetivo,
                tipo: 'reinicio',
                monto: delta,
                saldoAntes,
                detalle: 'Reinicio de saldo por administrador',
                porAdmin: uid,
                createdAt: FieldValue.serverTimestamp(),
            });
        }

        return { saldoAntes, delta };
    });

    return { ok: true, ...ajuste };
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
            homeTeamId: p.homeTeam.id ?? null,
            awayTeamId: p.awayTeam.id ?? null,
            competition: p.competition?.name ?? competicion,
        })),
    };
});

/**
 * Próximos partidos de una liga de TheSportsDB (eventsnextleague). Devuelve
 * los eventos que aún no han empezado, con equipos, ids y hora. Lanza si la
 * API responde con error.
 */
async function eventosProximosLigaSportsDb(
    ligaId: number,
    key: string,
): Promise<EventoSportsDb[]> {
    const url = `${sportsDbBase(key)}/eventsnextleague.php?id=${ligaId}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new HttpsError('internal', `TheSportsDB respondió ${res.status}.`);
    }
    const data = (await res.json()) as { events?: EventoSportsDb[] | null };
    return data.events ?? [];
}

/* ============================================================
   TheSportsDB — buscar próximos partidos de una liga
   El admin elige una liga soportada y crea el partido con un clic.
   Convive con buscarFixtures (football-data); la meta es migrar todo
   a esta fuente cuando se extienda la suscripción.
   ============================================================ */
export const buscarFixturesSportsDb = onCall(
    { ...opcionesCall, secrets: [sportsDbKey] },
    async (req) => {
        const uid = req.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
        const adminSnap = await db.doc(`admins/${uid}`).get();
        if (!adminSnap.exists) throw new HttpsError('permission-denied', 'Solo un administrador.');

        const liga = String(req.data?.liga ?? '');
        const cfg = LIGAS_SPORTSDB[liga];
        if (!cfg) throw new HttpsError('invalid-argument', 'Liga no soportada.');

        const eventos = await eventosProximosLigaSportsDb(cfg.id, sportsDbKey.value());
        const ahora = Date.now();

        const partidos = eventos
            // Solo los que no han empezado y tienen hora futura.
            .filter((e) => {
                if (e.strStatus && e.strStatus !== 'NS' && e.strStatus !== '') return false;
                const ts = e.strTimestamp ? new Date(e.strTimestamp).getTime() : 0;
                return ts > ahora;
            })
            .map((e) => ({
                apiEventId: String(e.idEvent ?? ''),
                fecha: e.strTimestamp ?? '',
                homeTeam: nombreOficialEquipo(e.strHomeTeam),
                awayTeam: nombreOficialEquipo(e.strAwayTeam),
                homeTeamId: e.idHomeTeam ?? null,
                awayTeamId: e.idAwayTeam ?? null,
                ronda: e.intRound ?? '',
                competition: e.strLeague || cfg.nombre,
            }))
            .filter((p) => p.apiEventId && p.homeTeam && p.awayTeam)
            .sort((a, b) => a.fecha.localeCompare(b.fecha));

        return { ok: true, liga: cfg.nombre, partidos };
    },
);

/**
 * Forma reciente (ultimos partidos terminados) de un equipo de football-data,
 * como texto tipo "WWDLW" (mas reciente al final). Devuelve '' si no hay datos
 * o el recurso no esta disponible en el plan; nunca lanza, para no romper la
 * creacion del partido por un extra informativo.
 */
async function formaEquipoFootballData(teamId: number, key: string): Promise<string> {
    if (!teamId) return '';
    try {
        const res = await fetch(
            `${API_BASE}/teams/${teamId}/matches?status=FINISHED&limit=5`,
            { headers: { 'X-Auth-Token': (key ?? '').trim() } },
        );
        if (!res.ok) return '';
        const data = (await res.json()) as { matches?: PartidoApi[] };
        const partidos = (data.matches ?? []).slice(-5);

        return partidos
            .map((m) => {
                const w = m.score?.winner;
                if (w === 'DRAW') return 'D';
                const gano = w === 'HOME_TEAM' ? m.homeTeam.id : w === 'AWAY_TEAM' ? m.awayTeam.id : null;
                if (gano == null) return '';
                return gano === teamId ? 'W' : 'L';
            })
            .join('');
    } catch {
        return '';
    }
}

/* ============================================================
   Forma reciente de dos equipos (football-data)
   El admin la pide UNA vez al crear el partido; se guarda en el
   doc y no se vuelve a consultar. Solo informativa.
   ============================================================ */
export const formaEquiposApi = onCall(
    { ...opcionesCall, secrets: [footballDataKey] },
    async (req) => {
        const uid = req.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
        const adminSnap = await db.doc(`admins/${uid}`).get();
        if (!adminSnap.exists) throw new HttpsError('permission-denied', 'Solo un administrador.');

        const homeId = Math.floor(Number(req.data?.homeTeamId ?? 0));
        const awayId = Math.floor(Number(req.data?.awayTeamId ?? 0));
        const key = footballDataKey.value();

        const [formaLocal, formaVisitante] = await Promise.all([
            formaEquipoFootballData(homeId, key),
            formaEquipoFootballData(awayId, key),
        ]);

        return { ok: true, formaLocal, formaVisitante };
    },
);

/* ============================================================
   Revisar resultados en la API
   Solo consulta si hay partidos en juego y ya pasó el tiempo
   razonable de duración. Precarga el resultado para que el
   administrador lo confirme.
   ============================================================ */
export const revisarResultados = onSchedule(
    { schedule: cada(15), secrets: [footballDataKey] },
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

            // La API confirmó el resultado final: liquidamos solos, sin esperar
            // al admin. Solo aplica a partidos de API (el filtro exige apiFixtureId).
            // Si algo falla, dejamos el resultado propuesto para que el admin revise.
            try {
                await ejecutarLiquidacion(d.id, resultado);
                console.log(`Liquidado automático ${d.id}: ${local}-${visitante} → ${resultado}`);
            } catch (e) {
                logger.warn(`No se pudo liquidar ${d.id} automáticamente; queda para el admin.`, e);
                await d.ref.update({
                    resultadoPropuesto: resultado,
                    marcadorPropuesto: `${local}-${visitante}`,
                    propuestoAt: FieldValue.serverTimestamp(),
                    alertaApi: 'La liquidación automática falló. Revísalo y liquida a mano.',
                });
            }
        }
    },
);

/**
 * Lee un evento de TheSportsDB por su idEvent (lookupevent). Devuelve null si
 * no existe o la API falla; nunca lanza.
 */
async function lookupEventoSportsDb(idEvent: string, key: string): Promise<EventoSportsDb | null> {
    try {
        const res = await fetch(`${sportsDbBase(key)}/lookupevent.php?id=${idEvent}`);
        if (!res.ok) return null;
        const data = (await res.json()) as { events?: EventoSportsDb[] | null };
        return data.events?.[0] ?? null;
    } catch {
        return null;
    }
}

/* ============================================================
   Revisar resultados en TheSportsDB (partidos con apiEventId)
   Equivalente a revisarResultados pero para partidos creados con
   el buscador de TheSportsDB. Precarga/liquida los que ya terminaron.
   Nada crítico depende de esto: si falla, el admin liquida a mano.
   ============================================================ */
export const revisarResultadosSportsDb = onSchedule(
    { schedule: cada(15), timeZone: 'America/Mexico_City', secrets: [sportsDbKey] },
    async () => {
        const snap = await db.collection('partidos').where('status', '==', 'en-juego').get();
        if (snap.empty) return;

        const ahora = Date.now();
        const candidatos = snap.docs.filter((d) => {
            const p = d.data();
            if (p['liquidado'] === true) return false;
            if (p['resultadoPropuesto']) return false;
            if (!p['apiEventId']) return false; // solo los de TheSportsDB
            const cierre = p['closesAt'] as Timestamp | undefined;
            if (!cierre) return false;
            return ahora >= cierre.toMillis() + MINUTOS_ANTES_DE_CONSULTAR * 60 * 1000;
        });

        if (candidatos.length === 0) return;

        const terminados = ['FT', 'AET', 'PEN', 'Match Finished'];
        const key = sportsDbKey.value();

        for (const d of candidatos) {
            const p = d.data();
            const ev = await lookupEventoSportsDb(String(p['apiEventId']), key);
            if (!ev) continue;

            if (ev.strPostponed === 'yes') {
                await d.ref.update({
                    alertaApi: 'El partido aparece como aplazado en la API. Revísalo manualmente.',
                });
                continue;
            }
            if (!terminados.includes(String(ev.strStatus ?? ''))) continue;

            const local = Number(ev.intHomeScore ?? NaN);
            const visitante = Number(ev.intAwayScore ?? NaN);
            if (!Number.isFinite(local) || !Number.isFinite(visitante)) continue;

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

            // La API confirmó el final: liquidamos solos. Si falla, queda para
            // el admin (nada crítico depende de la API).
            try {
                await ejecutarLiquidacion(d.id, resultado);
                console.log(`Liquidado auto (SportsDB) ${d.id}: ${local}-${visitante} → ${resultado}`);
            } catch (e) {
                logger.warn(`No se pudo liquidar ${d.id} (SportsDB); queda para el admin.`, e);
                await d.ref.update({
                    resultadoPropuesto: resultado,
                    marcadorPropuesto: `${local}-${visitante}`,
                    propuestoAt: FieldValue.serverTimestamp(),
                    alertaApi: 'La liquidación automática falló. Revísalo y liquida a mano.',
                });
            }
        }
    },
);

/* ============================================================
   Marcador EN VIVO (TheSportsDB premium, livescore 2 min)
   Actualiza el marcador parcial y el minuto de los partidos en
   juego con apiEventId, para mostrarlo en las tarjetas. Es solo
   informativo: no liquida ni depende de esto nada crítico.
   ============================================================ */
export const actualizarMarcadoresEnVivo = onSchedule(
    { schedule: cada(3), timeZone: 'America/Mexico_City', secrets: [sportsDbKey] },
    async () => {
        const snap = await db.collection('partidos').where('status', '==', 'en-juego').get();
        if (snap.empty) return;

        // Solo partidos vivos de TheSportsDB que aún no se liquidaron.
        const candidatos = snap.docs.filter((d) => {
            const p = d.data();
            return !p['liquidado'] && !!p['apiEventId'];
        });
        if (candidatos.length === 0) return;

        const key = sportsDbKey.value();

        for (const d of candidatos) {
            const ev = await lookupEventoSportsDb(String(d.data()['apiEventId']), key);
            if (!ev) continue;

            const local = Number(ev.intHomeScore ?? NaN);
            const visitante = Number(ev.intAwayScore ?? NaN);
            // strProgress trae el minuto ("63") en partidos en curso; si no,
            // usamos el estado (ej. "HT" medio tiempo). Puede venir vacío.
            const minuto = String(ev.strProgress ?? '').trim() || String(ev.strStatus ?? '').trim();

            const cambios: Record<string, unknown> = {};
            if (Number.isFinite(local)) cambios['vivoLocal'] = local;
            if (Number.isFinite(visitante)) cambios['vivoVisitante'] = visitante;
            if (minuto) cambios['vivoMinuto'] = minuto;

            if (Object.keys(cambios).length > 0) {
                await d.ref.update(cambios).catch(() => undefined);
            }
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
   TheSportsDB — traer una jornada desde la API
   Devuelve los enfrentamientos de una jornada (intRound) con los
   equipos ya normalizados a los nombres oficiales y la hora del
   primer partido. NO guarda nada: el admin revisa y guarda con el
   flujo normal. Publicar sigue siendo manual.
   ============================================================ */
export const traerJornadaApi = onCall({ ...opcionesCall, secrets: [sportsDbKey] }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const competicionId = String(req.data?.competicionId ?? '');
    const numeroJornada = Math.floor(Number(req.data?.numeroJornada ?? 0));
    if (!competicionId || numeroJornada < 1) {
        throw new HttpsError('invalid-argument', 'Faltan la competición o el número de jornada.');
    }

    const compRef = db.doc(`competiciones/${competicionId}`);
    const [adminSnap, compSnap] = await Promise.all([
        db.doc(`admins/${uid}`).get(),
        compRef.get(),
    ]);
    if (!compSnap.exists) throw new HttpsError('not-found', 'La competición no existe.');
    const comp = compSnap.data() as Record<string, unknown>;
    const gestores = (comp['gestores'] as string[]) ?? [];
    if (!adminSnap.exists && !gestores.includes(uid)) {
        throw new HttpsError('permission-denied', 'No gestionas esta competición.');
    }

    const ligaId = Number(comp['apiLigaId'] ?? 0);
    const temporada = String(comp['apiTemporada'] ?? '');
    if (!ligaId || !temporada) {
        throw new HttpsError(
            'failed-precondition',
            'Esta competición no tiene configurada la liga y temporada de la API.',
        );
    }

    const dela = await eventosRondaSportsDb(ligaId, numeroJornada, temporada, sportsDbKey.value());
    if (dela.length === 0) {
        throw new HttpsError('not-found', `La API no tiene partidos para la jornada ${numeroJornada}.`);
    }

    // Partidos con equipos normalizados; ordenados por hora.
    const partidos = dela
        .map((e) => ({
            local: nombreOficialEquipo(e.strHomeTeam),
            visitante: nombreOficialEquipo(e.strAwayTeam),
            timestamp: e.strTimestamp ?? '',
        }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // Hora del primer partido de la jornada (en ISO UTC), para prellenar el cierre.
    const primeraHora = partidos.find((p) => p.timestamp)?.timestamp ?? '';

    return {
        ok: true,
        numeroJornada,
        primeraHora,
        partidos: partidos.map((p) => ({ local: p.local, visitante: p.visitante })),
    };
});

/* ============================================================
   TheSportsDB — traer resultados de una jornada ya guardada
   Empareja los partidos de la jornada con los de la API (por nombre
   normalizado) y devuelve el marcador de los que ya terminaron. NO
   publica: el admin captura/confirma y publica manualmente.
   ============================================================ */
export const traerResultadosApi = onCall({ ...opcionesCall, secrets: [sportsDbKey] }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const competicionId = String(req.data?.competicionId ?? '');
    const jornadaId = String(req.data?.jornadaId ?? '');
    if (!competicionId || !jornadaId) {
        throw new HttpsError('invalid-argument', 'Faltan la competición o la jornada.');
    }

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
    const comp = compSnap.data() as Record<string, unknown>;
    const gestores = (comp['gestores'] as string[]) ?? [];
    if (!adminSnap.exists && !gestores.includes(uid)) {
        throw new HttpsError('permission-denied', 'No gestionas esta competición.');
    }

    const ligaId = Number(comp['apiLigaId'] ?? 0);
    const temporada = String(comp['apiTemporada'] ?? '');
    if (!ligaId || !temporada) {
        throw new HttpsError(
            'failed-precondition',
            'Esta competición no tiene configurada la liga y temporada de la API.',
        );
    }

    const jornada = jornadaSnap.data() as {
        numero: number;
        partidos: Array<{ local: string; visitante: string }>;
    };

    const dela = await eventosRondaSportsDb(ligaId, jornada.numero, temporada, sportsDbKey.value());
    const { conResultado, partidos } = cruzarResultadosJornada(jornada.partidos, dela);

    return { ok: true, numero: jornada.numero, conResultado, partidos };
});

/* ============================================================
   TheSportsDB — refrescar la tabla de posiciones (manual)
   El admin/gestor fuerza la descarga de la tabla oficial. Se
   refresca sola al resolver cada jornada; esto cubre el arranque
   (torneo recién creado) o una actualización a demanda.
   ============================================================ */
export const refrescarTablaApi = onCall({ ...opcionesCall, secrets: [sportsDbKey] }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const competicionId = String(req.data?.competicionId ?? '');
    if (!competicionId) throw new HttpsError('invalid-argument', 'Falta la competición.');

    const compRef = db.doc(`competiciones/${competicionId}`);
    const [adminSnap, compSnap] = await Promise.all([db.doc(`admins/${uid}`).get(), compRef.get()]);
    if (!compSnap.exists) throw new HttpsError('not-found', 'La competición no existe.');

    const comp = compSnap.data() as Record<string, unknown>;
    const gestores = (comp['gestores'] as string[]) ?? [];
    if (!adminSnap.exists && !gestores.includes(uid)) {
        throw new HttpsError('permission-denied', 'No gestionas esta competición.');
    }
    if (!comp['apiLigaId'] || !comp['apiTemporada']) {
        throw new HttpsError(
            'failed-precondition',
            'Esta competición no tiene configurada la liga y temporada de la API.',
        );
    }

    const filas = await refrescarTablaCompeticion(compRef, comp, sportsDbKey.value());
    if (filas === 0) {
        throw new HttpsError('not-found', 'La API no devolvió tabla para esta liga/temporada.');
    }
    return { ok: true, filas };
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
        return { ok: true, ganadores: cierre.uids.length, premioPorCabeza: Number(t['bolsa'] ?? 0) };
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

/* ============================================================
   Cambiar mi alias (nombre público)
   El usuario no puede escribir su propio documento (las reglas solo
   dejan al admin), así que el cambio pasa por aquí. Se propaga al
   ranking para que el nombre nuevo se vea de inmediato.
   ============================================================ */
export const cambiarAlias = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const alias = String(req.data?.alias ?? '').trim();
    if (alias.length < 3) {
        throw new HttpsError('invalid-argument', 'El alias debe tener al menos 3 caracteres.');
    }
    if (alias.length > 20) {
        throw new HttpsError('invalid-argument', 'El alias no puede pasar de 20 caracteres.');
    }

    const userRef = db.doc(`users/${uid}`);
    const snap = await userRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'No encontramos tu perfil.');

    await userRef.update({ alias });
    // Refresca la fila del ranking para que el alias nuevo aparezca ya.
    await actualizarRanking([uid]);

    // Propaga el alias a los grupos del usuario. El alias se copia en cada
    // grupo (miembros y tabla) al inscribirse, así que hay que actualizarlo
    // ahí también; si no, seguiría apareciendo el nombre viejo en los grupos.
    const grupos = (snap.data()?.['grupos'] as string[] | undefined) ?? [];
    for (const grupoId of grupos) {
        // Miembro: siempre existe si el usuario pertenece al grupo. merge para
        // no pisar el resto de sus campos (rol, entradaAt).
        await db
            .doc(`grupos/${grupoId}/miembros/${uid}`)
            .set({ alias }, { merge: true })
            .catch(() => undefined);
        // Tabla: puede no existir aún (si no ha jugado en el grupo). Usamos
        // update para NO crearla vacía; si no existe, el catch lo ignora.
        await db
            .doc(`grupos/${grupoId}/tabla/${uid}`)
            .update({ alias })
            .catch(() => undefined);
    }

    return { ok: true, alias };
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

/**
 * Envía una notificación push a los dispositivos de un usuario vía FCM.
 * Limpia los tokens que el servicio reporte como inválidos (dispositivos
 * viejos o permisos revocados), para no acumular basura.
 */
/** Quita las etiquetas HTML (que usa Telegram) para las notificaciones push. */
function limpiarHtml(texto: string): string {
    return texto
        .replace(/<[^>]+>/g, '') // quita <b>, </b>, <i>, etc.
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}

async function enviarPush(uid: string, tokens: string[], titulo: string, cuerpo: string): Promise<boolean> {
    if (tokens.length === 0) return false;
    try {
        const resp = await getMessaging().sendEachForMulticast({
            tokens,
            notification: { title: titulo, body: cuerpo },
            webpush: {
                fcmOptions: { link: 'https://automatepowerv1.web.app' },
                notification: { icon: '/icons/icon-192.png' },
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

/** Avisa a varios de una vez, saltando a quien no quiera recibir. */
async function avisar(uids: string[], texto: string): Promise<number> {
    if (uids.length === 0) return 0;

    const docs = await db.getAll(...uids.map((uid) => db.doc(`users/${uid}`)));
    let enviados = 0;

    for (const doc of docs) {
        const u = doc.data() as Record<string, unknown> | undefined;
        if (!u) continue;

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
            await enviarPush(doc.id, tokens, titulo, cuerpo);
        }
    }
    return enviados;
}

/**
 * Activa o desactiva las notificaciones push del usuario y guarda (o
 * quita) el token del dispositivo actual. El botón del perfil llama a
 * esto. Se maneja con dos campos en el usuario: pushActivo (el switch)
 * y pushTokens (los dispositivos donde recibir).
 */
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

/* ============================================================
   LIGAS — precarga automática de resultados de jornada
   Para las competiciones vinculadas a la API (apiLigaId), revisa
   las jornadas aún NO resueltas y precarga los marcadores de los
   partidos que ya terminaron. NO resuelve nada: solo deja los
   resultados listos para que el admin revise y publique. Es el
   equivalente de "Traer resultados de la API", pero automático.
   ============================================================ */
export const revisarJornadas = onSchedule(
    { schedule: cada(30), timeZone: 'America/Mexico_City', secrets: [sportsDbKey] },
    async () => {
        // Competiciones con conexión a la API configurada.
        const comps = await db.collection('competiciones').where('apiLigaId', '>', 0).get();
        if (comps.empty) {
            logger.info('Sin competiciones vinculadas a la API.');
            return;
        }

        let jornadasTocadas = 0;

        for (const compDoc of comps.docs) {
            const comp = compDoc.data() as Record<string, unknown>;
            const ligaId = Number(comp['apiLigaId'] ?? 0);
            const temporada = String(comp['apiTemporada'] ?? '');
            if (!ligaId || !temporada) continue;

            // Jornadas aún no resueltas: son las candidatas a precargar.
            const jornadas = await compDoc.ref
                .collection('jornadas')
                .where('estado', '==', 'abierta')
                .get();

            for (const jDoc of jornadas.docs) {
                const j = jDoc.data() as {
                    numero: number;
                    cierraAt?: Timestamp;
                    partidos: Array<{ local: string; visitante: string }>;
                };

                // Solo revisamos jornadas cuyo primer partido ya empezó. Antes
                // de eso no hay nada que traer. (cierraAt = hora del 1er partido.)
                const cierra = j.cierraAt?.toMillis() ?? 0;
                if (!cierra || cierra > Date.now()) continue;

                let eventos;
                try {
                    eventos = await eventosRondaSportsDb(ligaId, j.numero, temporada, sportsDbKey.value());
                } catch (e) {
                    logger.warn(`No se pudo consultar la jornada ${j.numero} de ${compDoc.id}.`, e);
                    continue;
                }

                const { conResultado, partidos } = cruzarResultadosJornada(j.partidos, eventos);
                if (conResultado === 0) continue;

                // Solo escribe si algo cambió, para no gastar escrituras de más.
                const cambio = partidos.some((p, i) => {
                    const orig = j.partidos[i] as Record<string, unknown>;
                    return (
                        (p.golesLocal ?? null) !== (orig['golesLocal'] ?? null) ||
                        (p.golesVisitante ?? null) !== (orig['golesVisitante'] ?? null) ||
                        (p.resultado ?? null) !== (orig['resultado'] ?? null)
                    );
                });
                if (!cambio) continue;

                await jDoc.ref.update({ partidos });
                jornadasTocadas++;
            }
        }

        logger.info(`Precarga de jornadas: ${jornadasTocadas} jornada(s) actualizada(s).`);
    },
);

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
        );

        return { ok: true, ...resultado };
    },
);

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

function codigoBracket(): string {
    const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => letras.charAt(Math.floor(Math.random() * letras.length))).join('');
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
        const esAdminGrupo = grupoSnap.data()?.['adminUid'] === uid;
        if (!esAdminGrupo && !adminSnap.exists) {
            throw new HttpsError('permission-denied', 'Solo el administrador del grupo puede crear eliminatorias para él.');
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
            if (puntos < costo) return false; // sin saldo: se le quita el equipo.
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
            );
        } else {
            // Sin saldo: se libera el equipo y se saca de su lista.
            await db.doc(`users/${uid}`).set({ brackets: FieldValue.arrayRemove(ref.id) }, { merge: true });
            await avisar(
                [uid],
                `⚠️ <b>${String(b['nombre'] ?? 'Eliminatoria')}</b>\n` +
                `No tenías puntos para la entrada, así que quedaste fuera y ${dn.equipo} se liberó.`,
            );
        }
    }

    await ref.update({ duenos: finales, bolsa: FieldValue.increment(sumaBolsa) });
}

/* ============================================================
   GRUPOS (competencias privadas)
   Los puntos son globales; el grupo es solo organización.
   ============================================================ */

/** Genera un código corto de invitación (6 letras/números, sin ambiguos). */
function generarCodigoGrupo(): string {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I, O, 0, 1
    let c = '';
    for (let i = 0; i < 6; i++) c += abc[Math.floor(Math.random() * abc.length)];
    return c;
}

/** Crea un grupo. Solo lo puede hacer un "admin de grupo". */
export const crearGrupo = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const nombre = String(req.data?.nombre ?? '').trim();
    const icono = String(req.data?.icono ?? '⚽').trim();
    if (nombre.length < 3) {
        throw new HttpsError('invalid-argument', 'El nombre del grupo es muy corto.');
    }

    const userRef = db.doc(`users/${uid}`);
    const userSnap = await userRef.get();
    const u = userSnap.data();
    if (!u) {
        throw new HttpsError('not-found', 'No encontramos tu perfil.');
    }
    if (u['esAdminGrupo'] !== true) {
        throw new HttpsError('permission-denied', 'No tienes permiso para crear grupos.');
    }

    // Genera un código único (reintenta si choca).
    let codigo = generarCodigoGrupo();
    for (let intento = 0; intento < 5; intento++) {
        const existe = await db.collection('grupos').where('codigo', '==', codigo).limit(1).get();
        if (existe.empty) break;
        codigo = generarCodigoGrupo();
    }

    const grupoRef = db.collection('grupos').doc();
    const alias = String(u['alias'] ?? 'Jugador');

    await grupoRef.set({
        nombre,
        icono,
        codigo,
        adminUid: uid,
        miembrosCount: 1,
        createdAt: FieldValue.serverTimestamp(),
    });
    // El creador es el primer miembro, con rol admin.
    await grupoRef.collection('miembros').doc(uid).set({
        uid,
        alias,
        rol: 'admin',
        entradaAt: FieldValue.serverTimestamp(),
    });
    // Índice inverso en el usuario.
    await userRef.update({ grupos: FieldValue.arrayUnion(grupoRef.id) });

    return { ok: true, grupoId: grupoRef.id, codigo };
});

/** Une al usuario a un grupo usando su código de invitación. */
export const unirseAGrupo = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const codigo = String(req.data?.codigo ?? '').trim().toUpperCase();
    if (!codigo) {
        throw new HttpsError('invalid-argument', 'Falta el código.');
    }

    const encontrados = await db.collection('grupos').where('codigo', '==', codigo).limit(1).get();
    if (encontrados.empty) {
        throw new HttpsError('not-found', 'No hay ningún grupo con ese código.');
    }
    const grupoDoc = encontrados.docs[0];
    const grupoRef = grupoDoc.ref;

    const miembroRef = grupoRef.collection('miembros').doc(uid);
    if ((await miembroRef.get()).exists) {
        throw new HttpsError('already-exists', 'Ya perteneces a este grupo.');
    }

    const userRef = db.doc(`users/${uid}`);
    const u = (await userRef.get()).data();
    const alias = String(u?.['alias'] ?? 'Jugador');

    await miembroRef.set({
        uid,
        alias,
        rol: 'miembro',
        entradaAt: FieldValue.serverTimestamp(),
    });
    await grupoRef.update({ miembrosCount: FieldValue.increment(1) });
    await userRef.update({ grupos: FieldValue.arrayUnion(grupoRef.id) });

    return {
        ok: true,
        grupoId: grupoRef.id,
        nombre: grupoDoc.data()['nombre'],
        icono: grupoDoc.data()['icono'] ?? '⚽',
    };
});

/** El admin de un grupo agrega manualmente a un usuario por su uid. */
export const agregarMiembroGrupo = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const grupoId = String(req.data?.grupoId ?? '');
    const nuevoUid = String(req.data?.uid ?? '');
    if (!grupoId || !nuevoUid) {
        throw new HttpsError('invalid-argument', 'Faltan datos.');
    }

    const grupoRef = db.doc(`grupos/${grupoId}`);
    const grupo = (await grupoRef.get()).data();
    if (!grupo) {
        throw new HttpsError('not-found', 'El grupo no existe.');
    }
    if (grupo['adminUid'] !== uid) {
        throw new HttpsError('permission-denied', 'Solo el administrador del grupo puede agregar miembros.');
    }

    const miembroRef = grupoRef.collection('miembros').doc(nuevoUid);
    if ((await miembroRef.get()).exists) {
        throw new HttpsError('already-exists', 'Esa persona ya está en el grupo.');
    }
    const nuevoUser = (await db.doc(`users/${nuevoUid}`).get()).data();
    if (!nuevoUser) {
        throw new HttpsError('not-found', 'No encontramos a esa persona.');
    }

    await miembroRef.set({
        uid: nuevoUid,
        alias: String(nuevoUser['alias'] ?? 'Jugador'),
        rol: 'miembro',
        entradaAt: FieldValue.serverTimestamp(),
    });
    await grupoRef.update({ miembrosCount: FieldValue.increment(1) });
    await db.doc(`users/${nuevoUid}`).update({ grupos: FieldValue.arrayUnion(grupoId) });

    return { ok: true };
});

/**
 * Saca al usuario de un grupo. Si es el admin, debe pasar el uid de quien
 * hereda el rol (nuevoAdminUid); si es el único miembro, el grupo se elimina.
 */
export const salirDeGrupo = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const grupoId = String(req.data?.grupoId ?? '');
    const nuevoAdminUid = String(req.data?.nuevoAdminUid ?? '');
    if (!grupoId) {
        throw new HttpsError('invalid-argument', 'Falta el grupo.');
    }

    const grupoRef = db.doc(`grupos/${grupoId}`);
    const grupo = (await grupoRef.get()).data();
    if (!grupo) {
        throw new HttpsError('not-found', 'El grupo no existe.');
    }
    const miembroRef = grupoRef.collection('miembros').doc(uid);
    if (!(await miembroRef.get()).exists) {
        throw new HttpsError('not-found', 'No perteneces a este grupo.');
    }

    const soyAdmin = grupo['adminUid'] === uid;
    const total = Number(grupo['miembrosCount'] ?? 1);

    // Si soy el único miembro, el grupo se elimina.
    if (total <= 1) {
        await miembroRef.delete();
        await grupoRef.delete();
        await db.doc(`users/${uid}`).update({
            grupos: FieldValue.arrayRemove(grupoId),
            gruposFavoritos: FieldValue.arrayRemove(grupoId),
        });
        return { ok: true, eliminado: true };
    }

    // Si soy admin y hay más gente, debo transferir el rol.
    if (soyAdmin) {
        if (!nuevoAdminUid) {
            throw new HttpsError('failed-precondition', 'Debes transferir el rol de administrador antes de salir.');
        }
        const nuevoRef = grupoRef.collection('miembros').doc(nuevoAdminUid);
        if (!(await nuevoRef.get()).exists) {
            throw new HttpsError('not-found', 'La persona que elegiste no está en el grupo.');
        }
        await nuevoRef.update({ rol: 'admin' });
        await grupoRef.update({ adminUid: nuevoAdminUid });
    }

    await miembroRef.delete();
    await grupoRef.update({ miembrosCount: FieldValue.increment(-1) });
    await db.doc(`users/${uid}`).update({
        grupos: FieldValue.arrayRemove(grupoId),
        gruposFavoritos: FieldValue.arrayRemove(grupoId),
    });

    return { ok: true, eliminado: false };
});

/** Marca o desmarca un grupo como favorito para el usuario. */
export const marcarGrupoFavorito = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const grupoId = String(req.data?.grupoId ?? '');
    const favorito = req.data?.favorito === true;
    if (!grupoId) {
        throw new HttpsError('invalid-argument', 'Falta el grupo.');
    }

    const userRef = db.doc(`users/${uid}`);
    await userRef.update({
        gruposFavoritos: favorito ? FieldValue.arrayUnion(grupoId) : FieldValue.arrayRemove(grupoId),
    });

    return { ok: true };
});

/**
 * Busca usuarios por alias para que un admin de grupo pueda agregarlos.
 * Devuelve SOLO datos públicos (uid + alias), nunca el correo, para no
 * exponer información privada. Requiere que el llamante sea admin de grupo.
 */
export const buscarUsuariosPorAlias = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const texto = String(req.data?.texto ?? '').trim();
    if (texto.length < 2) {
        throw new HttpsError('invalid-argument', 'Escribe al menos 2 letras.');
    }

    // Solo un admin de grupo puede buscar personas.
    const yo = (await db.doc(`users/${uid}`).get()).data();
    if (yo?.['esAdminGrupo'] !== true) {
        throw new HttpsError('permission-denied', 'No tienes permiso para buscar usuarios.');
    }

    // Búsqueda case-insensitive por "contiene". Firestore no soporta
    // búsquedas insensibles a mayúsculas de forma nativa, así que traemos los
    // usuarios validados y filtramos en memoria con el texto en minúsculas.
    // El volumen es bajo (solo lo usa un admin de grupo para agregar gente),
    // así que un límite generoso es suficiente y evita migrar datos.
    const buscado = texto.toLowerCase();
    const snap = await db
        .collection('users')
        .where('validada', '==', true)
        .limit(500)
        .get();

    const resultados = snap.docs
        .map((d) => ({ uid: d.id, alias: String(d.data()['alias'] ?? '') }))
        .filter((r) => r.uid !== uid && r.alias.toLowerCase().includes(buscado))
        // Primero los que empiezan con el texto, luego el resto; ambos por alias.
        .sort((a, b) => {
            const aEmpieza = a.alias.toLowerCase().startsWith(buscado) ? 0 : 1;
            const bEmpieza = b.alias.toLowerCase().startsWith(buscado) ? 0 : 1;
            if (aEmpieza !== bEmpieza) return aEmpieza - bEmpieza;
            return a.alias.localeCompare(b.alias, 'es');
        })
        .slice(0, 10);

    return { usuarios: resultados };
});

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
        const esAdminGrupo = grupoSnap.data()?.['adminUid'] === uid;
        if (!esAdminGrupo && !adminSnap.exists) {
            throw new HttpsError('permission-denied', 'Solo el administrador del grupo puede crear torneos para él.');
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
    const esAdminGrupo = grupoSnap.data()?.['adminUid'] === uid;
    if (!esAdminGrupo && !adminSnap.exists) {
        throw new HttpsError('permission-denied', 'Solo el administrador del grupo puede crear partidos para él.');
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
    const esAdminGrupo = grupoSnap.exists && grupoSnap.data()?.['adminUid'] === uid;
    if (!esAdminGrupo && !adminSnap.exists) {
        throw new HttpsError('permission-denied', 'Solo el administrador del grupo puede liquidar sus partidos.');
    }

    return ejecutarLiquidacion(partidoId, resultadoOficial);
});

/**
 * Valida un token de Cloudflare Turnstile (el "portón" de acceso al sitio).
 * El cliente resuelve el widget, obtiene un token y lo manda aquí; esta
 * función lo verifica con Cloudflare usando la Secret Key. Solo si es válido
 * se permite el acceso a la app.
 *
 * Es onCall (no requiere que el usuario esté autenticado, porque el portón
 * está ANTES del login).
 */
export const validarTurnstile = onCall(
    { ...opcionesCall, secrets: [turnstileSecret] },
    async (req) => {
        const token = String(req.data?.token ?? '');
        if (!token) {
            throw new HttpsError('invalid-argument', 'Falta el token de verificación.');
        }

        const secret = turnstileSecret.value();
        if (!secret) {
            throw new HttpsError('failed-precondition', 'Turnstile no está configurado en el servidor.');
        }

        // Cloudflare valida el token con esta llamada (siteverify).
        const body = new URLSearchParams();
        body.append('secret', secret);
        body.append('response', token);

        try {
            const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
            });
            const data = (await resp.json()) as { success?: boolean; 'error-codes'?: string[] };

            if (data.success === true) {
                return { ok: true };
            }
            return { ok: false, errores: data['error-codes'] ?? [] };
        } catch {
            throw new HttpsError('internal', 'No se pudo verificar con Cloudflare. Intenta de nuevo.');
        }
    },
);