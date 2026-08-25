import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { APP_VERSION } from '../../core/version';

/**
 * Pantalla para PEDIR la recuperación de contraseña. El usuario escribe
 * su correo y recibe el enlace. Por seguridad, el mensaje de éxito es el
 * mismo exista o no la cuenta (no revelamos qué correos están registrados).
 */
@Component({
    selector: 'app-recuperar',
    standalone: true,
    imports: [FormsModule, RouterLink],
    template: `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="brand">
          <span class="brand-mark">Q</span>
          <span class="brand-name">Quiniela</span>
        </div>
        <h1 class="auth-title">Recuperar contraseña</h1>
        <p class="auth-subtitle">Te enviaremos un enlace para crear una nueva.</p>

        @if (error()) {
          <div class="auth-error">{{ error() }}</div>
        }

        @if (enviado()) {
          <div class="auth-ok">
            Si ese correo tiene una cuenta, te llegará un enlace en unos minutos.
            Revisa también la carpeta de spam.
          </div>
          <a routerLink="/login" class="btn-primary btn-link">Volver a iniciar sesión</a>
        } @else {
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

            <button type="submit" class="btn-primary" [disabled]="loading() || !email">
              {{ loading() ? 'Enviando…' : 'Enviar enlace' }}
            </button>
          </form>

          <p class="auth-alt">
            <a routerLink="/login">Volver a iniciar sesión</a>
          </p>
        }
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
        position: relative; min-height: 100vh;
        display: flex; align-items: center; justify-content: center;
        padding: calc(24px + env(safe-area-inset-top)) 24px
          calc(24px + env(safe-area-inset-bottom));
      }
      .auth-card {
        width: 100%; max-width: 380px;
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 16px; padding: 28px 24px;
      }
      .brand {
        display: flex; align-items: center; gap: 10px;
        justify-content: center; margin-bottom: 18px;
      }
      .brand-mark {
        width: 34px; height: 34px; border-radius: 50%;
        background: var(--accent-bg); color: var(--accent-text);
        display: flex; align-items: center; justify-content: center; font-weight: 600;
      }
      .brand-name { font-size: 18px; font-weight: 600; }
      .auth-title { font-size: 20px; font-weight: 600; text-align: center; margin: 0 0 4px; }
      .auth-subtitle { font-size: 14px; color: var(--text-secondary); text-align: center; margin: 0 0 22px; }

      .auth-error {
        background: var(--danger-bg); color: var(--danger-text);
        font-size: 13px; padding: 10px 12px; border-radius: var(--radius); margin-bottom: 16px;
      }
      .auth-ok {
        background: var(--success-bg); color: var(--success-text);
        font-size: 13px; padding: 12px 14px; border-radius: var(--radius);
        margin-bottom: 16px; line-height: 1.5;
      }

      .field { display: block; margin-bottom: 14px; }
      .field-label { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; }
      input {
        width: 100%; padding: 11px 12px; border: 1px solid var(--border);
        border-radius: var(--radius); background: var(--surface-1);
        color: var(--text-primary); font-size: 15px;
      }

      .btn-primary {
        width: 100%; padding: 12px; border: none; border-radius: var(--radius);
        background: var(--accent-fill); color: #fff; font-size: 15px; font-weight: 600;
        cursor: pointer; margin-top: 6px;
      }
      .btn-primary:disabled { opacity: 0.6; cursor: default; }
      .btn-link { display: block; text-align: center; text-decoration: none; box-sizing: border-box; }

      .auth-alt { text-align: center; font-size: 14px; color: var(--text-secondary); margin-top: 18px; }
      .auth-alt a { color: var(--accent-text); text-decoration: none; }
    `,
    ],
})
export class RecuperarComponent {
    private readonly auth = inject(AuthService);
    readonly version = APP_VERSION;

    email = '';
    readonly loading = signal(false);
    readonly enviado = signal(false);
    readonly error = signal('');

    async onSubmit(): Promise<void> {
        if (!this.email.trim()) return;
        this.loading.set(true);
        this.error.set('');
        try {
            await this.auth.recuperarContrasena(this.email);
            // Éxito neutro: no revelamos si el correo existe o no.
            this.enviado.set(true);
        } catch (e: unknown) {
            const code = (e as { code?: string })?.code ?? '';
            // Un correo mal formado sí lo avisamos; el resto se trata como éxito
            // neutro para no filtrar qué cuentas existen.
            if (code === 'auth/invalid-email') {
                this.error.set('Ese correo no tiene un formato válido.');
            } else {
                this.enviado.set(true);
            }
        } finally {
            this.loading.set(false);
        }
    }
}