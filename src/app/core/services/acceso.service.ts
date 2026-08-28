import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

/**
 * Gestiona el "portón" de acceso al sitio con Cloudflare Turnstile.
 * El usuario resuelve el widget una vez por dispositivo; validamos el token
 * en el servidor y, si es válido, recordamos el acceso en localStorage para
 * no volver a pedirlo en ese navegador.
 */
const CLAVE_ACCESO = 'quiniela.acceso';

@Injectable({ providedIn: 'root' })
export class AccesoService {
    private readonly fns = inject(Functions);

    /** ¿Este dispositivo ya pasó el portón antes? */
    yaValidado(): boolean {
        try {
            return localStorage.getItem(CLAVE_ACCESO) === 'ok';
        } catch {
            return false;
        }
    }

    /** Valida el token de Turnstile en el servidor. Si es válido, lo recuerda. */
    async validar(token: string): Promise<boolean> {
        const fn = httpsCallable<{ token: string }, { ok: boolean }>(this.fns, 'validarTurnstile');
        const r = await fn({ token });
        if (r.data.ok) {
            this.recordar();
            return true;
        }
        return false;
    }

    private recordar(): void {
        try {
            localStorage.setItem(CLAVE_ACCESO, 'ok');
        } catch {
            // Sin localStorage: el portón se pedirá cada vez, pero no rompe nada.
        }
    }
}