import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
    Auth,
    user,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    sendPasswordResetEmail,
    verifyPasswordResetCode,
    confirmPasswordReset,
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
     * Manda el correo de recuperación. El enlace del correo llevará a
     * nuestra propia pantalla (/recuperar) gracias a la URL de continuación,
     * que hay que configurar en la consola de Firebase → Authentication →
     * Templates → Password reset → personalizar el dominio de acción.
     */
    recuperarContrasena(email: string) {
        return sendPasswordResetEmail(this.auth, email.trim());
    }

    /**
     * Verifica que el código del enlace (oobCode) sea válido y no haya
     * expirado. Devuelve el correo asociado, para mostrarlo en la pantalla.
     */
    verificarCodigoReset(oobCode: string) {
        return verifyPasswordResetCode(this.auth, oobCode);
    }

    /** Aplica la nueva contraseña usando el código del enlace. */
    confirmarNuevaContrasena(oobCode: string, nueva: string) {
        return confirmPasswordReset(this.auth, oobCode, nueva);
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