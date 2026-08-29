import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import {
    Auth,
    user,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    AuthCredential,
    linkWithCredential,
    signOut,
    sendPasswordResetEmail,
    UserCredential,
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

    /**
     * Inicia sesión (o registra) con la cuenta de Google mediante un popup.
     * Devuelve la credencial completa: el llamador decide si es la primera
     * vez del usuario para crear su documento en Firestore.
     */
    loginConGoogle(): Promise<UserCredential> {
        const provider = new GoogleAuthProvider();
        // Fuerza a elegir cuenta cada vez, en lugar de reusar la sesión activa
        // del navegador sin preguntar.
        provider.setCustomParameters({ prompt: 'select_account' });
        return signInWithPopup(this.auth, provider);
    }

    /**
     * Extrae la credencial de Google de un error de popup. Se usa cuando el
     * correo ya existe con contraseña (auth/account-exists-with-different-
     * credential): guardamos esta credencial para vincularla después de que el
     * usuario confirme su contraseña.
     */
    credencialGoogleDeError(error: unknown): AuthCredential | null {
        return GoogleAuthProvider.credentialFromError(error as never);
    }

    /**
     * Vincula una credencial (p. ej. Google) a la cuenta que resulta de iniciar
     * sesión con correo y contraseña. Deja al usuario con ambos métodos activos
     * sobre la MISMA cuenta, evitando duplicados.
     */
    async vincularConContrasena(
        email: string,
        password: string,
        credencial: AuthCredential,
    ): Promise<UserCredential> {
        const cred = await signInWithEmailAndPassword(this.auth, email, password);
        return linkWithCredential(cred.user, credencial);
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