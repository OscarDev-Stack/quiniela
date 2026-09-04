/* ============================================================
   TheSportsDB — helpers de la API (premium V2 + tabla V1)
   Bloque cohesivo del acceso a TheSportsDB, extraído del index.ts.
   Vive aparte para que lo compartan sin ciclos tanto las funciones
   de API que siguen en index (buscar/traer/refrescar/revisar) como
   los torneos (resolverJornadaCompeticion refresca la tabla).
   NO incluye football-data (eso sigue en index.ts).
   ============================================================ */

import { nombreOficial as nombreOficialEquipo } from './equipos';
import { HttpsError, FieldValue } from './comun';

/**
 * URL base de TheSportsDB V1 para una key dada. Ojo: NO todos los endpoints
 * V1 funcionan con la key premium (varios dan 404 y hay que usar V2). Pero
 * algunos, como lookuptable.php, SÍ funcionan en V1 con la key premium y
 * devuelven los datos completos, así que ahí seguimos usando V1.
 */
export const sportsDbBase = (key: string): string =>
    `https://www.thesportsdb.com/api/v1/json/${(key ?? '').trim() || '123'}`;

/**
 * TheSportsDB entrega strTimestamp en UTC pero SIN zona (ej.
 * "2026-09-04T19:00:00"). Si se pasa así a new Date() se interpreta como hora
 * local y se desfasa. Esta función lo normaliza a ISO UTC agregando la 'Z',
 * para que siempre se interprete como UTC (igual que el utcDate de
 * football-data). Devuelve '' si viene vacío.
 */
export function tsUtcSportsDb(strTimestamp: string | undefined): string {
    const t = (strTimestamp ?? '').trim();
    if (!t) return '';
    // Si ya trae zona (Z o +hh:mm), se deja tal cual; si no, se marca como UTC.
    if (/[Zz]$/.test(t) || /[+-]\d{2}:?\d{2}$/.test(t)) return t;
    return t.replace(' ', 'T') + 'Z';
}

/**
 * Llama a la API V2 de TheSportsDB (premium). La key va en el header
 * 'X-API-KEY'. Devuelve el JSON crudo, o lanza si la respuesta no es OK.
 * V2 es la que soporta la key premium para los endpoints de calendario/eventos.
 */
export async function fetchSportsDbV2<T>(ruta: string, key: string): Promise<T> {
    const url = `https://www.thesportsdb.com/api/v2/json/${ruta}`;
    const res = await fetch(url, { headers: { 'X-API-KEY': (key ?? '').trim() } });
    if (!res.ok) {
        throw new HttpsError('internal', `TheSportsDB V2 respondió ${res.status}.`);
    }
    return (await res.json()) as T;
}

/** Un evento (partido) de TheSportsDB, con los campos que usamos. */
export interface EventoSportsDb {
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
export const LIGAS_SPORTSDB: Record<string, { id: number; nombre: string; nombreApi: string }> = {
    LIGAMX: { id: 4350, nombre: 'Liga MX', nombreApi: 'Mexican Primera League' },
    CL: { id: 4480, nombre: 'Champions League', nombreApi: 'UEFA Champions League' },
    PL: { id: 4328, nombre: 'Premier League', nombreApi: 'English Premier League' },
    PD: { id: 4335, nombre: 'LaLiga', nombreApi: 'Spanish La Liga' },
    SA: { id: 4332, nombre: 'Serie A', nombreApi: 'Italian Serie A' },
    BL1: { id: 4331, nombre: 'Bundesliga', nombreApi: 'German Bundesliga' },
    FL1: { id: 4334, nombre: 'Ligue 1', nombreApi: 'French Ligue 1' },
    // NFL: fútbol americano. Solo para modo supervivencia (survivor). La
    // temporada regular son las rondas (intRound) 1..18; la pretemporada (500) y
    // los playoffs (150/160/200) quedan fuera solo con pedir jornadas 1..18.
    // OJO: su "apiTemporada" es el año simple ("2026"), NO "2026-2027".
    NFL: { id: 4391, nombre: 'NFL', nombreApi: 'NFL' },
    // EC (Eurocopa): torneo de selecciones inactivo la mayor parte del tiempo;
    // se deja fuera hasta poder confirmar su id cuando haya edición en curso.
};

/** Rondas (intRound) de temporada regular de la NFL: 1..18 (18 semanas). */
export const NFL_LIGA_ID = 4391;
export const NFL_SEMANAS_REGULAR = 18;

/**
 * Normaliza la temporada al formato que espera TheSportsDB SEGÚN la liga.
 * El fútbol usa temporada de dos años ("2026-2027"); la NFL (y otras ligas de
 * EE.UU.) usan el AÑO SIMPLE ("2026"). Si a una competición NFL le quedó
 * configurada una temporada tipo "2026-2027", tomamos el primer año para que
 * la consulta a la API no venga vacía. Así el admin no tiene que acordarse del
 * formato exacto.
 */
export function temporadaApiParaLiga(ligaId: number, temporada: string): string {
    const t = (temporada ?? '').trim();
    if (ligaId === NFL_LIGA_ID) {
        // "2026-2027" -> "2026"; "2026" -> "2026".
        const m = t.match(/^(\d{4})/);
        return m ? m[1] : t;
    }
    return t;
}

/** Busca la config de una liga por su id de TheSportsDB. */
export function ligaPorId(ligaId: number): { id: number; nombre: string; nombreApi: string } | null {
    return Object.values(LIGAS_SPORTSDB).find((l) => l.id === ligaId) ?? null;
}

/**
 * Trae los partidos de UNA jornada (ronda) de una liga de TheSportsDB.
 *
 * Usa el endpoint `eventsround`, que devuelve la jornada completa. NO se usa
 * `eventsseason` porque con la key gratuita esa respuesta viene truncada (solo
 * las primeras jornadas), lo que hacía que jornadas altas parecieran vacías.
 */
export async function eventosRondaSportsDb(
    ligaId: number,
    ronda: number,
    temporada: string,
    key: string,
): Promise<EventoSportsDb[]> {
    // V2 devuelve el calendario COMPLETO de la temporada (raíz `schedule`);
    // filtramos por la ronda pedida. Los campos internos son los mismos que V1.
    // La temporada se normaliza según la liga (NFL usa año simple).
    const temp = temporadaApiParaLiga(ligaId, temporada);
    const data = await fetchSportsDbV2<{ schedule?: EventoSportsDb[] | null }>(
        `schedule/league/${ligaId}/${encodeURIComponent(temp)}`,
        key,
    );
    const todos = data.schedule ?? [];
    return todos.filter((e) => Number(e.intRound) === ronda);
}

/** Una fila de la tabla de posiciones tal como la devuelve TheSportsDB. */
export interface StandingSportsDb {
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
export interface FilaTablaLiga {
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
export async function tablaLigaSportsDb(
    ligaId: number,
    temporada: string,
    key: string,
): Promise<FilaTablaLiga[]> {
    // La tabla SÍ funciona en V1 con la key premium (devuelve los equipos
    // completos), así que aquí seguimos usando V1 — a diferencia de los
    // endpoints de calendario/eventos, que en V1 premium dan 404 y usan V2.
    const temp = temporadaApiParaLiga(ligaId, temporada);
    const url =
        `${sportsDbBase(key)}/lookuptable.php?l=${ligaId}&s=${encodeURIComponent(temp)}`;
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
export async function refrescarTablaCompeticion(
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
export function resultadoDesdeMarcador(
    gl: number | null,
    gv: number | null,
): 'local' | 'empate' | 'visitante' | null {
    if (gl === null || gv === null) return null;
    if (gl > gv) return 'local';
    if (gl < gv) return 'visitante';
    return 'empate';
}

/** Un partido de jornada tras cruzar con la API (puede traer marcador o no). */
export interface PartidoJornadaApi {
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
export function cruzarResultadosJornada(
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
