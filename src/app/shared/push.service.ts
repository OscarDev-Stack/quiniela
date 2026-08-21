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

        // El service worker de messaging tiene que estar registrado.
        const registro = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js')
            ?? await navigator.serviceWorker.register('/firebase-messaging-sw.js');

        const token = await getToken(this.messaging, {
            vapidKey: environment.vapidKey,
            serviceWorkerRegistration: registro,
        });
        if (!token) throw new Error('No se pudo obtener el token del dispositivo.');

        const fn = httpsCallable<{ activo: boolean; token: string }, { ok: boolean }>(
            this.fns,
            'guardarPush',
        );
        await fn({ activo: true, token });
        return true;
    }

    /**
     * Desactiva las push apagando el switch en el servidor (pushActivo:
     * false). NO borra el token: como un interruptor de luz, el foco (token)
     * se queda listo y reactivar es instantáneo. El servidor respeta
     * pushActivo, así que con el switch apagado no envía nada aunque el
     * token exista.
     */
    async desactivar(): Promise<void> {
        const fn = httpsCallable<{ activo: boolean; token: string }, { ok: boolean }>(
            this.fns,
            'guardarPush',
        );
        await fn({ activo: false, token: '' });
    }
}