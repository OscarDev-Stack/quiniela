export interface Trofeo {
    id: string;
    uid: string;
    alias: string;
    torneoId: string;
    /* Nombre del torneo ganado. */
    torneo: string;
    competicion: string;
    premio: number;
    /* true si la bolsa se repartió entre varios. */
    compartido: boolean;
    ganadoEn?: unknown;
}