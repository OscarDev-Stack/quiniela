/**
 * Logo de la liga a partir del nombre de la competición.
 *
 * La idea: en las tarjetas de torneos y eliminatorias mostramos el logo de la
 * liga cuando el nombre contiene un alias conocido (por ejemplo "Liga MX",
 * "LigaMX", "Premier"...). Es tolerante: no importa mayúsculas, acentos ni
 * espacios extra, así "liga mx", "LIGA MX" y "LigaMX" caen en el mismo logo.
 *
 * Si el nombre no contiene ningún alias conocido, devuelve null y la tarjeta
 * sigue mostrando solo el texto, sin huecos rotos.
 */

/** Cada logo con los alias que lo disparan. El archivo vive en public/ligas. */
interface LogoLiga {
    archivo: string;
    /* Alias en minúsculas y sin acentos; se buscan como subcadena. */
    alias: string[];
}

const LOGOS_LIGA: LogoLiga[] = [
    { archivo: 'mexico.png', alias: ['liga mx', 'ligamx', 'mexico', 'liga bbva mx'] },
    { archivo: 'espana2.png', alias: ['laliga', 'la liga', 'espana', 'liga espanola', 'primera division'] },
    { archivo: 'inglaterra.png', alias: ['premier league', 'premier', 'inglaterra', 'epl'] },
    { archivo: 'italia.png', alias: ['serie a', 'italia', 'calcio'] },
    { archivo: 'alemania.png', alias: ['bundesliga', 'alemania'] },
    { archivo: 'francia.png', alias: ['ligue 1', 'ligue1', 'francia'] },
    { archivo: 'champions.png', alias: ['champions league', 'champions', 'ucl', 'liga de campeones'] },
    { archivo: 'NFL.png', alias: ['nfl', 'futbol americano'] },
];

/** Normaliza: minúsculas, sin acentos y con espacios compactados. */
function normaliza(texto: string): string {
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // quita acentos
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Ruta del logo de la liga si el nombre contiene un alias conocido; null si no.
 * @param nombre Nombre de la competición o del torneo/eliminatoria.
 */
export function logoLigaDe(nombre: string | null | undefined): string | null {
    if (!nombre) return null;
    const n = normaliza(nombre);
    for (const logo of LOGOS_LIGA) {
        if (logo.alias.some((a) => n.includes(a))) {
            return `ligas/${logo.archivo}`;
        }
    }
    return null;
}
