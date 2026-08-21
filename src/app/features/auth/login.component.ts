import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { APP_VERSION } from '../../core/version';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="brand">
          <span class="brand-mark">Q</span>
          <span class="brand-name">Quiniela</span>
        </div>
        <h1 class="auth-title">Iniciar sesión</h1>
        <p class="auth-subtitle">Entra para hacer tus pronósticos.</p>

        @if (error()) {
          <div class="auth-error">{{ error() }}</div>
        }

        <form (ngSubmit)="onSubmit()">
          <label class="field">
            <span class="field-label">Correo</span>
            <input
              type="email"
              name="email"
              [(ngModel)]="email"
              required
              autocomplete="email"
              placeholder="tu@correo.com"
            />
          </label>

          <label class="field">
            <span class="field-label">Contraseña</span>
            <input
              type="password"
              name="password"
              [(ngModel)]="password"
              required
              autocomplete="current-password"
              placeholder="••••••••"
            />
          </label>

          <button type="submit" class="btn-primary" [disabled]="loading()">
            {{ loading() ? 'Entrando…' : 'Entrar' }}
          </button>
        </form>

        <p class="auth-alt">
          ¿No tienes cuenta? <a routerLink="/registro">Crear cuenta</a>
        </p>
      </div>
      <p class="version">v{{ version }}</p>
    </div>
  `,
  styles: [
    `
      .version {
        position: absolute; bottom: calc(14px + env(safe-area-inset-bottom));
        left: 0; right: 0; text-align: center;
        font-size: 10px; color: var(--text-muted); opacity: 0.5; letter-spacing: 0.5px;
      }
      .auth-wrap {
        position: relative;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: calc(24px + env(safe-area-inset-top)) 24px
          calc(24px + env(safe-area-inset-bottom));
      }
      .auth-card {
        width: 100%;
        max-width: 380px;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 28px 24px;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 10px;
        justify-content: center;
        margin-bottom: 18px;
      }
      .brand-mark {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: var(--accent-bg);
        color: var(--accent-text);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
      }
      .brand-name { font-size: 18px; font-weight: 600; }
      .auth-title { font-size: 20px; font-weight: 600; text-align: center; margin: 0 0 4px; }
      .auth-subtitle { font-size: 14px; color: var(--text-secondary); text-align: center; margin: 0 0 22px; }

      .auth-error {
        background: var(--danger-bg);
        color: var(--danger-text);
        font-size: 13px;
        padding: 10px 12px;
        border-radius: var(--radius);
        margin-bottom: 16px;
      }

      .field { display: block; margin-bottom: 14px; }
      .field-label { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; }

      .btn-primary {
        width: 100%;
        padding: 12px;
        border: none;
        border-radius: var(--radius);
        background: var(--accent-fill);
        color: #fff;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        margin-top: 6px;
      }
      .btn-primary:disabled { opacity: 0.6; cursor: default; }

      .auth-alt { text-align: center; font-size: 14px; color: var(--text-secondary); margin: 18px 0 0; }
      .auth-alt a { color: var(--accent-text); text-decoration: none; font-weight: 500; }
      .auth-alt a:hover { text-decoration: underline; }
    `,
  ],
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly version = APP_VERSION;

  email = '';
  password = '';
  readonly loading = signal(false);
  readonly error = signal('');

  async onSubmit(): Promise<void> {
    this.error.set('');
    this.loading.set(true);
    try {
      const cred = await this.auth.login(this.email, this.password);
      if (cred?.user) {
        const invitacion = localStorage.getItem('invitacion');
        // Se consume una sola vez: si no, cada login reenvía a unirse.
        localStorage.removeItem('invitacion');
        await this.router.navigate(invitacion ? ['/unirse', invitacion] : ['/inicio']);
      } else {
        this.error.set('No se pudo iniciar la sesión. Intenta de nuevo.');
      }
    } catch (e: unknown) {
      this.error.set(this.mapError((e as { code?: string })?.code));
    } finally {
      this.loading.set(false);
    }
  }

  private mapError(code?: string): string {
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Correo o contraseña incorrectos.';
      case 'auth/invalid-email':
        return 'El correo no es válido.';
      case 'auth/too-many-requests':
        return 'Demasiados intentos. Intenta más tarde.';
      default:
        return 'No se pudo iniciar sesión. Intenta de nuevo.';
    }
  }
}