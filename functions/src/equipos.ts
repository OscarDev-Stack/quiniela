/**
 * Normalización de nombres de equipos para las funciones.
 *
 * Los nombres que llegan de TheSportsDB ("Tigres UANL", "Santos Laguna",
 * "America"...) no siempre coinciden con los nombres oficiales que el admin
 * usa en el catálogo de la competición. Este mapa traduce los alias de la API
 * al nombre oficial, para que los partidos generados calcen con los equipos ya
 * cargados. Solo cubre Liga MX por ahora.
 */

interface EquipoAlias {
    nombre: string;
    alias: string[];
}

const LIGA_MX: EquipoAlias[] = [
    { nombre: 'América', alias: ['america', 'club america'] },
    { nombre: 'Guadalajara', alias: ['guadalajara', 'chivas', 'cd guadalajara'] },
    { nombre: 'Cruz Azul', alias: ['cruz azul', 'cruzazul'] },
    { nombre: 'Pumas', alias: ['pumas', 'pumas unam', 'unam'] },
    { nombre: 'Monterrey', alias: ['monterrey', 'rayados', 'cf monterrey'] },
    { nombre: 'Tigres', alias: ['tigres', 'tigres uanl', 'uanl'] },
    { nombre: 'Toluca', alias: ['toluca', 'deportivo toluca'] },
    { nombre: 'Pachuca', alias: ['pachuca', 'cf pachuca'] },
    { nombre: 'Santos', alias: ['santos', 'santos laguna'] },
    { nombre: 'León', alias: ['leon', 'club leon'] },
    { nombre: 'Atlas', alias: ['atlas', 'atlas fc'] },
    { nombre: 'Necaxa', alias: ['necaxa'] },
    { nombre: 'Puebla', alias: ['puebla', 'club puebla'] },
    { nombre: 'Querétaro', alias: ['queretaro', 'gallos'] },
    { nombre: 'Atlético San Luis', alias: ['atletico san luis', 'atletico de san luis', 'san luis'] },
    { nombre: 'Atlante', alias: ['atlante', 'club atlante', 'atlante fc'] },
    { nombre: 'Juárez', alias: ['juarez', 'fc juarez', 'bravos'] },
    { nombre: 'Tijuana', alias: ['tijuana', 'xolos', 'club tijuana'] },
];

/** Quita acentos, espacios extra y pasa a minúsculas, para comparar sin fallar. */
function normalizar(texto: string): string {
    return texto
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
}

// Índice alias/nombre -> nombre oficial.
const INDICE = new Map<string, string>();
for (const eq of LIGA_MX) {
    INDICE.set(normalizar(eq.nombre), eq.nombre);
    for (const a of eq.alias) INDICE.set(normalizar(a), eq.nombre);
}

/**
 * Traduce un nombre de la API al nombre oficial del catálogo si lo reconoce;
 * si no, lo deja limpio tal cual. Así los partidos generados calzan con los
 * equipos que el admin ya tiene cargados en la competición.
 */
export function nombreOficial(nombre: string | null | undefined): string {
    if (!nombre) return '';
    return INDICE.get(normalizar(nombre)) ?? nombre.trim();
}
