import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { APP_VERSION } from '../../core/version';

/**
 * Pantalla a la que llega el usuario desde el enlace del correo. Firebase
 * añade un parámetro ?oobCode=... que es el código de un solo uso. Aquí lo
 * validamos, dejamos escribir la nueva contraseña y la aplicamos. Al
 * terminar, se redirige al login para entrar con la nueva.
 *
 * Para que el enlace llegue aquí (y no a la página de Firebase), hay que
 * configurar en la consola de Firebase → Authentication → Templates el
 * "Action URL" apuntando a: https://TU-DOMINIO/cambiar-contrasena
 */
@Component({
    selector: 'app-cambiar-contrasena',
    standalone: true,
    imports: [FormsModule, RouterLink],
    template: `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="brand">
          <span class="brand-mark">Q</span>
          <span class="brand-name">Quiniela</span>
        </div>
        <h1 class="auth-title">Nueva contraseña</h1>

        @if (verificando()) {
          <p class="auth-subtitle">Validando el enlace…</p>
        } @else if (codigoInvalido()) {
          <div class="auth-error">
            Este enlace ya no es válido o expiró. Pide uno nuevo desde
            "¿Olvidaste tu contraseña?".
          </div>
          <a routerLink="/recuperar" class="btn-primary btn-link">Pedir otro enlace</a>
        } @else if (listo()) {
          <div class="auth-ok">
            ¡Listo! Tu contraseña se cambió. Ya puedes entrar con ella.
          </div>
          <a routerLink="/login" class="btn-primary btn-link">Iniciar sesión</a>
        } @else {
          <p class="auth-subtitle">Cuenta: {{ correo() }}</p>

          @if (error()) {
            <div class="auth-error">{{ error() }}</div>
          }

          <form (ngSubmit)="onSubmit()">
            <label class="field">
              <span class="field-label">Nueva contraseña</span>
              <input
                type="password"
                name="nueva"
                [(ngModel)]="nueva"
                required
                autocomplete="new-password"
                placeholder="••••••••"
              />
            </label>

            <label class="field">
              <span class="field-label">Confírmala</span>
              <input
                type="password"
                name="confirma"
                [(ngModel)]="confirma"
                required
                autocomplete="new-password"
                placeholder="••••••••"
              />
            </label>

            <button type="submit" class="btn-primary" [disabled]="loading()">
              {{ loading() ? 'Guardando…' : 'Cambiar contraseña' }}
            </button>
          </form>
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
        font-size: 13px; padding: 10px 12px; border-radius: var(--radius);
        margin-bottom: 16px; line-height: 1.5;
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
    `,
    ],
})
export class CambiarContrasenaComponent {
    private readonly auth = inject(AuthService);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    readonly version = APP_VERSION;

    private oobCode = '';
    nueva = '';
    confirma = '';

    readonly verificando = signal(true);
    readonly codigoInvalido = signal(false);
    readonly correo = signal('');
    readonly loading = signal(false);
    readonly listo = signal(false);
    readonly error = signal('');

    constructor() {
        // El enlace del correo trae ?oobCode=... (a veces también ?mode=resetPassword).
        const code = this.route.snapshot.queryParamMap.get('oobCode') ?? '';
        if (!code) {
            this.verificando.set(false);
            this.codigoInvalido.set(true);
            return;
        }
        this.oobCode = code;
        this.validar(code);
    }

    private async validar(code: string): Promise<void> {
        try {
            const email = await this.auth.verificarCodigoReset(code);
            this.correo.set(email);
        } catch {
            this.codigoInvalido.set(true);
        } finally {
            this.verificando.set(false);
        }
    }

    async onSubmit(): Promise<void> {
        this.error.set('');
        if (this.nueva.length < 6) {
            this.error.set('La contraseña debe tener al menos 6 caracteres.');
            return;
        }
        if (this.nueva !== this.confirma) {
            this.error.set('Las contraseñas no coinciden.');
            return;
        }
        this.loading.set(true);
        try {
            await this.auth.confirmarNuevaContrasena(this.oobCode, this.nueva);
            this.listo.set(true);
        } catch (e: unknown) {
            const code = (e as { code?: string })?.code ?? '';
            if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
                this.codigoInvalido.set(true);
            } else if (code === 'auth/weak-password') {
                this.error.set('La contraseña es muy débil. Usa al menos 6 caracteres.');
            } else {
                this.error.set('No se pudo cambiar la contraseña. Intenta de nuevo.');
            }
        } finally {
            this.loading.set(false);
        }
    }
}