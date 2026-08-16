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