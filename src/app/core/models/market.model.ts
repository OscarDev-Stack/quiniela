export type MarketType = '1x2' | '1-2' | 'quien-pasa';

export type MarketStatus = 'abierto' | 'cierra-pronto' | 'en-juego';

export interface OutcomePrize {
    label: string;
    value: number;
}

export interface Market {
    id: string;
    competition: string;
    homeTeam: string;
    awayTeam: string;
    type: MarketType;
    status: MarketStatus;
    closesLabel: string;
    poolTotal?: number;
    prizes?: OutcomePrize[];
}