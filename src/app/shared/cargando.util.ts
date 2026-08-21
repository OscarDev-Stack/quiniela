import { WritableSignal } from '@angular/core';

/**
 * Apaga un signal de "cargando" respetando un tiempo mínimo visible, para
 * que el indicador no parpadee cuando los datos llegan muy rápido.
 *
 * Uso con un observable:
 *   readonly cargando = signal(true);
 *   private readonly datos = toSignal(
 *     this.servicio.algo().pipe(tap(() => apagarCargando(this.cargando, this.inicio))),
 *     { initialValue: [] },
 *   );
 *
 * O más simple, con la fábrica de abajo que ya lleva el control del tiempo.
 */
export function apagarCargando(
    cargando: WritableSignal<boolean>,
    inicioMs: number,
    minimoMs = 800,
): void {
    const transcurrido = Date.now() - inicioMs;
    const falta = Math.max(0, minimoMs - transcurrido);
    if (falta === 0) {
        cargando.set(false);
    } else {
        setTimeout(() => cargando.set(false), falta);
    }
}