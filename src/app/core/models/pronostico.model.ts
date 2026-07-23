export type ResultadoPronostico =
    | 'local'
    | 'empate'
    | 'visitante'
    | 'pasa-local'
    | 'pasa-visitante';

export type EstadoPronostico = 'activo' | 'ganado' | 'perdido' | 'devuelto';

export interface Pronostico {
    id: string;
    uid: string;
    partidoId: string;
    partidoLabel: string;
    resultado: ResultadoPronostico;
    /* Puntos apostados: 100 × multiplicador. */
    apuesta: number;
    multiplicador: number;
    estado: EstadoPronostico;
    /* Premio bruto recibido de la bolsa (se llena al liquidar). */
    premio?: number;
    createdAt?: unknown;
}

/** Ganancia neta: lo que realmente ganó o perdió el usuario. */
export function gananciaNeta(p: Pronostico): number {
    switch (p.estado) {
        case 'ganado':
            return (p.premio ?? 0) - p.apuesta;
        case 'perdido':
            return -p.apuesta;
        default:
            return 0; // activo o devuelto
    }
}