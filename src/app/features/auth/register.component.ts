import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Firestore, doc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="brand">
          <span class="brand-mark">Q</span>
          <span class="brand-name">Quiniela</span>
        </div>
        <h1 class="auth-title">Crear cuenta</h1>
        <p class="auth-subtitle">Regístrate para empezar a competir.</p>

        @if (error()) {
          <div class="auth-error">{{ error() }}</div>
        }

        <form (ngSubmit)="onSubmit()">
          <label class="field">
            <span class="field-label">Alias</span>
            <input type="text" name="alias" [(ngModel)]="alias" required maxlength="20" placeholder="Cómo te verán en el ranking" />
          </label>

          <label class="field">
            <span class="field-label">Correo</span>
            <input type="email" name="email" [(ngModel)]="email" required autocomplete="email" placeholder="tu@correo.com" />
          </label>

          <label class="field">
            <span class="field-label">Contraseña</span>
            <input type="password" name="password" [(ngModel)]="password" required autocomplete="new-password" placeholder="Mínimo 6 caracteres" />
          </label>

          <label class="field">
            <span class="field-label">Confirmar contraseña</span>
            <input type="password" name="confirm" [(ngModel)]="confirm" required autocomplete="new-password" placeholder="Repite tu contraseña" />
          </label>

          <button type="submit" class="btn-primary" [disabled]="loading()">
            {{ loading() ? 'Creando…' : 'Crear cuenta' }}
          </button>
        </form>

        <p class="auth-alt">¿Ya tienes cuenta? <a routerLink="/login">Iniciar sesión</a></p>
      </div>
    </div>
  `,
  styles: [
    `
      .auth-wrap {
        min-height: 100vh; display: flex; align-items: center; justify-content: center;
        padding: calc(24px + env(safe-area-inset-top)) 24px calc(24px + env(safe-area-inset-bottom));
      }
      .auth-card { width: 100%; max-width: 380px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 16px; padding: 28px 24px; }
      .brand { display: flex; align-items: center; gap: 10px; justify-content: center; margin-bottom: 18px; }
      .brand-mark { width: 34px; height: 34px; border-radius: 50%; background: var(--accent-bg); color: var(--accent-text); display: flex; align-items: center; justify-content: center; font-weight: 600; }
      .brand-name { font-size: 18px; font-weight: 600; }
      .auth-title { font-size: 20px; font-weight: 600; text-align: center; margin: 0 0 4px; }
      .auth-subtitle { font-size: 14px; color: var(--text-secondary); text-align: center; margin: 0 0 22px; }
      .auth-error { background: var(--danger-bg); color: var(--danger-text); font-size: 13px; padding: 10px 12px; border-radius: var(--radius); margin-bottom: 16px; }
      .field { display: block; margin-bottom: 14px; }
      .field-label { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; }
      .btn-primary { width: 100%; padding: 12px; border: none; border-radius: var(--radius); background: var(--accent-fill); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 6px; }
      .btn-primary:disabled { opacity: 0.6; cursor: default; }
      .auth-alt { text-align: center; font-size: 14px; color: var(--text-secondary); margin: 18px 0 0; }
      .auth-alt a { color: var(--accent-text); text-decoration: none; font-weight: 500; }
      .auth-alt a:hover { text-decoration: underline; }
    `,
  ],
})
export class RegisterComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly db = inject(Firestore);

  alias = '';
  email = '';
  password = '';
  confirm = '';
  readonly loading = signal(false);
  readonly error = signal('');

  async onSubmit(): Promise<void> {
    this.error.set('');

    const alias = this.alias.trim();
    if (alias.length < 3) {
      this.error.set('El alias debe tener al menos 3 caracteres.');
      return;
    }
    if (this.password !== this.confirm) {
      this.error.set('Las contraseñas no coinciden.');
      return;
    }
    if (this.password.length < 6) {
      this.error.set('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    this.loading.set(true);
    try {
      const cred = await this.auth.register(this.email, this.password);

      // Crea el documento del usuario en estado pendiente de validación.
      await setDoc(doc(this.db, 'users', cred.user.uid), {
        email: this.email,
        alias,
        rol: 'user',
        validada: false,
        bloqueado: false,
        puntos: 0,
        createdAt: serverTimestamp(),
      });

      // Avisa a los administradores que hay una cuenta por validar.
      await this.auth.avisarRegistro();

      const invitacion = localStorage.getItem('invitacion');
      // Se consume una sola vez: si no, cada login reenvía a unirse.
      localStorage.removeItem('invitacion');
      this.router.navigate(invitacion ? ['/unirse', invitacion] : ['/partidos']);
    } catch (e: unknown) {
      this.error.set(this.mapError((e as { code?: string })?.code));
    } finally {
      this.loading.set(false);
    }
  }

  private mapError(code?: string): string {
    switch (code) {
      case 'auth/email-already-in-use':
        return 'Ya existe una cuenta con ese correo.';
      case 'auth/invalid-email':
        return 'El correo no es válido.';
      case 'auth/weak-password':
        return 'La contraseña es demasiado débil.';
      default:
        return 'No se pudo crear la cuenta. Intenta de nuevo.';
    }
  }
}