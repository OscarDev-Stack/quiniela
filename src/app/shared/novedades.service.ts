import { Injectable, signal } from '@angular/core';
import { APP_VERSION } from '../core/version';
import { NOVEDADES, Novedad } from './novedades';

const CLAVE = 'versionVista';

/**
 * Decide cuándo enseñar las novedades: la primera vez que alguien
 * abre una versión nueva, y después solo si la pide desde su perfil.
 */
@Injectable({ providedIn: 'root' })
export class NovedadesService {
    /** null = cerrado. Si hay lista, es lo que se está mostrando. */
    private readonly _mostrando = signal<Novedad[] | null>(null);
    readonly mostrando = this._mostrando.asReadonly();

    /**
     * Por qué se está mostrando:
     *  bienvenida → primera vez que alguien abre la app
     *  novedades  → ya la usaba y hay una versión nueva
     *  historial  → lo pidió desde su perfil
     */
    private readonly _modo = signal<'bienvenida' | 'novedades' | 'historial'>('historial');
    readonly modo = this._modo.asReadonly();

    /**
     * Se llama al arrancar la app. Muestra las novedades de esta versión
     * solo si el dispositivo todavía no la había visto.
     */
    revisarAlEntrar(): void {
        const vista = this.leer();
        this.guardar(APP_VERSION);

        // Primera vez en este dispositivo: se muestra todo, como presentación.
        if (!vista) {
            this._modo.set('bienvenida');
            this._mostrando.set(NOVEDADES);
            return;
        }
        if (vista === APP_VERSION) return;

        // Solo se anuncian cambios mayores o menores. Los parches
        // (el tercer número) son ajustes visuales y correcciones: se
        // despliegan en silencio para que el aviso no pierda su valor.
        const nuevas = NOVEDADES.filter((n) => this.mereceAviso(n.version, vista));
        if (nuevas.length === 0) return;

        this._modo.set('novedades');
        this._mostrando.set(nuevas);
    }

    /** Abre el historial completo, desde el perfil. */
    abrirHistorial(): void {
        this._modo.set('historial');
        this._mostrando.set(NOVEDADES);
    }

    cerrar(): void {
        this._mostrando.set(null);
    }

    /**
     * ¿Esta versión merece anunciarse frente a la que ya se vio?
     * Compara solo MAYOR y MENOR: un cambio de parche no interrumpe a nadie.
     */
    private mereceAviso(version: string, vista: string): boolean {
        const [mayorA = 0, menorA = 0] = version.split('.').map(Number);
        const [mayorB = 0, menorB = 0] = vista.split('.').map(Number);

        if (mayorA !== mayorB) return mayorA > mayorB;
        return menorA > menorB;
    }

    private leer(): string | null {
        try {
            return localStorage.getItem(CLAVE);
        } catch {
            return null;
        }
    }

    private guardar(version: string): void {
        try {
            localStorage.setItem(CLAVE, version);
        } catch {
            // Modo privado o almacenamiento bloqueado: no pasa nada.
        }
    }
}