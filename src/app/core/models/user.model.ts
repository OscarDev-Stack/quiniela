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
    /* Ids de las eliminatorias en las que participo. */
    brackets?: string[];

    /* Con qué saldo se pidió el último reinicio. Evita repetirla. */
    solicitudReinicio?: { saldo: number } | null;

    /* Avisos por Telegram. */
    telegramChatId?: string;
    notificaciones?: boolean;

    /* Notificaciones push (PWA): switch y tokens de dispositivos. */
    pushActivo?: boolean;
    pushTokens?: string[];

    /* Preferencias de categoría de notificaciones (qué tipos quiere recibir).
       Es independiente del canal (push/Telegram). Defaults: inscritos ON,
       oportunidades OFF, partidos ON. */
    prefsNotif?: {
        torneosInscritos?: boolean;
        oportunidades?: boolean;
        partidos?: boolean;
    };

    /* Cuenta de puro administrador: no aparece en el ranking. */
    noParticipa?: boolean;
    /* Código temporal mientras se conecta Telegram. */
    vinculoTelegram?: { codigo: string } | null;

    /* GRUPOS (ligas privadas) */
    /* Puede crear y administrar grupos. Lo activa el super admin. */
    esAdminGrupo?: boolean;
    /* Ids de los grupos a los que pertenezco. */
    grupos?: string[];
    /* Ids de los grupos marcados como favoritos (acceso rápido). */
    gruposFavoritos?: string[];

    createdAt?: unknown;
}