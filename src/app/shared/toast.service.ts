import { Injectable, signal } from '@angular/core';

export type TipoToast = 'exito' | 'error';

export interface Toast {
    id: number;
    tipo: TipoToast;
    texto: string;
}

/**
 * Notificaciones emergentes (toasts) centralizadas. Cualquier pantalla
 * las dispara con toast.exito(...) o toast.error(...), y aparecen todas
 * en el mismo lugar (abajo, sobre la barra) con el mismo estilo. Se
 * cierran solas tras unos segundos.
 *
 * Reemplaza los mensajes sueltos tipo `this.mensaje.set('...')` que
 * aparecían en posiciones distintas según la pantalla.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
    private readonly _toasts = signal<Toast[]>([]);
    /** Lo lee el componente que dibuja los toasts. */
    readonly toasts = this._toasts.asReadonly();

    private siguienteId = 0;

    /** Mensaje de éxito (verde, con palomita). */
    exito(texto: string, duracionMs = 3200): void {
        this.mostrar('exito', texto, duracionMs);
    }

    /** Mensaje de error (rojo, con alerta). */
    error(texto: string, duracionMs = 4200): void {
        this.mostrar('error', texto, duracionMs);
    }

    private mostrar(tipo: TipoToast, texto: string, duracionMs: number): void {
        const id = this.siguienteId++;
        this._toasts.update((lista) => [...lista, { id, tipo, texto }]);
        setTimeout(() => this.cerrar(id), duracionMs);
    }

    /** Cierra un toast por id (al agotarse el tiempo o al tocarlo). */
    cerrar(id: number): void {
        this._toasts.update((lista) => lista.filter((t) => t.id !== id));
    }
}