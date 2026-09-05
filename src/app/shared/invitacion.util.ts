/**
 * Invitación pendiente unificada (torneo / eliminatoria / grupo).
 *
 * Cuando alguien SIN sesión abre un enlace o QR de invitación, guardamos aquí
 * a qué quería unirse; tras iniciar sesión o registrarse, la app la retoma y
 * lo lleva a la pantalla correspondiente. Se consume UNA sola vez (se borra al
 * leerla), para que no reaparezca en cada login ni al abrir pestañas nuevas.
 */

export type TipoInvitacion = 'torneo' | 'bracket' | 'grupo';

export interface InvitacionPendiente {
    tipo: TipoInvitacion;
    /** Código de invitación (torneo/bracket/grupo). */
    valor: string;
}

const CLAVE = 'invitacionPendiente';

/** Guarda la invitación pendiente. Solo debe llamarse cuando NO hay sesión. */
export function guardarInvitacion(tipo: TipoInvitacion, valor: string): void {
    if (!valor) return;
    try {
        localStorage.setItem(CLAVE, JSON.stringify({ tipo, valor }));
    } catch {
        /* localStorage no disponible: sin invitación persistente. */
    }
}

/** Lee la invitación pendiente sin borrarla (null si no hay). */
export function leerInvitacion(): InvitacionPendiente | null {
    try {
        const raw = localStorage.getItem(CLAVE);
        if (!raw) return migrarViejas();
        const obj = JSON.parse(raw) as InvitacionPendiente;
        if (obj && obj.tipo && obj.valor) return obj;
    } catch {
        /* dato corrupto: lo ignoramos. */
    }
    return null;
}

/** Lee la invitación y la BORRA (consumo estricto: una sola vez). */
export function consumirInvitacion(): InvitacionPendiente | null {
    const inv = leerInvitacion();
    limpiarInvitacion();
    return inv;
}

/** Borra cualquier invitación pendiente (y las claves antiguas). */
export function limpiarInvitacion(): void {
    try {
        localStorage.removeItem(CLAVE);
        localStorage.removeItem('invitacion'); // clave antigua (torneos)
        localStorage.removeItem('invitacionGrupo'); // clave antigua (grupos)
    } catch {
        /* nada que limpiar. */
    }
}

/** La ruta a la que lleva una invitación según su tipo. */
export function rutaDeInvitacion(inv: InvitacionPendiente): string[] {
    switch (inv.tipo) {
        case 'torneo':
            return ['/unirse', inv.valor];
        case 'bracket':
            return ['/unirse-elim', inv.valor];
        case 'grupo':
            return ['/unirse-grupo', inv.valor];
        default:
            return ['/inicio'];
    }
}

/**
 * Compatibilidad hacia atrás: si quedó una invitación guardada con el esquema
 * viejo ('invitacion' = código de torneo, 'invitacionGrupo' = código de grupo),
 * la convierte al nuevo formato para no perderla.
 */
function migrarViejas(): InvitacionPendiente | null {
    try {
        const torneo = localStorage.getItem('invitacion');
        if (torneo) return { tipo: 'torneo', valor: torneo };
        const grupo = localStorage.getItem('invitacionGrupo');
        if (grupo) return { tipo: 'grupo', valor: grupo };
    } catch {
        /* nada. */
    }
    return null;
}

/** Mapea un segmento de ruta ("unirse", "unirse-elim"...) a su tipo. */
const SEGMENTO_A_TIPO: Record<string, TipoInvitacion> = {
    unirse: 'torneo',
    'unirse-elim': 'bracket',
    'unirse-grupo': 'grupo',
};

/** Formato de un código de invitación: 6 caracteres del alfabeto sin ambiguos. */
const CODIGO_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4,10}$/;

/**
 * Interpreta el texto leído de un QR (o pegado a mano) y devuelve la invitación
 * a la que apunta, o null si no se reconoce.
 *
 * Acepta dos formas:
 *  1) Un deep-link como "https://misitio.com/unirse-grupo/ABC123" (lo que
 *     codifican nuestros QR). Se extrae el segmento de ruta y el código.
 *  2) Un código suelto ("ABC123"): se asume torneo por omisión, salvo que se
 *     indique un tipo por defecto distinto.
 *
 * El tipo por defecto solo se usa para el caso 2 (código pelado). Para el caso
 * 1 mandan siempre el segmento de la URL.
 */
export function interpretarQr(
    texto: string,
    tipoPorDefecto: TipoInvitacion = 'torneo',
): InvitacionPendiente | null {
    const limpio = (texto ?? '').trim();
    if (!limpio) return null;

    // Caso 1: es una URL con una ruta de "unirse".
    const url = intentarUrl(limpio);
    if (url) {
        const segmentos = url.pathname.split('/').filter(Boolean);
        // Buscamos el par [segmentoRuta, codigo] en la ruta.
        for (let i = 0; i < segmentos.length - 1; i++) {
            const tipo = SEGMENTO_A_TIPO[segmentos[i]];
            if (tipo) {
                const valor = decodeURIComponent(segmentos[i + 1]).toUpperCase();
                if (valor) return { tipo, valor };
            }
        }
        return null; // Es una URL, pero no una de nuestras invitaciones.
    }

    // Caso 2: un código suelto.
    const valor = limpio.toUpperCase();
    if (CODIGO_RE.test(valor)) return { tipo: tipoPorDefecto, valor };

    return null;
}

/** Devuelve la URL parseada si el texto es una URL http(s), o null. */
function intentarUrl(texto: string): URL | null {
    if (!/^https?:\/\//i.test(texto)) return null;
    try {
        return new URL(texto);
    } catch {
        return null;
    }
}
