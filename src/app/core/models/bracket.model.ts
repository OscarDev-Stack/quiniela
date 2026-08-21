/**
 * BRACKET — quiniela de eliminatoria (liguilla, Champions, Mundial).
 *
 * A diferencia de un torneo por jornadas, aquí se llena un cuadro
 * completo antes de que empiece, se congela con un cierre único, y
 * se ganan puntos según qué tan lejos acierta cada quien.
 *
 * El motor es genérico: los mismos datos cubren la liguilla MX, la
 * Champions o un Mundial, cambiando solo la configuración.
 */

export type EstadoBracket =
    | 'armando' // el admin está montando el cuadro
    | 'inscripcion' // cuadro listo, la gente llena su pronóstico
    | 'en-curso' // cerró el pronóstico, se juegan las rondas
    | 'finalizado';

/**
 * Cómo se juega el bracket.
 *  pronostico → cada jugador llena el cuadro completo y gana por acertar.
 *  duenos     → el admin asigna cada equipo a un participante (una porra
 *               de dueños). No se predice nada: gana quien tenga al campeón.
 */
export type ModoBracket = 'pronostico' | 'duenos';

/** Cómo se arma el cuadro inicial. */
export type ArmadoCuadro =
    | 'siembra' // 1°vs8°, 2°vs7°… se acomoda solo por posición
    | 'manual'; // el admin define los cruces a mano (sorteos)

/** Cómo se forman los cruces al pasar de ronda. */
export type AvanceCuadro =
    | 'reordena' // cada ronda: mejor posicionado vs peor (liguilla MX)
    | 'fijo'; // cruces congelados desde el inicio (Champions)

/** Cómo se juega una llave. */
export type FormatoLlave =
    | 'ida-vuelta' // dos partidos, decide el global
    | 'unico'; // un solo partido

/** Qué pasa si una llave queda empatada en el global. */
export type Desempate =
    | 'mejor-sembrado' // avanza quien venía mejor posicionado (liguilla)
    | 'penales'; // prórroga y penales, puede avanzar cualquiera

/**
 * Configuración con la que se crea el bracket. Es lo que hace que el
 * mismo motor sirva para formatos distintos.
 */
export interface ConfigBracket {
    /* Cuántos equipos entran. Define el número de rondas: 8→3, 16→4. */
    equipos: number;
    armado: ArmadoCuadro;

    /*
     * Cómo se forman los cruces al avanzar de ronda:
     * 'reordena' resiembra cada ronda (liguilla), 'fijo' mantiene el
     * cruce del cuadro inicial (Champions).
     */
    avance: AvanceCuadro;

    /* Formato de las rondas previas a la final. */
    formatoRondas: FormatoLlave;
    /* Formato de la final, aparte: puede diferir (Champions la juega única). */
    formatoFinal: FormatoLlave;

    /* Desempate de las rondas y de la final, por separado. */
    desempateRondas: Desempate;
    desempateFinal: Desempate;

    /*
     * Cómo se reparte la bolsa entre los primeros lugares, en porcentaje.
     * [100] = todo al primero. [80, 20] = 80% al 1°, 20% al 2°.
     * La suma debe dar 100.
     */
    reparto: number[];
}

/**
 * Puntos por acertar. Se pueden ganar por tres vías que suman.
 * Los valores son configurables; estos son los de arranque.
 */
export interface PuntajeBracket {
    /* Acertar quién avanza, por ronda. El índice 0 es la primera ronda. */
    avanzaPorRonda: number[]; // ej. [10, 20, 40] para cuartos, semis, final
    /* Bono extra si aciertas al campeón. */
    campeon: number;
    /* Bono por cada finalista acertado. */
    finalista: number;
    /*
     * Bonos de marcador. El marcador es OPCIONAL: quien no lo llena no
     * pierde puntos de avance, solo no gana estos bonos. Se puntúa sobre
     * el GLOBAL de la llave, no partido por partido.
     */
    marcadorExacto: number; // global exacto (ej. 3-1 global)
    marcadorResultado: number; // solo acertar quién gana la llave
}

/** Un equipo dentro del cuadro, con su siembra (posición de origen). */
export interface EquipoBracket {
    nombre: string;
    /* Posición de siembra, 1 = mejor. Se usa para armar y desempatar. */
    siembra: number;
}

/**
 * Modo 'duenos': la asignación de un equipo a un participante.
 * El dueño puede ser un usuario registrado (uid + alias) o un invitado
 * que solo tiene nombre (lo gestiona el admin, no cobra ni avisa).
 *
 * El estado sigue el flujo de invitación con aceptación:
 *  invitado  → se le mandó el aviso, aún no acepta ni se le cobró.
 *  aceptado  → aceptó las reglas y se le cobró la entrada.
 *  invitado-sin-registro → es un invitado externo (sin cuenta), va directo.
 */
export interface DuenoEquipo {
    /* Nombre del equipo asignado (coincide con EquipoBracket.nombre). */
    equipo: string;
    /* uid del usuario registrado, o null si es invitado externo. */
    uid: string | null;
    /* Nombre que se muestra: el alias del registrado o el nombre del invitado. */
    nombre: string;
    /* Si es un invitado externo sin cuenta. */
    invitado: boolean;
    /* Estado de la invitación/cobro. */
    estado: 'invitado' | 'aceptado' | 'invitado-sin-registro';
}

/**
 * Una llave del cuadro: el enfrentamiento entre dos equipos en una
 * ronda. Puede tener uno o dos partidos según el formato.
 */
export interface Llave {
    /* Identificador estable dentro del cuadro, ej. 'R1-L2' (ronda 1, llave 2). */
    id: string;
    /* Ronda a la que pertenece: 0 = primera. */
    ronda: number;
    /* Posición de la llave dentro de su ronda: 0 = arriba. */
    posicion: number;

    /* Los dos lados. Pueden estar vacíos hasta que se resuelva la ronda previa. */
    local?: EquipoBracket;
    visitante?: EquipoBracket;

    /* Marcadores reales, capturados por el admin. */
    partidos: PartidoLlave[];

    /* Quién avanzó, una vez resuelta. */
    ganador?: EquipoBracket;
    /* Cómo se decidió, para mostrarlo: 'global', 'mejor-sembrado', 'penales'. */
    resueltoPor?: 'global' | 'mejor-sembrado' | 'penales';
}

/** Un partido dentro de una llave (ida, vuelta, o único). */
export interface PartidoLlave {
    /* 'ida' | 'vuelta' | 'unico' — para etiquetarlo. */
    tipo: 'ida' | 'vuelta' | 'unico';
    golesLocal?: number | null;
    golesVisitante?: number | null;
    /* Solo en la final a penales: quién ganó la tanda. */
    ganaPenales?: 'local' | 'visitante' | null;
}

/*
 * REGLAS DE CALIFICACIÓN (referencia para la Fase 4):
 *
 *  · Si tu equipo pronosticado ya fue eliminado en el cuadro real,
 *    esa llave vale cero y el pronóstico sigue con las demás.
 *
 *  · El marcador es opcional. Quien lo llena puede ganar los bonos;
 *    quien no, compite solo por los puntos de avance. Se evalúa
 *    sobre el global de la llave, no por partido.
 *
 *  · Desempate entre jugadores con los mismos puntos, en orden:
 *      1) más marcadores (globales) acertados
 *      2) más aciertos en rondas avanzadas (la final pesa más)
 *      3) si sigue igual, comparten posición
 *
 *  · La bolsa se reparte según config.reparto (ej. 80/20 al 1° y 2°).
 */

/** El documento principal del bracket. */
export interface Bracket {
    id: string;
    nombre: string;
    config: ConfigBracket;
    puntaje: PuntajeBracket;

    estado: EstadoBracket;
    codigo: string;

    /* El cuadro completo: todas las llaves de todas las rondas. */
    llaves: Llave[];

    /* Lista de equipos del bracket. Sirve para armar los cruces a mano. */
    equipos?: EquipoBracket[];

    /*
     * Modo de juego. Si falta, es 'pronostico' por compatibilidad con los
     * brackets creados antes de este campo.
     */
    modo?: ModoBracket;

    /*
     * Solo en modo 'duenos': a quién le tocó cada equipo. La clave es el
     * nombre del equipo. Un dueño puede ser un usuario registrado (con uid)
     * o un invitado que gestiona el admin (solo nombre).
     */
    duenos?: DuenoEquipo[];

    /* Cierre único del pronóstico, antes del primer partido. */
    cierraAt?: { seconds: number } | Date | null;

    costoEntrada: number;
    bolsa: number;
    premioPagado?: number;

    /* Público: aparece en el inicio y cualquiera puede unirse sin invitación. */
    publico?: boolean;

    ganadorAlias?: string;
    gestores?: string[];
    creadoPor?: string;
    createdAt?: unknown;
}

/**
 * El pronóstico congelado de un jugador: para cada llave del cuadro,
 * a quién puso como ganador y, si aplica, con qué marcador.
 */
export interface PronosticoBracket {
    id: string;
    uid: string;
    alias: string;

    /* Por llave (mismo id que en el cuadro), a quién puso a avanzar. */
    avances: Record<string, string>; // idLlave → nombre del equipo
    /*
     * Marcador GLOBAL pronosticado por llave. Opcional: si no está,
     * el jugador solo compite por puntos de avance. idLlave → global.
     */
    marcadores?: Record<string, { local: number; visitante: number }>;
    /* ¿Llenó los marcadores? Para saber si entra a los bonos. */
    conMarcador?: boolean;

    puntos?: number;
    /* Lugar y premio, calculados al cerrar. */
    posicion?: number;
    premio?: number;
    estado: 'pendiente' | 'calificado';
}

/** Cuántas rondas tiene un cuadro de N equipos (8→3, 16→4). */
export function rondasDe(equipos: number): number {
    return Math.max(1, Math.round(Math.log2(equipos)));
}

/** Nombre de una ronda según cuántas quedan por delante. */
export function nombreRonda(ronda: number, totalRondas: number): string {
    const desdeElFinal = totalRondas - ronda; // 1 = final
    switch (desdeElFinal) {
        case 1:
            return 'Final';
        case 2:
            return 'Semifinal';
        case 3:
            return 'Cuartos de final';
        case 4:
            return 'Octavos de final';
        case 5:
            return 'Dieciseisavos';
        default:
            return `Ronda ${ronda + 1}`;
    }
}