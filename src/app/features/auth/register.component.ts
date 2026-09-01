import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Firestore, doc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { AuthService } from '../../core/services/auth.service';
import { StatsService } from '../../shared/stats.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-wrap">
      <div class="fondo-glow"></div>

      <div class="auth-content">
        <div class="hero">
          <div class="hero-ico-wrap">
            <div class="hero-ico-glow"></div>
            <div class="hero-ico"><i class="ti ti-user"></i></div>
          </div>
          <h1 class="hero-titulo">Crear cuenta</h1>
          <p class="hero-sub">Regístrate para empezar a competir</p>
        </div>

        <div class="auth-card">
          @if (error()) {
            <div class="auth-error"><i class="ti ti-alert-circle"></i> {{ error() }}</div>
          }

          <form (ngSubmit)="onSubmit()">
            <label class="field">
              <span class="field-label">Alias</span>
              <span class="input-wrap">
                <i class="ti ti-user input-ico"></i>
                <input type="text" name="alias" [(ngModel)]="alias" required maxlength="20" placeholder="Cómo te verán en el ranking" />
              </span>
            </label>

            <label class="field">
              <span class="field-label">Correo electrónico</span>
              <span class="input-wrap">
                <i class="ti ti-mail input-ico"></i>
                <input type="email" name="email" [(ngModel)]="email" required autocomplete="email" placeholder="tu@correo.com" />
              </span>
            </label>

            <label class="field">
              <span class="field-label">Contraseña</span>
              <span class="input-wrap">
                <i class="ti ti-lock input-ico"></i>
                <input type="password" name="password" [(ngModel)]="password" required autocomplete="new-password" placeholder="Mínimo 6 caracteres" />
              </span>
            </label>

            <label class="field">
              <span class="field-label">Confirmar contraseña</span>
              <span class="input-wrap">
                <i class="ti ti-lock input-ico"></i>
                <input type="password" name="confirm" [(ngModel)]="confirm" required autocomplete="new-password" placeholder="Repite tu contraseña" />
              </span>
            </label>

            <button type="submit" class="btn-primary" [disabled]="loading()">
              {{ loading() ? 'Creando…' : 'Crear cuenta' }}
            </button>
          </form>

          <p class="auth-alt">¿Ya tienes cuenta? <a routerLink="/login">Iniciar sesión</a></p>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .auth-wrap {
        position: relative; min-height: 100vh; overflow: hidden;
        display: flex; align-items: center; justify-content: center;
        padding: calc(24px + env(safe-area-inset-top)) 22px calc(40px + env(safe-area-inset-bottom));
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
      .hero-sub { font-size: 14px; color: var(--text-secondary); margin: 0; }

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
      .auth-alt a { color: var(--accent-text); text-decoration: none; font-weight: 600; }
      .auth-alt a:hover { text-decoration: underline; }
    `,
  ],
})
export class RegisterComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly db = inject(Firestore);
  private readonly stats = inject(StatsService);

  ngOnInit(): void {
    // Traza del embudo: cuánta gente llega a la pantalla de crear cuenta.
    this.stats.evento('registro_visto');
  }

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

      // Traza del embudo: cuenta creada por correo y a la espera de validación.
      this.stats.evento('cuenta_creada', { metodo: 'correo' });
      this.stats.evento('registro_pendiente_validacion', { metodo: 'correo' });

      const invitacion = localStorage.getItem('invitacion');
      // Se consume una sola vez: si no, cada login reenvía a unirse.
      localStorage.removeItem('invitacion');
      this.router.navigate(invitacion ? ['/unirse', invitacion] : ['/inicio']);
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      this.stats.evento('registro_fallido', { motivo: code ?? 'desconocido' });
      this.error.set(this.mapError(code));
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