import { Injectable, computed, signal } from '@angular/core';

/**
 * Overlay bloqueante global para ACCIONES (no para carga inicial de datos).
 * A diferencia de <app-cargando>, que cada vista maneja por su cuenta para su
 * primera carga, este servicio es único y se dispara desde cualquier lado al
 * ejecutar una acción que espera al servidor (guardar quiniela, abrir jornada,
 * etc.). Muestra un overlay "Guardando…" que impide tocar la pantalla mientras
 * la acción está en curso, y así el usuario no siente que "no pasó nada" entre
 * el clic y el toast final.
 *
 * Uso típico:
 *   await this.ocupado.mientras('Guardando pronósticos', () =>
 *     this.service.guardarQuiniela(...),
 *   );
 *   this.toast.exito('Pronósticos guardados.');
 *
 * El overlay se garantiza visible al menos MIN_MS para que no titile en
 * acciones muy rápidas (misma sensación que el loading de arranque).
 */
@Injectable({ providedIn: 'root' })
export class OcupadoService {
    /** Duración mínima que el overlay permanece visible (evita parpadeos). */
    private static readonly MIN_MS = 800;

    private readonly _texto = signal<string | null>(null);

    /** Texto actual del overlay, o null si no hay acción en curso. */
    readonly texto = this._texto.asReadonly();

    /** ¿Hay una acción en curso? Lo lee el componente que dibuja el overlay. */
    readonly activo = computed(() => this._texto() !== null);

    /**
     * Ejecuta `accion` mostrando el overlay bloqueante mientras corre. El
     * overlay se ve al menos MIN_MS aunque la acción termine antes. Devuelve lo
     * que devuelva la acción y propaga cualquier error (para que el llamador
     * muestre su toast de error en el catch, como hoy).
     *
     * No anida: si ya hay una acción en curso, respeta el texto actual y no lo
     * pisa (el overlay ya está visible de todos modos).
     */
    async mientras<T>(texto: string, accion: () => Promise<T>): Promise<T> {
        const yaActivo = this.activo();
        if (!yaActivo) this._texto.set(texto);

        const inicio = Date.now();
        try {
            return await accion();
        } finally {
            // Solo el llamador que encendió el overlay lo apaga, y respetando
            // el mínimo visible para que no sea un parpadeo.
            if (!yaActivo) {
                const restante = OcupadoService.MIN_MS - (Date.now() - inicio);
                if (restante > 0) {
                    await new Promise((r) => setTimeout(r, restante));
                }
                this._texto.set(null);
            }
        }
    }
}
