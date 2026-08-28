/**
 * Novedades de cada versión, de la más reciente a la más antigua.
 *
 * Aquí solo van los cambios que valen la pena anunciar: reglas nuevas,
 * secciones nuevas, cosas que cambian cómo se juega o qué se puede hacer.
 * Es decir, versiones MAYOR o MENOR.
 *
 * Los parches (el tercer número) NO llevan entrada: ajustes visuales,
 * correcciones y afinaciones se despliegan en silencio. Si cada arreglo
 * abriera un modal, la gente lo cerraría sin leer y el aviso dejaría de
 * servir justo cuando haya algo importante que decir.
 *
 * Al anunciar algo: sube APP_VERSION en core/version.ts y agrega su
 * entrada arriba de este arreglo.
 *
 * Escribe los puntos desde lo que gana el jugador, no desde lo que
 * cambió por dentro: "ya puedes ver los cartones de todos" en vez de
 * "se agregó la colección quinielas".
 */
export interface Novedad {
    version: string;
    fecha: string;
    /* Una línea que resuma el conjunto. Sale como subtítulo. */
    resumen: string;
    puntos: Array<{ icono: string; titulo: string; detalle: string }>;
}

export const NOVEDADES: Novedad[] = [
    {
        version: '2.2.0',
        fecha: 'Septiembre 2026',
        resumen: 'Grupos privados, eliminatorias y tu saldo con su historial a un toque.',
        puntos: [
            {
                icono: 'ti-users-group',
                titulo: 'Grupos privados',
                detalle:
                    'Crea tu propio grupo, invita a tus amigos con un código y compitan en una ' +
                    'tabla aparte, solo entre ustedes. Los puntos son los mismos de siempre, pero ' +
                    'ahora tienes tu liga privada para picarte con quien tú quieras.',
            },
            {
                icono: 'ti-sitemap',
                titulo: 'Eliminatorias',
                detalle:
                    'Un formato nuevo tipo llave: pronostica quién avanza ronda por ronda hasta la ' +
                    'final y quién se corona campeón. Cuando cierra, puedes ver los cuadros de todos ' +
                    'y comparar tu camino con el de los demás.',
            },
            {
                icono: 'ti-ticket',
                titulo: 'Eliminatorias por dueños',
                detalle:
                    'Otra forma de jugar las llaves: en vez de pronosticar, te toca un equipo del ' +
                    'cuadro como si fuera una rifa. Aceptas tu equipo y, si llega a campeón, te ' +
                    'llevas la bolsa completa. Pura suerte y aguante.',
            },
            {
                icono: 'ti-coins',
                titulo: 'Tu saldo, con su historia',
                detalle:
                    'Toca tus puntos en la barra de arriba y verás de dónde salió cada uno: qué ' +
                    'ganaste, qué gastaste y en qué. Todo tu movimiento de puntos en un solo lugar, ' +
                    'a un toque.',
            },
        ],
    },
    {
        version: '2.1.0',
        fecha: 'Agosto 2026',
        resumen: 'Escudos de los equipos, avisos al teléfono y la app instalable.',
        puntos: [
            {
                icono: 'ti-shield',
                titulo: 'Escudos de los equipos',
                detalle:
                    'Ahora ves el escudo de cada equipo en los partidos, los torneos y las ' +
                    'eliminatorias. Reconoces al vuelo quién juega, sin leer nombre por nombre. ' +
                    'Incluye Liga MX, MLS, LaLiga y selecciones.',
            },
            {
                icono: 'ti-bell',
                titulo: 'Avisos directo a tu teléfono',
                detalle:
                    'Actívalos desde tu perfil y recibe una notificación cuando abra una jornada, ' +
                    'salgan resultados o haya novedades en tus torneos, aunque no tengas la app ' +
                    'abierta. Un interruptor para prender y apagar cuando quieras.',
            },
            {
                icono: 'ti-download',
                titulo: 'Agrégala a tu pantalla de inicio',
                detalle:
                    'Desde tu perfil puedes agregar la app a la pantalla de inicio de tu teléfono y ' +
                    'abrirla como cualquier otra, sin buscar el enlace cada vez. Funciona en Android ' +
                    'y iPhone.',
            },
            {
                icono: 'ti-bell-ringing',
                titulo: 'Tus movimientos a la mano',
                detalle:
                    'Un acceso rápido en la parte de arriba para ver de un vistazo tus últimos ' +
                    'movimientos de puntos, sin salir de donde estás. Para el detalle completo, ' +
                    'de ahí saltas a tu historial.',
            },
        ],
    },
    {
        version: '2.0.0',
        fecha: 'Agosto 2026',
        resumen: 'Llegaron las eliminatorias: arma tu cuadro y compite hasta el campeón.',
        puntos: [
            {
                icono: 'ti-sitemap',
                titulo: 'Eliminatorias tipo liguilla',
                detalle:
                    'Antes de que arranque, llenas el cuadro completo: eliges quién avanza en cada ' +
                    'llave hasta coronar a tu campeón. Ganas más puntos mientras más lejos aciertes, ' +
                    'y clavar al campeón vale el premio mayor.',
            },
            {
                icono: 'ti-trophy',
                titulo: 'Aciertas por equipo, no por posición',
                detalle:
                    'Si dijiste que un equipo llegaría a semifinales y llegó, cuenta — sin importar ' +
                    'dónde lo pusiste en tu cuadro. Cada acierto suma con justicia.',
            },
            {
                icono: 'ti-eye',
                titulo: 'Todo a la vista y auditable',
                detalle:
                    'Consulta cómo se juega y cuánto vale cada acierto antes de entrar, con un ejemplo ' +
                    'real para que no queden dudas. Nadie ve tu cuadro hasta el cierre, y al final la ' +
                    'tabla muestra los puntos de todos.',
            },
            {
                icono: 'ti-receipt',
                titulo: 'Historial de tus movimientos',
                detalle:
                    'Desde tu perfil puedes revisar todos tus movimientos de puntos: entradas, ' +
                    'premios y ajustes, con su fecha. Para que hagas tus cuentas cuando quieras.',
            },
        ],
    },
    {
        version: '1.1.0',
        fecha: 'Julio 2026',
        resumen: 'Llegaron los torneos por invitación y los avisos por Telegram.',
        puntos: [
            {
                icono: 'ti-tournament',
                titulo: 'Torneos entre amigos',
                detalle:
                    'Crea un torneo, comparte el enlace y compite en grupo. Hay dos formas de jugar: ' +
                    'supervivencia, donde eliges un equipo por jornada y si pierde quedas fuera, ' +
                    'y quiniela por puntos, donde pronosticas todos los marcadores.',
            },
            {
                icono: 'ti-brand-telegram',
                titulo: 'Avisos por Telegram',
                detalle:
                    'Conéctalo desde tu perfil con un toque y te aviso cuando abra una jornada, ' +
                    'mientras todavía hay tiempo de elegir, y cuando salgan los resultados.',
            },
            {
                icono: 'ti-eye',
                titulo: 'Todo a la vista',
                detalle:
                    'Cuando cierra la jornada puedes ver qué eligió cada quien y, en quiniela, ' +
                    'el cartón completo de todos con los puntos que sacó en cada partido.',
            },
            {
                icono: 'ti-medal',
                titulo: 'Podio y trofeos',
                detalle:
                    'El ranking ahora arranca con el podio y tu lugar. Y cada torneo que ganes ' +
                    'deja su trofeo en tu perfil.',
            },
        ],
    },
    {
        version: '1.0.0',
        fecha: 'Julio 2026',
        resumen: 'La primera versión de la app.',
        puntos: [
            {
                icono: 'ti-ball-football',
                titulo: 'Pronósticos con bolsa',
                detalle:
                    'Apuesta puntos a un resultado. Lo que pierden los demás se reparte entre ' +
                    'quienes acertaron, en proporción a lo que arriesgaron.',
            },
            {
                icono: 'ti-trophy',
                titulo: 'Ranking',
                detalle:
                    'Tabla por porcentaje de acierto, con rachas y desempates. Tu perfil guarda ' +
                    'tus estadísticas de siempre.',
            },
        ],
    },
];