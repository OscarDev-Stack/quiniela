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
     * ¿Es la primera vez que este dispositivo abre la app? Sirve para que el
     * botón del login se muestre como "descubre qué puedes hacer" en lugar de
     * "novedades". No escribe nada: solo consulta.
     */
    esPrimeraVez(): boolean {
        return this.leer() === null;
    }

    /**
     * ¿Hay algo que valga la pena destacar con el badge "Nuevo" del botón?
     * Es true en la primera visita (presentación) o cuando llegó una versión
     * mayor/menor desde la última vista. No escribe nada: solo consulta, para
     * que el badge desaparezca en cuanto se marque la versión como vista.
     */
    hayNuevo(): boolean {
        const vista = this.leer();
        if (!vista) return true;
        return NOVEDADES.some((n) => this.mereceAviso(n.version, vista));
    }

    /**
     * Se abre a petición del usuario, desde el botón del login o del inicio
     * (ya no salta solo, era invasivo).
     *
     *  - Primera vez en el dispositivo → presentación completa ("qué puedes
     *    hacer") en modo bienvenida.
     *  - Ya lo usaba → carrusel con lo nuevo desde la última versión vista;
     *    si no hay cambios que anunciar, muestra el historial de esta versión
     *    (solo entradas MAYOR.MENOR de APP_VERSION) para que el botón nunca
     *    quede "muerto".
     *
     * Al abrirlo se marca la versión actual como vista, así el badge/etiqueta
     * de "nuevo" del botón desaparece en las siguientes visitas.
     */
    abrir(): void {
        const vista = this.leer();
        this.guardar(APP_VERSION);

        // Primera vez en este dispositivo: presentación completa.
        if (!vista) {
            this._modo.set('bienvenida');
            this._mostrando.set(NOVEDADES);
            return;
        }

        // Solo se destacan cambios mayores o menores. Los parches (el tercer
        // número) son ajustes visuales y correcciones sin impacto.
        const nuevas = NOVEDADES.filter((n) => this.mereceAviso(n.version, vista));
        if (nuevas.length > 0) {
            this._modo.set('novedades');
            this._mostrando.set(nuevas);
            return;
        }

        // Nada nuevo que anunciar: enseñamos el historial de esta versión para
        // que el botón siempre muestre algo útil.
        this._modo.set('historial');
        this._mostrando.set(this.deEstaVersion());
    }

    /**
     * Novedades de la versión actual: solo las que comparten los dos primeros
     * números (MAYOR.MENOR) con APP_VERSION. Ej. con 2.3.10 se muestran las
     * entradas 2.3.x; las de 2.2.x y anteriores quedan fuera. Así el historial
     * refleja "lo de esta versión" y no toda la trayectoria de la app.
     */
    private deEstaVersion(): Novedad[] {
        return NOVEDADES.filter((n) => this.mismaMinor(n.version, APP_VERSION));
    }

    /**
     * Abre el historial COMPLETO de versiones, desde el perfil: toda la
     * trayectoria de la app, de la más reciente a la más antigua. A diferencia
     * de los botones de login/inicio (que muestran solo lo de esta versión),
     * aquí el usuario quiere repasarlo todo.
     */
    abrirHistorial(): void {
        this._modo.set('historial');
        this._mostrando.set(NOVEDADES);
    }

    cerrar(): void {
        this._mostrando.set(null);
    }

    /**
     * ¿Dos versiones comparten MAYOR.MENOR (los dos primeros números)?
     * Ej. 2.3.1 y 2.3.10 → true; 2.2.0 y 2.3.10 → false. Ignora el parche.
     */
    private mismaMinor(a: string, b: string): boolean {
        const [mayorA = 0, menorA = 0] = a.split('.').map(Number);
        const [mayorB = 0, menorB = 0] = b.split('.').map(Number);
        return mayorA === mayorB && menorA === menorB;
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