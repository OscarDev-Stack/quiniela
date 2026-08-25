import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
    Auth,
    user,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    sendPasswordResetEmail,
} from '@angular/fire/auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
    private readonly auth = inject(Auth);
    private readonly fns = inject(Functions);

    /** Observable del usuario autenticado (emite null si no hay sesión). */
    readonly user$ = user(this.auth);

    login(email: string, password: string) {
        return signInWithEmailAndPassword(this.auth, email, password);
    }

    register(email: string, password: string) {
        return createUserWithEmailAndPassword(this.auth, email, password);
    }

    logout() {
        return signOut(this.auth);
    }

    /**
     * Manda el correo de recuperación. El enlace lleva a la página de cambio
     * de contraseña de Firebase (genérica). La pantalla propia /recuperar es
     * donde el usuario pide el correo con nuestro diseño.
     */
    recuperarContrasena(email: string) {
        return sendPasswordResetEmail(this.auth, email.trim());
    }

    /** Avisa a los administradores que hay una cuenta nueva. */
    async avisarRegistro(): Promise<void> {
        try {
            const fn = httpsCallable<Record<string, never>, { ok: boolean }>(
                this.fns,
                'avisarRegistro',
            );
            await fn({} as Record<string, never>);
        } catch {
            // Si falla el aviso no pasa nada: la cuenta ya quedó creada.
        }
    }
}