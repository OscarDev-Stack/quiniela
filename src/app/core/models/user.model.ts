export interface AppUser {
    id: string;
    email: string;
    /* Nombre público que se muestra en el ranking. */
    alias?: string;
    rol: 'user' | 'admin';
    /* Cuenta validada por un administrador para poder participar. */
    validada: boolean;
    /* Bloqueado por alcanzar el tope inferior de puntos. */
    bloqueado: boolean;

    /* Saldo disponible para apostar. El administrador puede reiniciarlo. */
    puntos?: number;
    /* Acumulado histórico de todos los movimientos. Nunca se reinicia. */
    puntosHistoricos?: number;

    /* Contadores que mantiene la liquidación. */
    aciertos?: number;
    resueltos?: number;
    /* Aciertos consecutivos. */
    racha?: number;
    mejorRacha?: number;

    /* Torneos de supervivencia ganados. */
    torneosGanados?: number;
    /* Ids de los torneos en los que participo. */
    torneos?: string[];

    /* Con qué saldo se pidió el último reinicio. Evita repetirla. */
    solicitudReinicio?: { saldo: number } | null;

    /* Avisos por Telegram. */
    telegramChatId?: string;
    notificaciones?: boolean;
    /* Código temporal mientras se conecta Telegram. */
    vinculoTelegram?: { codigo: string } | null;

    createdAt?: unknown;
}