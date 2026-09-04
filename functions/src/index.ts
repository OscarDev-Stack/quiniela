import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { nombreOficial as nombreOficialEquipo } from './equipos';
// Base común (inicializa Firebase Admin, Firestore, constantes, secrets, bote).
import {
    db,
    cada,
    MINUTOS_ANTES_DE_CONSULTAR,
    opcionesCall,
    footballDataKey,
    telegramToken,
    telegramWebhookSecret,
    turnstileSecret,
    sportsDbKey,
} from './comun';
// Notificaciones: helpers compartidos (los usan casi todos los dominios).
import { avisar, enviarTelegram } from './notificaciones';
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

/* ============================================================
   BRACKETS → ./brackets
   Eliminatorias (cuadro, dueños, pronóstico, calificación). Se
   re-exportan con el mismo nombre desde ./brackets.
   ============================================================ */
export {
    crearBracket,
    asignarLlaveBracket,
    asignarDuenoBracket,
    aceptarDuenoBracket,
    rechazarDuenoBracket,
    capturarPartidoBracket,
    guardarPronosticoBracket,
    unirseBracket,
    calificarBracket,
    avisarDuenosPendientes,
    cerrarBrackets,
    consultarBracket,
} from './brackets';

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