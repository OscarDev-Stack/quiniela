import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { nombreOficial as nombreOficialEquipo } from './equipos';
// Base común (inicializa Firebase Admin, Firestore, constantes, secrets, bote).
import {
    db,
    cada,
    TOPE_INFERIOR,
    MINUTOS_ANTES_DE_CONSULTAR,
    opcionesCall,
    footballDataKey,
    telegramToken,
    telegramWebhookSecret,
    turnstileSecret,
    sportsDbKey,
    calcularBote,
    registrarBote,
    registrarTrofeos,
    codigoBracket,
} from './comun';
// Notificaciones: helpers compartidos (los usan casi todos los dominios).
import { avisar, enviarTelegram } from './notificaciones';
// Grupos: esAdminDeGrupo lo usan torneos, partidos y brackets.
import { esAdminDeGrupo } from './grupos';
// Partidos: ejecutarLiquidacion la usan los schedulers de resultados (API).
import { ejecutarLiquidacion } from './partidos';
// TheSportsDB: helpers de la API que usan las funciones de API y de torneos.
import {
    EventoSportsDb,
    LIGAS_SPORTSDB,
    NFL_LIGA_ID,
    NFL_SEMANAS_REGULAR,
    tsUtcSportsDb,
    ligaPorId,
    eventosRondaSportsDb,
    cruzarResultadosJornada,
    refrescarTablaCompeticion,
    fetchSportsDbV2,
} from './sportsdb';

const API_BASE = 'https://api.football-data.org/v4';


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
    const data = await fetchSportsDbV2<{ schedule?: EventoSportsDb[] | null }>(
        `schedule/next/league/${ligaId}`,
        key,
    );
    return data.schedule ?? [];
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
            // Solo los que no han empezado y tienen hora futura (UTC normalizado).
            .filter((e) => {
                if (e.strStatus && e.strStatus !== 'NS' && e.strStatus !== '') return false;
                const iso = tsUtcSportsDb(e.strTimestamp);
                const ts = iso ? new Date(iso).getTime() : 0;
                return ts > ahora;
            })
            .map((e) => ({
                apiEventId: String(e.idEvent ?? ''),
                fecha: tsUtcSportsDb(e.strTimestamp),
                homeTeam: nombreOficialEquipo(e.strHomeTeam),
                awayTeam: nombreOficialEquipo(e.strAwayTeam),
                homeTeamId: e.idHomeTeam ?? null,
                awayTeamId: e.idAwayTeam ?? null,
                ronda: e.intRound ?? '',
                // Usamos SIEMPRE nuestro nombre en español (cfg.nombre), no el
                // de la API (que viene en inglés: "Spanish La Liga", etc.).
                competition: cfg.nombre,
                // Id de liga de TheSportsDB: liga el partido a la tabla cacheada
                // (para mostrar la forma reciente de sus equipos).
                apiLigaId: cfg.id,
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

            const empate = local === visitante;

            // Empate en un partido que no admite empate (1-2 o quien-pasa): NO
            // decidimos por nuestra cuenta. Puede que de verdad no haya ganador
            // (partido de liga) o que alguien haya avanzado por penales/global
            // (eliminatoria). Es dinero real, así que lo revisa el admin: él
            // cancela y devuelve, o liquida eligiendo al ganador que avanzó.
            if (empate && tipo !== '1x2') {
                await d.ref.update({
                    alertaApi:
                        'Empataron y este partido no admite empate. Revísalo: cancela para ' +
                        'devolver, o define al ganador si avanzó por penales/global.',
                });
                continue;
            }

            let resultado: string;
            if (tipo === 'quien-pasa') {
                resultado = local > visitante ? 'pasa-local' : 'pasa-visitante';
            } else if (local > visitante) {
                resultado = 'local';
            } else if (visitante > local) {
                resultado = 'visitante';
            } else {
                resultado = 'empate';
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
        const data = await fetchSportsDbV2<{ lookup?: EventoSportsDb[] | null }>(
            `lookup/event/${idEvent}`,
            key,
        );
        return data.lookup?.[0] ?? null;
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
            const empate = local === visitante;

            // Empate en un partido que no admite empate (1-2 o quien-pasa): lo
            // revisa el admin (puede no haber ganador, o haber avanzado alguien
            // por penales/global). Es dinero real; no decidimos por él.
            if (empate && tipo !== '1x2') {
                await d.ref.update({
                    alertaApi:
                        'Empataron y este partido no admite empate. Revísalo: cancela para ' +
                        'devolver, o define al ganador si avanzó por penales/global.',
                });
                continue;
            }

            let resultado: string;
            if (tipo === 'quien-pasa') {
                resultado = local > visitante ? 'pasa-local' : 'pasa-visitante';
            } else if (local > visitante) {
                resultado = 'local';
            } else if (visitante > local) {
                resultado = 'visitante';
            } else {
                resultado = 'empate';
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
/**
 * Extrae el marcador en vivo de un evento de TheSportsDB, o null si no hay
 * datos utilizables. El minuto sale de strProgress ("63") o del estado ("HT").
 */
function vivoDeEvento(
    ev: EventoSportsDb,
): { vivoLocal: number; vivoVisitante: number; vivoMinuto: string } | null {
    const local = Number(ev.intHomeScore ?? NaN);
    const visitante = Number(ev.intAwayScore ?? NaN);
    const minuto = String(ev.strProgress ?? '').trim() || String(ev.strStatus ?? '').trim();
    if (!Number.isFinite(local) && !Number.isFinite(visitante)) return null;
    return {
        vivoLocal: Number.isFinite(local) ? local : 0,
        vivoVisitante: Number.isFinite(visitante) ? visitante : 0,
        vivoMinuto: minuto,
    };
}

export const actualizarMarcadoresEnVivo = onSchedule(
    { schedule: cada(3), timeZone: 'America/Mexico_City', secrets: [sportsDbKey] },
    async () => {
        const key = sportsDbKey.value();

        // ── 1) Partidos sueltos en juego (colección `partidos`) ──
        const snap = await db.collection('partidos').where('status', '==', 'en-juego').get();
        const candidatos = snap.docs.filter((d) => {
            const p = d.data();
            return !p['liquidado'] && !!p['apiEventId'];
        });

        for (const d of candidatos) {
            const ev = await lookupEventoSportsDb(String(d.data()['apiEventId']), key);
            if (!ev) continue;
            const vivo = vivoDeEvento(ev);
            if (!vivo) continue;
            const cambios: Record<string, unknown> = { vivoLocal: vivo.vivoLocal, vivoVisitante: vivo.vivoVisitante };
            if (vivo.vivoMinuto) cambios['vivoMinuto'] = vivo.vivoMinuto;
            await d.ref.update(cambios).catch(() => undefined);
        }

        // ── 2) Jornadas de quiniela abiertas cuyo primer partido ya empezó ──
        // Actualiza el vivo de cada partido de la jornada que tenga apiEventId.
        const comps = await db.collection('competiciones').where('apiLigaId', '>', 0).get();
        const ahora = Date.now();

        for (const compDoc of comps.docs) {
            const jornadas = await compDoc.ref
                .collection('jornadas')
                .where('estado', '==', 'abierta')
                .get();

            for (const jDoc of jornadas.docs) {
                const j = jDoc.data() as {
                    cierraAt?: Timestamp;
                    partidos: Array<Record<string, unknown>>;
                };
                // cierraAt = hora del primer partido; antes de eso no hay vivo.
                const arranca = j.cierraAt?.toMillis() ?? 0;
                if (!arranca || arranca > ahora) continue;

                const partidos = j.partidos ?? [];
                let hayCambios = false;

                for (const p of partidos) {
                    const idEvento = String(p['apiEventId'] ?? '');
                    if (!idEvento) continue;
                    // Si ya tiene resultado final capturado, no seguimos actualizando el vivo.
                    if (p['resultado'] && p['resultado'] !== 'pospuesto') continue;

                    const ev = await lookupEventoSportsDb(idEvento, key);
                    if (!ev) continue;
                    const vivo = vivoDeEvento(ev);
                    if (!vivo) continue;

                    p['vivoLocal'] = vivo.vivoLocal;
                    p['vivoVisitante'] = vivo.vivoVisitante;
                    if (vivo.vivoMinuto) p['vivoMinuto'] = vivo.vivoMinuto;
                    hayCambios = true;
                }

                if (hayCambios) {
                    await jDoc.ref.update({ partidos }).catch(() => undefined);
                }
            }
        }
    },
);







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

    // NFL: solo temporada regular (semanas 1..18). Así nunca se traen por error
    // la pretemporada (ronda 500) ni los playoffs (150/160/200), que tienen otro
    // formato y no encajan con el survivor.
    if (ligaId === NFL_LIGA_ID && numeroJornada > NFL_SEMANAS_REGULAR) {
        throw new HttpsError(
            'invalid-argument',
            `La NFL solo tiene ${NFL_SEMANAS_REGULAR} semanas de temporada regular.`,
        );
    }

    const dela = await eventosRondaSportsDb(ligaId, numeroJornada, temporada, sportsDbKey.value());
    if (dela.length === 0) {
        throw new HttpsError(
            'not-found',
            `La API no tiene la jornada ${numeroJornada} para la temporada ${temporada}. ` +
                'Verifica que la temporada configurada sea la correcta y que esa jornada exista.',
        );
    }

    // Partidos con equipos normalizados; ordenados por hora. Guardamos el
    // idEvent para poder consultar su marcador en vivo después.
    const partidos = dela
        .map((e) => ({
            local: nombreOficialEquipo(e.strHomeTeam),
            visitante: nombreOficialEquipo(e.strAwayTeam),
            apiEventId: String(e.idEvent ?? ''),
            timestamp: tsUtcSportsDb(e.strTimestamp),
        }))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // Hora del primer partido de la jornada (en ISO UTC), para prellenar el cierre.
    const primeraHora = partidos.find((p) => p.timestamp)?.timestamp ?? '';

    return {
        ok: true,
        numeroJornada,
        primeraHora,
        partidos: partidos.map((p) => ({
            local: p.local,
            visitante: p.visitante,
            apiEventId: p.apiEventId,
        })),
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
   TheSportsDB — importar los equipos de la liga
   Trae todos los equipos de la liga configurada (search_all_teams)
   y los FUSIONA con el catálogo de la competición, sin duplicar.
   Así el admin no necesita traer una jornada solo para tener equipos.
   ============================================================ */
export const importarEquiposApi = onCall({ ...opcionesCall, secrets: [sportsDbKey] }, async (req) => {
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

    const ligaId = Number(comp['apiLigaId'] ?? 0);
    const cfg = ligaPorId(ligaId);
    if (!cfg) {
        throw new HttpsError(
            'failed-precondition',
            'Esta competición no tiene una liga de la API soportada.',
        );
    }

    // Traemos los equipos de la liga por su id (V2, raíz `list`).
    const data = await fetchSportsDbV2<{ list?: Array<{ strTeam?: string }> | null }>(
        `list/teams/${cfg.id}`,
        sportsDbKey.value(),
    );
    const equiposApi = (data.list ?? [])
        .map((t) => nombreOficialEquipo(t.strTeam ?? ''))
        .filter((n) => !!n);

    if (equiposApi.length === 0) {
        throw new HttpsError('not-found', 'La API no devolvió equipos para esta liga.');
    }

    // Fusionamos con lo que ya había, sin duplicar y ordenado.
    const actuales = (comp['equipos'] as string[] | undefined) ?? [];
    const antes = actuales.length;
    const fusion = [...new Set([...actuales, ...equiposApi])].sort((a, b) => a.localeCompare(b, 'es'));

    await compRef.update({ equipos: fusion });

    return { ok: true, total: fusion.length, agregados: fusion.length - antes };
});











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


/* ============================================================
   RESUMEN DEL DÍA — oportunidades por cerrar
   UNA SOLA pasada al día (9:00 am) arma UN SOLO aviso por usuario
   juntando los partidos sueltos y los torneos públicos (de su grupo
   o globales) que cierran en las próximas 24h. Así, aunque a lo
   largo del día abran 5 partidos y 3 torneos, el usuario recibe un
   único mensaje una vez al día, sin goteo hora a hora.

   Categoría 'oportunidades' (default OFF). El dedupe es POR USUARIO
   (campo oportunidadesAvisadas en el user): a cada quien se le avisa
   una sola vez de cada partido/torneo, así que lo que ya entró en el
   resumen de hoy no se repite mañana aunque siga abierto.
   ============================================================ */

/** Ventana hacia adelante para el resumen del día. */
const OPORTUNIDAD_HORAS = 24;

/** Texto compacto tipo "2h 15m" / "45m" a partir de milisegundos. */
function faltaTexto(ms: number): string {
    const min = Math.max(1, Math.round(ms / 60000));
    if (min >= 60) return `${Math.floor(min / 60)}h ${min % 60}m`;
    return `${min}m`;
}

interface OportunidadItem {
    id: string;
    grupoId: string | null;
    texto: string; // línea ya formateada para el resumen
    cierraMs: number;
}

export const avisarOportunidades = onSchedule(
    {
        // Una sola pasada al día, a las 9:00 am (hora de México).
        schedule: '0 9 * * *',
        timeZone: 'America/Mexico_City',
        secrets: [telegramToken],
    },
    async () => {
        const ahora = Date.now();
        const limite = ahora + OPORTUNIDAD_HORAS * 60 * 60 * 1000;
        const limiteTs = Timestamp.fromMillis(limite);
        const ahoraTs = Timestamp.fromMillis(ahora);

        // --- Candidatos: partidos sueltos por cerrar ---
        const partidosItems: OportunidadItem[] = [];
        const partSnap = await db
            .collection('partidos')
            .where('closesAt', '>=', ahoraTs)
            .where('closesAt', '<=', limiteTs)
            .get();
        for (const d of partSnap.docs) {
            const p = d.data() as Record<string, unknown>;
            const status = String(p['status'] ?? '');
            if (status !== 'abierto' && status !== 'cierra-pronto') continue;
            const cierra = p['closesAt'] as Timestamp | undefined;
            if (!cierra) continue;
            const cierraMs = cierra.toMillis();
            if (cierraMs <= ahora || cierraMs > limite) continue;

            const local = String(p['homeTeam'] ?? '');
            const visitante = String(p['awayTeam'] ?? '');
            partidosItems.push({
                id: d.id,
                grupoId: (p['grupoId'] as string | null | undefined) ?? null,
                texto: `⚽ ${local} vs ${visitante} — cierra en ${faltaTexto(cierraMs - ahora)}`,
                cierraMs,
            });
        }

        // --- Candidatos: torneos en inscripción por cerrar ---
        const torneosItems: OportunidadItem[] = [];
        const torneoSnap = await db
            .collection('torneos')
            .where('estado', '==', 'inscripcion')
            .where('cierreInscripcion', '>=', ahoraTs)
            .where('cierreInscripcion', '<=', limiteTs)
            .get();
        for (const d of torneoSnap.docs) {
            const t = d.data() as Record<string, unknown>;
            const cierra = t['cierreInscripcion'] as Timestamp | undefined;
            if (!cierra) continue;
            const cierraMs = cierra.toMillis();
            if (cierraMs <= ahora || cierraMs > limite) continue;

            torneosItems.push({
                id: d.id,
                grupoId: (t['grupoId'] as string | null | undefined) ?? null,
                texto: `🏆 ${String(t['nombre'] ?? 'Torneo')} — inscripción cierra en ${faltaTexto(cierraMs - ahora)}`,
                cierraMs,
            });
        }

        const todos = [...partidosItems, ...torneosItems];
        if (todos.length === 0) return;

        // Ítems globales (para todos) y por grupo (solo miembros).
        const globales = todos.filter((i) => !i.grupoId);
        const porGrupo = new Map<string, OportunidadItem[]>();
        for (const i of todos) {
            if (!i.grupoId) continue;
            const arr = porGrupo.get(i.grupoId) ?? [];
            arr.push(i);
            porGrupo.set(i.grupoId, arr);
        }

        // Solo usuarios con algún canal activo: los demás nunca reciben nada.
        // (Firestore no permite OR entre campos, así que traemos ambos y unimos.)
        const [conPush, conTg] = await Promise.all([
            db.collection('users').where('pushActivo', '==', true).get(),
            db.collection('users').where('notificaciones', '==', true).get(),
        ]);
        const usuarios = new Map<string, Record<string, unknown>>();
        for (const d of [...conPush.docs, ...conTg.docs]) usuarios.set(d.id, d.data());

        let avisados = 0;

        for (const [uid, u] of usuarios) {
            const gruposUser = (u['grupos'] as string[] | undefined) ?? [];

            // Ítems que aplican a este usuario: globales + los de sus grupos.
            const aplican: OportunidadItem[] = [...globales];
            for (const g of gruposUser) {
                const arr = porGrupo.get(g);
                if (arr) aplican.push(...arr);
            }
            if (aplican.length === 0) continue;

            // Dedupe por usuario: no repetir el mismo ítem mientras siga abierto.
            const yaAvisado = (u['oportunidadesAvisadas'] ?? {}) as Record<string, number>;
            const nuevos = aplican.filter((i) => yaAvisado[i.id] == null);
            if (nuevos.length === 0) continue;

            const lineas = nuevos
                .sort((a, b) => a.cierraMs - b.cierraMs)
                .map((i) => i.texto);
            const encabezado =
                nuevos.length === 1
                    ? '📅 <b>Resumen del día: 1 oportunidad</b>'
                    : `📅 <b>Resumen del día: ${nuevos.length} oportunidades</b>`;
            const texto = `${encabezado}\n\n${lineas.join('\n')}\n\nEntra a la app para participar.`;

            const enviados = await avisar([uid], texto, 'oportunidades');
            if (enviados > 0 || u['pushActivo'] === true) avisados++;

            // Marca los ítems avisados (con su cierre) y limpia los ya vencidos.
            const marca: Record<string, number> = {};
            for (const [id, ms] of Object.entries(yaAvisado)) {
                if (typeof ms === 'number' && ms > ahora) marca[id] = ms;
            }
            for (const i of nuevos) marca[i.id] = i.cierraMs;
            await db.doc(`users/${uid}`).set({ oportunidadesAvisadas: marca }, { merge: true });
        }

        if (avisados > 0) logger.info(`Oportunidades: aviso enviado a ${avisados} usuario(s).`);
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

/* ============================================================
   GRUPOS (competencias privadas) -> ./grupos
   Las funciones onCall de grupos se re-exportan desde ./grupos
   (mismo nombre, para que Firebase no re-cree funciones).
   esAdminDeGrupo se importa donde se necesita (torneos/partidos/brackets).
   ============================================================ */
export {
    crearGrupo,
    unirseAGrupo,
    agregarMiembroGrupo,
    salirDeGrupo,
    hacerAdminGrupo,
    quitarAdminGrupo,
    marcarGrupoFavorito,
    buscarUsuariosPorAlias,
} from './grupos';

/* ============================================================
   USUARIOS y RANKING → ./usuarios
   Funciones onCall de administración de cuentas y ranking,
   re-exportadas con el mismo nombre desde ./usuarios.
   ============================================================ */
export {
    recalcularRanking,
    backfillTotales,
    reiniciarPuntos,
    eliminarUsuarios,
    sincronizarHistoricos,
    cambiarAlias,
} from './usuarios';

/* ============================================================
   PARTIDOS → ./partidos
   Pronósticos sueltos, bolsa, liquidación, cancelación y bote.
   Se re-exportan con el mismo nombre desde ./partidos.
   `ejecutarLiquidacion` se importa arriba porque la usan los
   schedulers de resultados (API) que siguen en este archivo.
   ============================================================ */
export {
    crearPronostico,
    liquidarPartido,
    cerrarPartidos,
    cancelarPartido,
    recalcularBolsas,
    crearPartidoGrupo,
    liquidarPartidoGrupo,
} from './partidos';

/* ============================================================
   TORNEOS → ./torneos
   Supervivencia y quiniela por puntos. Se re-exportan con el mismo
   nombre desde ./torneos.
   ============================================================ */
export {
    crearTorneo,
    unirseTorneo,
    revivir,
    guardarPick,
    guardarQuiniela,
    previsualizarQuiniela,
    resolverJornadaCompeticion,
    finalizarTorneo,
    resolverPendientes,
    consultarTorneo,
    cerrarInscripciones,
    recordarJornada,
} from './torneos';

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