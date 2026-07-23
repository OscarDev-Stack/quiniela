import { Timestamp } from '@angular/fire/firestore';

export type ResultadoPartido = 'local' | 'empate' | 'visitante' | 'pospuesto';

export interface Competicion {
    id: string;
    /* Liga MX, Premier League, etc. */
    nombre: string;
    /* Catálogo oficial de equipos. Las jornadas se arman con estos nombres. */
    equipos?: string[];
    /* Quienes pueden capturar jornadas y resultados. */
    gestores?: string[];
    /* Última jornada resuelta, para orientar al administrador. */
    ultimaJornada?: number;
    createdAt?: unknown;
}

export interface PartidoJornada {
    local: string;
    visitante: string;
    resultado?: ResultadoPartido | null;
    /* Marcador final. Necesario para la quiniela por puntos. */
    golesLocal?: number | null;
    golesVisitante?: number | null;
}

/** Deduce quién ganó a partir del marcador. */
export function resultadoDeMarcador(
    golesLocal: number | null | undefined,
    golesVisitante: number | null | undefined,
): ResultadoPartido | null {
    if (golesLocal === null || golesLocal === undefined) return null;
    if (golesVisitante === null || golesVisitante === undefined) return null;
    if (golesLocal > golesVisitante) return 'local';
    if (golesLocal < golesVisitante) return 'visitante';
    return 'empate';
}

export interface Jornada {
    id: string;
    numero: number;
    cierraAt?: Timestamp | { seconds: number } | Date | null;
    estado: 'abierta' | 'resuelta';
    partidos: PartidoJornada[];
}

/** Convierte el cierre de jornada a Date, venga como venga. */
export function fechaJornada(j: Jornada | null): Date | null {
    const v = j?.cierraAt as unknown;
    if (!v) return null;
    if (v instanceof Date) return v;
    const o = v as { toDate?: () => Date; seconds?: number };
    if (typeof o.toDate === 'function') return o.toDate();
    if (typeof o.seconds === 'number') return new Date(o.seconds * 1000);
    return null;
}

/** Todos los equipos que juegan en una jornada. */
export function equiposDeJornada(j: Jornada | null): string[] {
    if (!j) return [];
    return j.partidos.flatMap((p) => [p.local, p.visitante]);
}