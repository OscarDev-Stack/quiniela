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
 *
 * SEGURIDAD ANTI-BLOQUEO: como este overlay cubre toda la pantalla y captura
 * los toques, JAMÁS debe quedarse encendido para siempre. En iOS PWA una
 * llamada de red puede colgarse sin resolver ni rechazar (bfcache, pérdida de
 * conexión al restaurar la app). Por eso hay un tope duro (TIMEOUT_MS): pase lo
 * que pase, el overlay se apaga solo y la app vuelve a responder. El overlay
 * también se puede cerrar manualmente (ver ocultar()) como última red.
 */
@Injectable({ providedIn: 'root' })
export class OcupadoService {
    /** Duración mínima que el overlay permanece visible (evita parpadeos). */
    private static readonly MIN_MS = 800;

    /**
     * Tope duro: si una acción no termina en este tiempo, apagamos el overlay
     * igual para no dejar la app secuestrada. La acción sigue corriendo en
     * segundo plano; solo dejamos de bloquear la pantalla.
     */
    private static readonly TIMEOUT_MS = 20000;

    private readonly _texto = signal<string | null>(null);

    /** Identifica la "sesión" de overlay activa; invalida timers viejos. */
    private turno = 0;

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
        let miTimeout: ReturnType<typeof setTimeout> | null = null;
        let turnoActual = this.turno;

        if (!yaActivo) {
            turnoActual = ++this.turno;
            this._texto.set(texto);
            // Tope duro: apaga el overlay pase lo que pase con la acción.
            miTimeout = setTimeout(() => {
                if (this.turno === turnoActual) this._texto.set(null);
            }, OcupadoService.TIMEOUT_MS);
        }

        const inicio = Date.now();
        try {
            return await accion();
        } finally {
            // Solo el llamador que encendió el overlay lo apaga, y respetando
            // el mínimo visible para que no sea un parpadeo. Si mientras tanto
            // alguien llamó ocultar() o arrancó otra acción (turno cambió), no
            // tocamos el estado: ya no somos los dueños del overlay.
            if (!yaActivo) {
                if (miTimeout) clearTimeout(miTimeout);
                const restante = OcupadoService.MIN_MS - (Date.now() - inicio);
                if (restante > 0) {
                    await new Promise((r) => setTimeout(r, restante));
                }
                if (this.turno === turnoActual) this._texto.set(null);
            }
        }
    }

    /**
     * Apaga el overlay de inmediato. Red de seguridad: la usa el componente
     * cuando el usuario toca el fondo, y se puede llamar al cambiar de ruta.
     * Invalida cualquier acción/timeout en curso para que su `finally` tardío
     * no vuelva a tocar el estado.
     */
    ocultar(): void {
        this.turno++;
        this._texto.set(null);
    }
}
