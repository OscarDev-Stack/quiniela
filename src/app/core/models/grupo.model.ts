/**
 * Un grupo (competencia privada entre conocidos): un conjunto de personas que
 * compiten entre sí. Es una capa de organización y visibilidad, NO de dinero:
 * los puntos siguen siendo globales. Un torneo/partido pertenece a un grupo
 * (grupoId) o es Global.
 */
export interface Grupo {
    id: string;
    nombre: string;
    /* Emoji o clave de ícono que lo representa. */
    icono: string;
    /* Código para unirse (ej. "BARRIO7"). */
    codigo: string;
    /* Uid de quien lo administra (su creador, salvo transferencia). */
    adminUid: string;
    /* Cuántos miembros tiene (lo mantiene una Cloud Function). */
    miembrosCount?: number;
    createdAt?: unknown;
    esPrueba?: boolean;
}

/** Un miembro de un grupo. Vive en grupos/{id}/miembros/{uid}. */
export interface MiembroGrupo {
    uid: string;
    /* Copia del alias para mostrar sin buscar el usuario. */
    alias: string;
    rol: 'admin' | 'miembro';
    entradaAt?: unknown;
}

/**
 * La fila de un usuario en la tabla de un grupo. Vive en
 * grupos/{id}/tabla/{uid}. Guarda los aciertos SOLO dentro de ese grupo,
 * para que el % sea real por grupo (no el global).
 */
export interface FilaTablaGrupo {
    uid: string;
    alias: string;
    aciertos: number;
    resueltos: number;
    porcentaje: number;
    actualizado?: unknown;
}