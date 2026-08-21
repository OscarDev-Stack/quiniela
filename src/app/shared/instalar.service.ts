import { Injectable, signal } from '@angular/core';

/** El evento beforeinstallprompt (solo Android/Chrome lo dispara). */
interface PromptInstalacion extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Maneja la instalación de la PWA ("Agregar a inicio"). El comportamiento
 * difiere por plataforma:
 *  - Android/Chrome: dispara beforeinstallprompt; guardamos el evento y
 *    lo lanzamos cuando el usuario toca el botón (instalación de un toque).
 *  - iPhone/Safari: NO existe ese evento; hay que mostrar instrucciones
 *    manuales (Compartir → Agregar a inicio).
 *  - Ya instalada: no se ofrece nada.
 */
@Injectable({ providedIn: 'root' })
export class InstalarService {
    /** Evento guardado de Android, listo para lanzarse. */
    private promptAndroid: PromptInstalacion | null = null;

    /** True si Android nos dio el evento (se puede instalar de un toque). */
    readonly puedeInstalarAndroid = signal(false);

    constructor() {
        // Android/Chrome nos avisa que la app es instalable.
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.promptAndroid = e as PromptInstalacion;
            this.puedeInstalarAndroid.set(true);
        });

        // Cuando se instala, ocultamos la oferta.
        window.addEventListener('appinstalled', () => {
            this.promptAndroid = null;
            this.puedeInstalarAndroid.set(false);
        });
    }

    /** ¿Ya está corriendo instalada (abierta desde el ícono)? */
    yaInstalada(): boolean {
        const standalone = window.matchMedia('(display-mode: standalone)').matches;
        // iOS marca esto aparte con navigator.standalone.
        const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
        return standalone || iosStandalone;
    }

    /** ¿Es un iPhone/iPad? (definen la instalación manual por Safari). */
    esIOS(): boolean {
        const ua = window.navigator.userAgent;
        const esApple = /iPad|iPhone|iPod/.test(ua);
        // iPad moderno se hace pasar por Mac; lo detectamos por el touch.
        const ipadMod = navigator.maxTouchPoints > 1 && /Macintosh/.test(ua);
        return esApple || ipadMod;
    }

    /** ¿El navegador actual es Safari? (en iPhone, solo ahí se puede instalar). */
    esSafari(): boolean {
        const ua = window.navigator.userAgent;
        // Chrome/Firefox en iOS traen CriOS/FxiOS en el userAgent.
        return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    }

    /** ¿Es un teléfono o tablet? (la app está pensada para usarse en móvil). */
    esMovil(): boolean {
        const ua = window.navigator.userAgent;
        const esApple = /iPad|iPhone|iPod/.test(ua);
        const ipadMod = navigator.maxTouchPoints > 1 && /Macintosh/.test(ua);
        return /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua) || esApple || ipadMod;
    }

    /**
     * ¿Se puede ofrecer la instalación aquí? Solo tiene sentido en móvil,
     * o en escritorio si el navegador realmente lo permite (evento capturado).
     * En una PC sin ese evento, no mostramos nada.
     */
    sePuedeOfrecer(): boolean {
        if (this.yaInstalada()) return false;
        if (this.esMovil()) return true;
        // Escritorio: solo si el navegador dio el evento de instalación.
        return this.puedeInstalarAndroid();
    }

    /**
     * Lanza el diálogo nativo de Android. Devuelve true si el usuario
     * aceptó instalar. En iOS no aplica (se usan instrucciones).
     */
    async instalarAndroid(): Promise<boolean> {
        if (!this.promptAndroid) return false;
        await this.promptAndroid.prompt();
        const { outcome } = await this.promptAndroid.userChoice;
        this.promptAndroid = null;
        this.puedeInstalarAndroid.set(false);
        return outcome === 'accepted';
    }
}