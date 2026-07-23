export type EstadoTorneo = 'inscripcion' | 'en-curso' | 'finalizado';

/**
 * Cómo se juega el torneo.
 *  supervivencia → eliges un equipo por jornada; si pierde, sales.
 *  quiniela      → pronosticas todos los marcadores y sumas puntos.
 */
export type ModoTorneo = 'supervivencia' | 'quiniela';

export interface Torneo {
    id: string;
    nombre: string;
    /* Competición de la que toma jornadas y resultados. */
    competicionId: string;
    competicionNombre: string;
    /* Jornada en la que arranca el torneo. */
    jornadaInicial: number;
    /* Jornada que está jugando ahora mismo. */
    jornadaActual: number;

    /* Modo de juego. Si falta, es supervivencia por compatibilidad. */
    modo?: ModoTorneo;
    /* Cuántas jornadas dura la quiniela. Solo aplica en ese modo. */
    jornadas?: number;

    /* Fallos permitidos antes de quedar fuera. Solo en supervivencia. */
    vidas: number;
    /* Puntos que cuesta inscribirse. 0 = gratis. */
    costoEntrada: number;
    /* Acumulado de las inscripciones. */
    bolsa: number;
    premioPagado?: number;

    /* Hasta cuándo se puede entrar. Al vencer, el torneo arranca solo. */
    cierreInscripcion?: { seconds: number } | Date | null;

    codigo: string;
    estado: EstadoTorneo;
    ganadorAlias?: string;
    /* Quienes administran este torneo (invitar, iniciar, cerrar). */
    gestores?: string[];
    creadoPor?: string;
    createdAt?: unknown;
}

/** Convierte el cierre de inscripciones a Date, venga como venga. */
export function fechaInscripcion(t: Torneo | null): Date | null {
    const v = t?.cierreInscripcion as unknown;
    if (!v) return null;
    if (v instanceof Date) return v;
    const o = v as { toDate?: () => Date; seconds?: number };
    if (typeof o.toDate === 'function') return o.toDate();
    if (typeof o.seconds === 'number') return new Date(o.seconds * 1000);
    return null;
}

export interface Participante {
    id: string;
    alias: string;
    /* Lo que pagó por entrar. */
    pago?: number;
    vivo: boolean;
    vidasRestantes: number;
    /* Puntos acumulados en la quiniela del torneo. */
    puntosTorneo?: number;
    /* Marcadores exactos acertados, para desempatar. */
    exactos?: number;
    equiposUsados: string[];
    eliminadoEn?: number;
}

/** Pronóstico de una jornada completa en el modo quiniela. */
export interface Quiniela {
    id: string;
    uid: string;
    alias: string;
    jornada: number;
    /* Un marcador por partido, en el mismo orden que la jornada. */
    marcadores: Array<{ local: number; visitante: number }>;
    /* Puntos obtenidos una vez resuelta la jornada. */
    puntos?: number;
    exactos?: number;
    estado: 'pendiente' | 'calificada';
}

export interface Pick {
    id: string;
    uid: string;
    alias: string;
    jornada: number;
    equipo: string;
    estado: 'pendiente' | 'sobrevive' | 'eliminado';
}