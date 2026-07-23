export interface Bolsa {
    id: string;
    partidoId: string;
    total: number;
    porResultado?: Record<string, number>;
    conteos?: Record<string, number>;
}