import { Timestamp } from '@angular/fire/firestore';

/* Tipo de partido: define qué resultados son válidos. */
export type TipoPartido = '1x2' | '1-2' | 'quien-pasa';

/* Estado del partido dentro de su ciclo de vida. */
export type EstadoPartido =
    | 'abierto'
    | 'cierra-pronto'
    | 'en-juego'
    | 'cerrado'
    | 'cancelado';

export interface PremioResultado {
    label: string;
    value: number;
}

export interface Partido {
    id: string;
    competition: string;
    homeTeam: string;
    awayTeam: string;
    type: TipoPartido;
    status: EstadoPartido;
    /* Grupo al que pertenece. null/ausente = partido Global. */
    grupoId?: string | null;
    /* Fecha y hora real de cierre. El servidor cierra el partido solo. */
    closesAt?: Timestamp | { seconds: number } | Date | null;
    /* Etiqueta antigua, se conserva por compatibilidad. */
    closesLabel?: string;
    poolTotal?: number;
    /* Se publican al iniciar el partido. */
    porResultado?: Record<string, number>;
    premioPor100?: Record<string, number>;
    prizes?: PremioResultado[];
    resultadoOficial?: string;
    /* Vínculo con el partido real de API-Football. */
    apiFixtureId?: number;
    /* Resultado precargado por la API, a la espera de confirmación. */
    resultadoPropuesto?: string;
    marcadorPropuesto?: string;
    alertaApi?: string;
    /* % de la bolsa que se desvía al bote acumulado (0 = nada). */
    porcentajeBote?: number;
    liquidado?: boolean;
}

/** Convierte el campo de cierre a Date, venga como venga. */
export function fechaCierre(p: Partido): Date | null {
    const v = p.closesAt as unknown;
    if (!v) return null;
    if (v instanceof Date) return v;
    const obj = v as { toDate?: () => Date; seconds?: number };
    if (typeof obj.toDate === 'function') return obj.toDate();
    if (typeof obj.seconds === 'number') return new Date(obj.seconds * 1000);
    return null;
}

/** Texto tipo "Cierra en 2h 15m" o "Cerrado". */
export function textoRestante(p: Partido, ahora: number): string {
    const f = fechaCierre(p);
    if (!f) return p.closesLabel ?? 'Por definir';

    const ms = f.getTime() - ahora;
    if (ms <= 0) return 'Cerrado';

    const min = Math.floor(ms / 60000);
    const dias = Math.floor(min / 1440);
    const horas = Math.floor((min % 1440) / 60);
    const mins = min % 60;

    if (dias > 0) return `Cierra en ${dias}d ${horas}h`;
    if (horas > 0) return `Cierra en ${horas}h ${mins}m`;
    return `Cierra en ${mins}m`;
}