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
      <div class="fondo-glow"></div>

      <div class="auth-content">
        <div class="hero">
          <div class="hero-ico-wrap">
            <div class="hero-ico-glow"></div>
            <div class="hero-ico">⚽</div>
          </div>
          <div class="marca">
            <span class="marca-nombre">Fut</span>
            <span class="marca-by">by AutomatePower</span>
          </div>
          <p class="hero-sub">Entra para hacer tus pronósticos</p>
        </div>

        <div class="auth-card">
          @if (error()) {
            <div class="auth-error"><i class="ti ti-alert-circle"></i> {{ error() }}</div>
          }

          <form (ngSubmit)="onSubmit()">
            <label class="field">
              <span class="field-label">Correo electrónico</span>
              <span class="input-wrap">
                <i class="ti ti-mail input-ico"></i>
                <input
                  type="email"
                  name="email"
                  [(ngModel)]="email"
                  required
                  autocomplete="email"
                  placeholder="tu@correo.com"
                />
              </span>
            </label>

            <label class="field">
              <span class="field-label">Contraseña</span>
              <span class="input-wrap">
                <i class="ti ti-lock input-ico"></i>
                <input
                  type="password"
                  name="password"
                  [(ngModel)]="password"
                  required
                  autocomplete="current-password"
                  placeholder="••••••••"
                />
              </span>
            </label>

            <button type="submit" class="btn-primary" [disabled]="loading()">
              {{ loading() ? 'Entrando…' : 'Iniciar sesión' }}
            </button>
          </form>

          <p class="auth-alt">
            <a routerLink="/recuperar">¿Olvidaste tu contraseña?</a>
          </p>
        </div>

        <p class="auth-alt auth-alt--fuera">
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
        position: relative; min-height: 100vh; overflow: hidden;
        display: flex; align-items: center; justify-content: center;
        padding: calc(24px + env(safe-area-inset-top)) 22px
          calc(40px + env(safe-area-inset-bottom));
      }
      .fondo-glow {
        position: absolute; top: -120px; left: 50%; transform: translateX(-50%);
        width: 360px; height: 360px; border-radius: 50%;
        background: radial-gradient(circle, rgba(55, 138, 221, 0.26), transparent 70%);
        pointer-events: none;
      }
      .auth-content { position: relative; z-index: 1; width: 100%; max-width: 380px; }

      /* Hero: ícono con halo + marca */
      .hero { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 24px; }
      .hero-ico-wrap { position: relative; margin-bottom: 16px; }
      .hero-ico-glow {
        position: absolute; inset: -16px; border-radius: 50%;
        background: radial-gradient(circle, rgba(55, 138, 221, 0.45), transparent 70%);
      }
      .hero-ico {
        position: relative; width: 76px; height: 76px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center; font-size: 38px;
        background: var(--surface-2); border: 1px solid rgba(55, 138, 221, 0.4);
      }
      .marca { display: flex; flex-direction: column; align-items: center; }
      .marca-nombre { font-size: 34px; font-weight: 800; letter-spacing: -0.5px; line-height: 1; }
      .marca-by { font-size: 12px; font-weight: 500; color: var(--accent-text); margin-top: 3px; }
      .hero-sub { font-size: 14px; color: var(--text-secondary); margin: 12px 0 0; }

      .auth-card {
        width: 100%; background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 18px; padding: 22px 20px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.22);
      }

      .auth-error {
        display: flex; align-items: center; gap: 7px;
        background: var(--danger-bg); color: var(--danger-text);
        font-size: 13px; padding: 10px 12px; border-radius: var(--radius); margin-bottom: 16px;
      }

      .field { display: block; margin-bottom: 16px; }
      .field-label { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 7px; }

      /* Input con ícono a la izquierda */
      .input-wrap { position: relative; display: block; }
      .input-ico {
        position: absolute; left: 13px; top: 50%; transform: translateY(-50%);
        font-size: 18px; color: var(--text-muted); pointer-events: none;
      }
      .input-wrap input {
        width: 100%; padding: 12px 14px 12px 42px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-1); color: var(--text-primary); font-size: 15px;
      }
      .input-wrap input:focus { outline: none; border-color: var(--accent-fill); }

      .btn-primary {
        width: 100%; padding: 13px; border: none; border-radius: var(--radius);
        background: var(--accent-fill); color: #fff; font-size: 15px; font-weight: 600;
        cursor: pointer; margin-top: 4px;
      }
      .btn-primary:disabled { opacity: 0.6; cursor: default; }

      .auth-alt { text-align: center; font-size: 14px; color: var(--text-secondary); margin: 16px 0 0; }
      .auth-alt--fuera { margin-top: 20px; }
      .auth-alt a { color: var(--accent-text); text-decoration: none; font-weight: 600; }
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