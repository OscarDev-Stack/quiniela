import { Injectable, inject } from '@angular/core';
import { Messaging, getToken } from '@angular/fire/messaging';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { environment } from '../../environments/environment';

/**
 * Maneja las notificaciones push del navegador (PWA). Pide permiso,
 * obtiene el token del dispositivo vía FCM y lo registra en el servidor
 * (campo pushTokens del usuario). El servidor usa ese token para enviar
 * las mismas notificaciones que hoy manda por Telegram.
 *
 * En iPhone solo funciona si la app está instalada en el inicio (PWA)
 * y con iOS 16.4 o más nuevo. En Android funciona sin instalar.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
    private readonly messaging = inject(Messaging);
    private readonly fns = inject(Functions);

    /** ¿El navegador soporta notificaciones push? */
    soportado(): boolean {
        return typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
    }

    /** Estado actual del permiso: 'granted' | 'denied' | 'default'. */
    permiso(): NotificationPermission {
        return this.soportado() ? Notification.permission : 'denied';
    }

    /**
     * ¿ESTE dispositivo está recibiendo push? Comprueba si el token de este
     * navegador está en la lista de tokens del usuario. Así el switch refleja
     * el estado real de ESTE dispositivo, no el global del usuario (que puede
     * estar activo por otro dispositivo).
     *
     * Solo consulta el token si ya hay permiso concedido, para no disparar el
     * prompt de permiso al abrir el perfil. Devuelve false ante cualquier
     * fallo o si no hay token registrado aún.
     */
    async estaActivoAqui(tokens: string[]): Promise<boolean> {
        if (!this.soportado() || this.permiso() !== 'granted') return false;
        if (!tokens || tokens.length === 0) return false;
        try {
            const token = await this.obtenerToken();
            return token !== '' && tokens.includes(token);
        } catch {
            return false;
        }
    }

    /**
     * Obtiene el token FCM de ESTE dispositivo. Registra el service worker de
     * messaging en su scope aislado (ver nota abajo) y pide el token. No pide
     * permiso: quien llame debe asegurarse de tenerlo. Devuelve '' si no se
     * puede obtener (permiso revocado, navegador sin soporte, etc.).
     */
    private async obtenerToken(): Promise<string> {
        if (!this.soportado()) return '';

        // El service worker de messaging tiene que estar registrado, pero en
        // su PROPIO scope. Si se registra en la raíz '/' compite con el
        // ngsw-worker.js de Angular por el control de la página: el último en
        // registrarse gana, desplaza al SW de Angular y entonces SwUpdate deja
        // de detectar versiones nuevas (el botón "Actualizar" nunca aparece).
        // Con un scope aislado ambos SW conviven sin pisarse.
        const SCOPE = '/firebase-cloud-messaging-push-scope';
        const registro =
            (await navigator.serviceWorker.getRegistration(SCOPE)) ??
            (await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: SCOPE }));

        return await getToken(this.messaging, {
            vapidKey: environment.vapidKey,
            serviceWorkerRegistration: registro,
        });
    }

    /**
     * Activa las push: pide permiso, obtiene el token y lo guarda en el
     * servidor. Devuelve true si quedó activado. Puede fallar si el usuario
     * niega el permiso.
     */
    async activar(): Promise<boolean> {
        if (!this.soportado()) {
            throw new Error('Tu navegador no soporta notificaciones.');
        }

        const permiso = await Notification.requestPermission();
        if (permiso !== 'granted') {
            throw new Error('No diste permiso para notificaciones.');
        }

        const token = await this.obtenerToken();
        if (!token) throw new Error('No se pudo obtener el token del dispositivo.');

        const fn = httpsCallable<{ activo: boolean; token: string }, { ok: boolean }>(
            this.fns,
            'guardarPush',
        );
        await fn({ activo: true, token });
        return true;
    }

    /**
     * Desactiva las push de ESTE dispositivo. Manda el token de este navegador
     * para que el servidor lo quite del array (arrayRemove) sin tocar los
     * demás dispositivos del usuario. El servidor deja pushActivo en true si
     * quedan otros tokens, o en false si este era el último.
     *
     * Si no se puede obtener el token (permiso revocado, etc.), cae al apagado
     * global (token vacío) para no dejar al usuario sin forma de desactivar.
     */
    async desactivar(): Promise<void> {
        let token = '';
        try {
            token = await this.obtenerToken();
        } catch {
            // Sin token: fallback al apagado global más abajo.
        }

        const fn = httpsCallable<{ activo: boolean; token: string }, { ok: boolean }>(
            this.fns,
            'guardarPush',
        );
        await fn({ activo: false, token });
    }
}