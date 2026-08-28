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
      <div class="fondo-glow"></div>

      <div class="auth-content">
        <div class="hero">
          <div class="hero-ico-wrap">
            <div class="hero-ico-glow"></div>
            <div class="hero-ico"><i class="ti ti-mail"></i></div>
          </div>
          <h1 class="hero-titulo">Recuperar contraseña</h1>
          <p class="hero-sub">Te enviaremos un enlace para crear una nueva contraseña</p>
        </div>

        <div class="auth-card">
          @if (error()) {
            <div class="auth-error"><i class="ti ti-alert-circle"></i> {{ error() }}</div>
          }

          @if (enviado()) {
            <div class="auth-ok">
              <i class="ti ti-circle-check"></i>
              Si ese correo tiene una cuenta, te llegará un enlace en unos minutos.
              Revisa también la carpeta de spam.
            </div>
            <a routerLink="/login" class="btn-primary btn-link">Volver a iniciar sesión</a>
          } @else {
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

              <button type="submit" class="btn-primary" [disabled]="loading() || !email">
                {{ loading() ? 'Enviando…' : 'Enviar enlace' }}
              </button>
            </form>

            <p class="auth-alt">
              <a routerLink="/login">Volver a iniciar sesión</a>
            </p>
          }
        </div>
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

      .hero { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 24px; }
      .hero-ico-wrap { position: relative; margin-bottom: 16px; }
      .hero-ico-glow {
        position: absolute; inset: -16px; border-radius: 50%;
        background: radial-gradient(circle, rgba(55, 138, 221, 0.45), transparent 70%);
      }
      .hero-ico {
        position: relative; width: 76px; height: 76px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center; font-size: 34px;
        color: var(--accent-text);
        background: var(--surface-2); border: 1px solid rgba(55, 138, 221, 0.4);
      }
      .hero-titulo { font-size: 22px; font-weight: 700; margin: 0 0 8px; }
      .hero-sub { font-size: 14px; color: var(--text-secondary); margin: 0; line-height: 1.4; padding: 0 12px; }

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
      .auth-ok {
        display: flex; align-items: flex-start; gap: 8px;
        background: var(--success-bg); color: var(--success-text);
        font-size: 13px; padding: 12px 14px; border-radius: var(--radius);
        margin-bottom: 16px; line-height: 1.5;
      }
      .auth-ok i { font-size: 18px; flex-shrink: 0; margin-top: 1px; }

      .field { display: block; margin-bottom: 16px; }
      .field-label { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 7px; }

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
      .btn-link { display: block; text-align: center; text-decoration: none; box-sizing: border-box; }

      .auth-alt { text-align: center; font-size: 14px; color: var(--text-secondary); margin-top: 16px; }
      .auth-alt a { color: var(--accent-text); text-decoration: none; font-weight: 600; }
      .auth-alt a:hover { text-decoration: underline; }
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