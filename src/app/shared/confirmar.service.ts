import { Injectable, signal } from '@angular/core';

export interface PeticionConfirmacion {
    titulo: string;
    mensaje: string;
    /** Texto del botón que confirma. */
    aceptar: string;
    /** Texto del botón que cancela. */
    cancelar: string;
    /** Pinta el botón en rojo: acciones irreversibles. */
    peligro: boolean;
}

interface Pendiente extends PeticionConfirmacion {
    resolver: (respuesta: boolean) => void;
}

/**
 * Reemplaza al confirm() del navegador por un diálogo propio.
 * Se usa igual de simple:  if (!(await this.confirmar.pedir({...}))) return;
 */
@Injectable({ providedIn: 'root' })
export class ConfirmarService {
    private readonly _pendiente = signal<Pendiente | null>(null);

    /** Lo lee el componente del diálogo para saber qué mostrar. */
    readonly pendiente = this._pendiente.asReadonly();

    pedir(opciones: {
        titulo: string;
        mensaje: string;
        aceptar?: string;
        cancelar?: string;
        peligro?: boolean;
    }): Promise<boolean> {
        return new Promise<boolean>((resolver) => {
            this._pendiente.set({
                titulo: opciones.titulo,
                mensaje: opciones.mensaje,
                aceptar: opciones.aceptar ?? 'Continuar',
                cancelar: opciones.cancelar ?? 'Cancelar',
                peligro: opciones.peligro ?? false,
                resolver,
            });
        });
    }

    /** Responde y cierra. Lo llama el diálogo. */
    responder(respuesta: boolean): void {
        const actual = this._pendiente();
        if (!actual) return;
        this._pendiente.set(null);
        actual.resolver(respuesta);
    }
}