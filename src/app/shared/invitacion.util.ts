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
