/**
 * ARMADO Y AVANCE DEL CUADRO — lógica pura, sin Firebase.
 *
 * Separada del servicio a propósito: así se puede probar sola y
 * razonar sobre ella sin depender de la base de datos. Toma equipos
 * y configuración, devuelve el cuadro de llaves; y sabe avanzar al
 * ganador de una llave a la siguiente ronda.
 */

import {
    AvanceCuadro,
    ConfigBracket,
    EquipoBracket,
    PuntajeBracket,
    Llave,
    PartidoLlave,
    rondasDe,
} from '../models/bracket.model';

/**
 * Ordena los cruces de la primera ronda por siembra: 1°vs8°, 2°vs7°…
 * Es el emparejamiento estándar que mantiene separados a los mejores
 * hasta las rondas finales.
 */
function cruceSembrado(equipos: EquipoBracket[]): Array<[EquipoBracket, EquipoBracket]> {
    const orden = [...equipos].sort((a, b) => a.siembra - b.siembra);
    const cruces: Array<[EquipoBracket, EquipoBracket]> = [];
    let i = 0;
    let j = orden.length - 1;
    while (i < j) {
        cruces.push([orden[i], orden[j]]);
        i++;
        j--;
    }
    return cruces;
}

/** Cuántos partidos tiene una llave según su formato. */
function partidosDeLlave(formato: 'ida-vuelta' | 'unico'): PartidoLlave[] {
    if (formato === 'unico') {
        return [{ tipo: 'unico', golesLocal: null, golesVisitante: null }];
    }
    return [
        { tipo: 'ida', golesLocal: null, golesVisitante: null },
        { tipo: 'vuelta', golesLocal: null, golesVisitante: null },
    ];
}

/**
 * Arma el cuadro completo desde la configuración.
 * En siembra, la primera ronda queda emparejada; las siguientes
 * nacen vacías y se van llenando conforme avanzan los ganadores.
 * En manual, todas las llaves nacen vacías para que el admin las llene.
 */
export function armarCuadro(config: ConfigBracket, equipos: EquipoBracket[]): Llave[] {
    const totalRondas = rondasDe(config.equipos);
    const llaves: Llave[] = [];

    for (let ronda = 0; ronda < totalRondas; ronda++) {
        const llavesEnRonda = config.equipos / Math.pow(2, ronda + 1);
        const esFinal = ronda === totalRondas - 1;
        const formato = esFinal ? config.formatoFinal : config.formatoRondas;

        for (let pos = 0; pos < llavesEnRonda; pos++) {
            llaves.push({
                id: `R${ronda}-L${pos}`,
                ronda,
                posicion: pos,
                partidos: partidosDeLlave(formato),
            });
        }
    }

    // Con siembra, sembramos la primera ronda de una vez.
    if (config.armado === 'siembra' && equipos.length === config.equipos) {
        const cruces = cruceSembrado(equipos);
        cruces.forEach(([local, visitante], pos) => {
            const llave = llaves.find((l) => l.ronda === 0 && l.posicion === pos);
            if (llave) {
                llave.local = local;
                llave.visitante = visitante;
            }
        });
    }

    return llaves;
}

/**
 * Decide el global de una llave a partir de sus partidos.
 * Devuelve los goles de cada lado sumando ida y vuelta, o el único.
 */
export function globalDeLlave(llave: Llave): { local: number; visitante: number } | null {
    let local = 0;
    let visitante = 0;
    let hayDatos = false;

    for (const p of llave.partidos) {
        if (typeof p.golesLocal !== 'number' || typeof p.golesVisitante !== 'number') {
            return null; // falta capturar algún partido
        }
        hayDatos = true;
        if (p.tipo === 'vuelta') {
            // En la vuelta se invierte la localía: el visitante juega en casa.
            local += p.golesVisitante;
            visitante += p.golesLocal;
        } else {
            local += p.golesLocal;
            visitante += p.golesVisitante;
        }
    }

    return hayDatos ? { local, visitante } : null;
}

/**
 * Determina quién avanza de una llave, aplicando la regla de desempate
 * cuando el global queda igualado. Devuelve el ganador y cómo se decidió,
 * o null si aún faltan datos para resolverla.
 */
export function resolverLlave(
    llave: Llave,
    desempate: 'mejor-sembrado' | 'penales',
): { ganador: EquipoBracket; por: 'global' | 'mejor-sembrado' | 'penales' } | null {
    if (!llave.local || !llave.visitante) return null;

    const global = globalDeLlave(llave);
    if (!global) return null;

    if (global.local > global.visitante) {
        return { ganador: llave.local, por: 'global' };
    }
    if (global.visitante > global.local) {
        return { ganador: llave.visitante, por: 'global' };
    }

    // Empate en el global: aplica el desempate.
    if (desempate === 'mejor-sembrado') {
        const gana = llave.local.siembra <= llave.visitante.siembra ? llave.local : llave.visitante;
        return { ganador: gana, por: 'mejor-sembrado' };
    }

    // Penales: hay que haberlos capturado en el último partido.
    const ultimo = llave.partidos[llave.partidos.length - 1];
    if (ultimo.ganaPenales === 'local') return { ganador: llave.local, por: 'penales' };
    if (ultimo.ganaPenales === 'visitante') return { ganador: llave.visitante, por: 'penales' };

    return null; // empate global y aún sin definir penales
}

/**
 * Coloca al ganador de una llave en la ronda siguiente.
 * Las llaves de una ronda alimentan a la mitad: las posiciones 0 y 1
 * caen en la 0 de la ronda siguiente, la 2 y 3 en la 1, etc.
 */
export function avanzarGanador(
    llaves: Llave[],
    resuelta: Llave,
    ganador: EquipoBracket,
    avance: AvanceCuadro = 'fijo',
): Llave[] {
    const siguienteRonda = resuelta.ronda + 1;

    // CRUCES FIJOS (Champions): el ganador va a una posición predeterminada.
    if (avance === 'fijo') {
        const siguientePos = Math.floor(resuelta.posicion / 2);
        const esLocal = resuelta.posicion % 2 === 0;
        return llaves.map((l) => {
            if (l.ronda !== siguienteRonda || l.posicion !== siguientePos) return l;
            return esLocal ? { ...l, local: ganador } : { ...l, visitante: ganador };
        });
    }

    // REORDENA (liguilla): solo se puede emparejar cuando TODA la ronda
    // terminó, porque el cruce depende de quiénes sobrevivieron. Se marca
    // el ganador en la llave resuelta y, si ya están todos, se resiembra.
    const conGanador = llaves.map((l) =>
        l.id === resuelta.id ? { ...l, ganador } : l,
    );

    const rondaActual = conGanador.filter((l) => l.ronda === resuelta.ronda);
    const todosResueltos = rondaActual.every((l) => l.ganador);
    if (!todosResueltos) return conGanador;

    // Todos los ganadores de la ronda, ordenados por posición (mejor primero).
    const ganadores = rondaActual
        .map((l) => l.ganador!)
        .sort((a, b) => a.siembra - b.siembra);

    // Mejor vs peor: 1°vs último, 2°vs penúltimo…
    const cruces: Array<[EquipoBracket, EquipoBracket]> = [];
    let i = 0;
    let j = ganadores.length - 1;
    while (i < j) {
        cruces.push([ganadores[i], ganadores[j]]);
        i++;
        j--;
    }

    return conGanador.map((l) => {
        if (l.ronda !== siguienteRonda) return l;
        const cruce = cruces[l.posicion];
        return cruce ? { ...l, local: cruce[0], visitante: cruce[1] } : l;
    });
}

/**
 * PROPAGACIÓN DEL PRONÓSTICO.
 *
 * En un bracket completo, el jugador elige ganadores desde la primera
 * ronda, y esos ganadores deben aparecer como opciones en la ronda
 * siguiente de SU cuadro. Esta función toma las elecciones hechas
 * hasta ahora y devuelve un cuadro "virtual" donde cada llave muestra
 * a quién llevó el propio jugador — no los resultados reales.
 */
export function cuadroDelPronostico(
    llavesBase: Llave[],
    avances: Record<string, string>,
    avance: AvanceCuadro = 'fijo',
): Llave[] {
    // Copia editable, arrancando de la primera ronda ya sembrada.
    const llaves = llavesBase.map((l) => ({ ...l }));
    const porId = new Map(llaves.map((l) => [l.id, l]));

    const totalRondas = Math.max(...llaves.map((l) => l.ronda)) + 1;

    for (let ronda = 0; ronda < totalRondas - 1; ronda++) {
        const enRonda = llaves.filter((l) => l.ronda === ronda);

        // Ganadores que el jugador eligió en esta ronda.
        const elegidos = enRonda
            .map((llave) => {
                const nombre = avances[llave.id];
                if (!nombre) return null;
                if (llave.local?.nombre === nombre) return llave.local;
                if (llave.visitante?.nombre === nombre) return llave.visitante;
                return null;
            })
            .filter((e): e is EquipoBracket => !!e);

        if (avance === 'reordena') {
            // Solo se puede resembrar cuando la ronda está completa.
            if (elegidos.length !== enRonda.length) continue;
            const ord = [...elegidos].sort((a, b) => a.siembra - b.siembra);
            let i = 0;
            let j = ord.length - 1;
            let pos = 0;
            while (i < j) {
                const sig = porId.get(`R${ronda + 1}-L${pos}`);
                if (sig) {
                    sig.local = ord[i];
                    sig.visitante = ord[j];
                }
                i++;
                j--;
                pos++;
            }
        } else {
            // Cruces fijos: cada llave alimenta una posición predeterminada.
            for (const llave of enRonda) {
                const nombre = avances[llave.id];
                if (!nombre) continue;
                const ganador =
                    llave.local?.nombre === nombre
                        ? llave.local
                        : llave.visitante?.nombre === nombre
                            ? llave.visitante
                            : undefined;
                if (!ganador) continue;
                const sig = porId.get(`R${ronda + 1}-L${Math.floor(llave.posicion / 2)}`);
                if (!sig) continue;
                if (llave.posicion % 2 === 0) sig.local = ganador;
                else sig.visitante = ganador;
            }
        }
    }

    return llaves;
}

/**
 * ¿Está completo el pronóstico? Debe haber un elegido en cada llave
 * que ya tenga sus dos equipos definidos por las elecciones previas.
 */
export function pronosticoCompleto(
    llavesBase: Llave[],
    avances: Record<string, string>,
    avance: AvanceCuadro = 'fijo',
): boolean {
    const cuadro = cuadroDelPronostico(llavesBase, avances, avance);
    return cuadro
        .filter((l) => l.local && l.visitante)
        .every((l) => !!avances[l.id]);
}

/* ============================================================
   CALIFICACIÓN — comparar un pronóstico contra el cuadro real.
   Lógica pura: recibe el cuadro resuelto y las elecciones de un
   jugador, devuelve sus puntos desglosados. Sin Firebase.
   ============================================================ */


export interface DesglosePuntos {
    total: number;
    /* Aciertos de avance, para el desempate por rondas avanzadas. */
    aciertosPorRonda: number[];
    /* Cuántos marcadores globales acertó, para el primer desempate. */
    marcadoresAcertados: number;
}

/**
 * Califica el pronóstico de un jugador contra el cuadro real ya jugado.
 *
 *  · Acertar quién avanza suma según la ronda (avanzaPorRonda).
 *  · Campeón y finalistas dan bonos extra.
 *  · Si llenó marcadores, el global exacto o el resultado dan bono.
 *  · Si su equipo pronosticado no llegó a esa llave (fue eliminado
 *    antes en el cuadro real), esa llave simplemente no suma.
 */
export function calificarPronostico(
    llavesReales: Llave[],
    avances: Record<string, string>,
    marcadores: Record<string, { local: number; visitante: number }> | undefined,
    puntaje: PuntajeBracket,
): DesglosePuntos {
    const totalRondas = Math.max(...llavesReales.map((l) => l.ronda)) + 1;
    const aciertosPorRonda = new Array(totalRondas).fill(0);
    let total = 0;
    let marcadoresAcertados = 0;

    // Se califica POR EQUIPO, no por posición de llave: si dijiste que un
    // equipo avanza a una ronda y de verdad llegó, cuenta — sin importar
    // en qué llave de tu cuadro lo hayas puesto. Esto es más justo en
    // brackets que reordenan, donde un error temprano movería las llaves.

    // Equipos que REALMENTE ganaron en cada ronda (avanzaron a la siguiente).
    const ganadoresRealesPorRonda: Array<Set<string>> = [];
    for (let r = 0; r < totalRondas; r++) {
        const set = new Set<string>();
        for (const l of llavesReales) {
            if (l.ronda === r && l.ganador) set.add(l.ganador.nombre);
        }
        ganadoresRealesPorRonda.push(set);
    }

    // Equipos que el JUGADOR puso a ganar en cada ronda (de su propio cuadro).
    const misGanadoresPorRonda: Array<Set<string>> = [];
    for (let r = 0; r < totalRondas; r++) {
        const set = new Set<string>();
        for (const l of llavesReales) {
            if (l.ronda === r && avances[l.id]) set.add(avances[l.id]);
        }
        misGanadoresPorRonda.push(set);
    }

    for (let r = 0; r < totalRondas; r++) {
        const reales = ganadoresRealesPorRonda[r];
        if (reales.size === 0) continue; // ronda aún sin resolver

        const esFinal = r === totalRondas - 1;
        const esSemis = r === totalRondas - 2;

        for (const equipo of misGanadoresPorRonda[r]) {
            if (!reales.has(equipo)) continue; // ese equipo no llegó: no suma

            total += puntaje.avanzaPorRonda[r] ?? 0;
            aciertosPorRonda[r]++;

            if (esFinal) {
                total += puntaje.campeon; // mi campeón es el campeón real
            } else if (esSemis) {
                total += puntaje.finalista; // acerté a un finalista
            }
        }
    }

    // Bono de marcador: por llave donde el jugador lo llenó y acertó el global.
    if (marcadores) {
        for (const llave of llavesReales) {
            if (!llave.ganador) continue;
            const miMarcador = marcadores[llave.id];
            if (!miMarcador) continue;
            const real = globalDeLlave(llave);
            if (!real) continue;

            if (miMarcador.local === real.local && miMarcador.visitante === real.visitante) {
                total += puntaje.marcadorExacto;
                marcadoresAcertados++;
            } else {
                const miGana =
                    miMarcador.local > miMarcador.visitante
                        ? 'local'
                        : miMarcador.local < miMarcador.visitante
                            ? 'visitante'
                            : 'empate';
                const realGana =
                    real.local > real.visitante
                        ? 'local'
                        : real.local < real.visitante
                            ? 'visitante'
                            : 'empate';
                if (miGana === realGana) total += puntaje.marcadorResultado;
            }
        }
    }

    return { total, aciertosPorRonda, marcadoresAcertados };
}

/**
 * Ordena a los jugadores aplicando el desempate acordado:
 *  1) más puntos
 *  2) más marcadores globales acertados
 *  3) más aciertos en rondas avanzadas (la final pesa más)
 */
export function compararParaTabla(
    a: { puntos: number; desglose: DesglosePuntos },
    b: { puntos: number; desglose: DesglosePuntos },
): number {
    if (a.puntos !== b.puntos) return b.puntos - a.puntos;

    if (a.desglose.marcadoresAcertados !== b.desglose.marcadoresAcertados) {
        return b.desglose.marcadoresAcertados - a.desglose.marcadoresAcertados;
    }

    // De la ronda más avanzada hacia atrás: quien acertó más arriba, gana.
    const ra = a.desglose.aciertosPorRonda;
    const rb = b.desglose.aciertosPorRonda;
    for (let r = ra.length - 1; r >= 0; r--) {
        if ((ra[r] ?? 0) !== (rb[r] ?? 0)) return (rb[r] ?? 0) - (ra[r] ?? 0);
    }
    return 0;
}