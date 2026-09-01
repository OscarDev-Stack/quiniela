import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Firestore, doc, getDoc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { AuthCredential } from '@angular/fire/auth';
import { AuthService } from '../../core/services/auth.service';
import { StatsService } from '../../shared/stats.service';
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
            <div class="hero-ico">
              <svg viewBox="118 110 276 280" xmlns="http://www.w3.org/2000/svg" aria-label="Fut">
                <g stroke="#4a94e2" stroke-width="8" fill="none" opacity="0.6" stroke-linecap="round">
                  <rect x="138" y="130" width="236" height="180" rx="8"/>
                  <line x1="195" y1="130" x2="195" y2="310"/>
                  <line x1="256" y1="130" x2="256" y2="310"/>
                  <line x1="317" y1="130" x2="317" y2="310"/>
                  <line x1="138" y1="191" x2="374" y2="191"/>
                  <line x1="138" y1="252" x2="374" y2="252"/>
                </g>
                <path d="M 195 146 L 350 146 L 334 195 L 236 195 L 228 232 L 310 232 L 294 281 L 212 281 L 191 367 L 138 367 Z" fill="#ffffff"/>
                <circle cx="334" cy="322" r="16" fill="#8cc0f0"/>
                <path d="M 334 306 L 342 322 L 334 338 L 326 322 Z" fill="#cde3f7"/>
              </svg>
            </div>
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

          <div class="separador"><span>o</span></div>

          <button type="button" class="btn-google" [disabled]="loading()" (click)="onGoogle()">
            <svg class="google-ico" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            {{ loading() ? 'Conectando…' : 'Continuar con Google' }}
          </button>

          <p class="auth-alt">
            <a routerLink="/recuperar">¿Olvidaste tu contraseña?</a>
          </p>
        </div>

        <p class="auth-alt auth-alt--fuera">
          ¿No tienes cuenta? <a routerLink="/registro">Crear cuenta</a>
        </p>
      </div>
      <p class="version">v{{ version }}</p>

      <!-- Vinculación: el correo ya existe con contraseña y el usuario quiere
           entrar con Google. Le pedimos su contraseña para unir ambos métodos. -->
      @if (mostrarVinculo()) {
        <div class="vinc-fondo" (click)="cancelarVinculo()"></div>
        <div class="vinc-modal">
          <div class="vinc-ico"><i class="ti ti-link"></i></div>
          <h2 class="vinc-tit">Conecta tu cuenta de Google</h2>
          <p class="vinc-txt">
            Ya tienes una cuenta con <strong>{{ correoVincular() }}</strong> creada con
            contraseña. Escríbela una vez para unir tu acceso con Google; luego podrás
            entrar con cualquiera de los dos.
          </p>

          @if (error()) {
            <div class="auth-error"><i class="ti ti-alert-circle"></i> {{ error() }}</div>
          }

          <form (ngSubmit)="confirmarVinculo()">
            <label class="field">
              <span class="field-label">Tu contraseña</span>
              <span class="input-wrap">
                <i class="ti ti-lock input-ico"></i>
                <input
                  type="password"
                  name="passwordVincular"
                  [(ngModel)]="passwordVincular"
                  required
                  autocomplete="current-password"
                  placeholder="••••••••"
                />
              </span>
            </label>

            <button type="submit" class="btn-primary" [disabled]="loading() || !passwordVincular">
              {{ loading() ? 'Conectando…' : 'Conectar cuentas' }}
            </button>
          </form>

          <button type="button" class="vinc-cancelar" [disabled]="loading()" (click)="cancelarVinculo()">
            Cancelar
          </button>
        </div>
      }
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
        position: relative; width: 76px; height: 76px; border-radius: 20px;
        display: flex; align-items: center; justify-content: center;
        background: var(--surface-2); border: 1px solid rgba(55, 138, 221, 0.4);
      }
      .hero-ico svg { width: 52px; height: 52px; }
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

      /* Separador "o" entre login por correo y proveedores externos */
      .separador {
        display: flex; align-items: center; gap: 12px;
        margin: 18px 0; color: var(--text-muted); font-size: 13px;
      }
      .separador::before, .separador::after {
        content: ''; flex: 1; height: 1px; background: var(--border);
      }

      /* Botón de Google: fondo claro y logo oficial */
      .btn-google {
        width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px;
        padding: 12px; border: 1px solid var(--border); border-radius: var(--radius);
        background: #fff; color: #3c4043; font-size: 15px; font-weight: 600; cursor: pointer;
      }
      .btn-google:hover { background: #f7f8f8; }
      .btn-google:disabled { opacity: 0.6; cursor: default; }
      .google-ico { width: 20px; height: 20px; flex-shrink: 0; }

      .auth-alt { text-align: center; font-size: 14px; color: var(--text-secondary); margin: 16px 0 0; }
      .auth-alt--fuera { margin-top: 20px; }
      .auth-alt a { color: var(--accent-text); text-decoration: none; font-weight: 600; }
      .auth-alt a:hover { text-decoration: underline; }

      /* Modal de vinculación de Google con la cuenta de correo existente */
      .vinc-fondo {
        position: fixed; inset: 0; z-index: 2000;
        background: rgba(0, 0, 0, 0.55);
      }
      .vinc-modal {
        position: fixed; z-index: 2001;
        top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: min(400px, calc(100vw - 32px));
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 18px; padding: 24px 22px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
      }
      .vinc-ico {
        width: 52px; height: 52px; border-radius: 14px; margin: 0 auto 14px;
        display: flex; align-items: center; justify-content: center; font-size: 26px;
        background: var(--accent-bg); color: var(--accent-text);
      }
      .vinc-tit { font-size: 18px; font-weight: 700; text-align: center; margin: 0 0 8px; }
      .vinc-txt { font-size: 13px; color: var(--text-secondary); text-align: center; margin: 0 0 18px; line-height: 1.55; }
      .vinc-txt strong { color: var(--text-primary); }
      .vinc-cancelar {
        width: 100%; margin-top: 10px; padding: 11px; cursor: pointer;
        border: none; background: transparent; color: var(--text-secondary);
        font-size: 14px; font-weight: 600;
      }
      .vinc-cancelar:hover { color: var(--text-primary); }
      .vinc-cancelar:disabled { opacity: 0.6; cursor: default; }
    `,
  ],
})
export class LoginComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly db = inject(Firestore);
  private readonly stats = inject(StatsService);
  readonly version = APP_VERSION;

  ngOnInit(): void {
    // Traza del embudo: cuánta gente llega a la pantalla de acceso.
    this.stats.evento('login_visto');
  }

  email = '';
  password = '';
  readonly loading = signal(false);
  readonly error = signal('');

  /* --- Vinculación de Google con cuenta de correo existente --- */
  readonly mostrarVinculo = signal(false);
  readonly correoVincular = signal('');
  passwordVincular = '';
  private credGooglePendiente: AuthCredential | null = null;

  async onSubmit(): Promise<void> {
    this.error.set('');
    this.loading.set(true);
    try {
      const cred = await this.auth.login(this.email, this.password);
      if (cred?.user) {
        this.stats.evento('sesion_iniciada', { metodo: 'correo' });
        await this.entrar();
      } else {
        this.error.set('No se pudo iniciar la sesión. Intenta de nuevo.');
      }
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      this.stats.evento('login_fallido', { metodo: 'correo', motivo: code ?? 'desconocido' });
      this.error.set(this.mapError(code));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Entra con Google. Si es la primera vez que este usuario accede (no tiene
   * documento en `users`), se crea en estado pendiente de validación, igual
   * que el registro normal: saldo en cero y validada en false. El alias
   * arranca con el nombre de la cuenta de Google; el usuario puede cambiarlo
   * después en su perfil.
   */
  async onGoogle(): Promise<void> {
    this.error.set('');
    this.loading.set(true);
    try {
      const cred = await this.auth.loginConGoogle();
      await this.trasAutenticar(cred);
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      // El correo ya existe con contraseña: pedimos la contraseña para
      // vincular Google a esa misma cuenta en vez de bloquear.
      if (code === 'auth/account-exists-with-different-credential') {
        const credencial = this.auth.credencialGoogleDeError(e);
        const correo =
          (e as { customData?: { email?: string } })?.customData?.email ?? '';
        if (credencial && correo) {
          this.credGooglePendiente = credencial;
          this.correoVincular.set(correo);
          this.passwordVincular = '';
          this.mostrarVinculo.set(true);
        } else {
          this.stats.evento('login_fallido', { metodo: 'google', motivo: code ?? 'desconocido' });
          this.error.set(this.mapErrorGoogle(code));
        }
      } else {
        this.stats.evento('login_fallido', { metodo: 'google', motivo: code ?? 'desconocido' });
        this.error.set(this.mapErrorGoogle(code));
      }
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Confirma la vinculación: inicia sesión con la contraseña de la cuenta
   * existente y le engancha la credencial de Google guardada. Deja al usuario
   * con ambos métodos activos sobre la misma cuenta.
   */
  async confirmarVinculo(): Promise<void> {
    if (!this.credGooglePendiente || !this.passwordVincular) return;
    this.error.set('');
    this.loading.set(true);
    try {
      const cred = await this.auth.vincularConContrasena(
        this.correoVincular(),
        this.passwordVincular,
        this.credGooglePendiente,
      );
      this.mostrarVinculo.set(false);
      this.credGooglePendiente = null;
      await this.trasAutenticar(cred);
    } catch (e: unknown) {
      // Aquí el error típico es contraseña incorrecta.
      this.error.set(this.mapError((e as { code?: string })?.code));
    } finally {
      this.loading.set(false);
    }
  }

  /** Cancela el flujo de vinculación y vuelve al login normal. */
  cancelarVinculo(): void {
    this.mostrarVinculo.set(false);
    this.credGooglePendiente = null;
    this.passwordVincular = '';
    this.error.set('');
  }

  /**
   * Tras autenticar (por Google o vinculación), crea el documento del usuario
   * si es la primera vez y navega. El documento arranca pendiente de
   * validación, igual que el registro normal.
   */
  private async trasAutenticar(cred: { user: { uid: string; email: string | null; displayName: string | null } }): Promise<void> {
    const u = cred.user;
    const ref = doc(this.db, 'users', u.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        email: u.email ?? '',
        alias: u.displayName ?? u.email?.split('@')[0] ?? 'Jugador',
        rol: 'user',
        validada: false,
        bloqueado: false,
        puntos: 0,
        createdAt: serverTimestamp(),
      });
      await this.auth.avisarRegistro();
      // Primera vez con Google: cuenta creada y a la espera de validación.
      this.stats.evento('cuenta_creada', { metodo: 'google' });
      this.stats.evento('registro_pendiente_validacion', { metodo: 'google' });
    }
    this.stats.evento('sesion_iniciada', { metodo: 'google' });
    await this.entrar();
  }

  /** Consume la invitación pendiente (si la hay) y navega a destino. */
  private async entrar(): Promise<void> {
    const invitacion = localStorage.getItem('invitacion');
    // Se consume una sola vez: si no, cada login reenvía a unirse.
    localStorage.removeItem('invitacion');
    await this.router.navigate(invitacion ? ['/unirse', invitacion] : ['/inicio']);
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

  private mapErrorGoogle(code?: string): string {
    switch (code) {
      // El usuario cerró el popup o lo canceló: no es un error real.
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
      case 'auth/user-cancelled':
        return '';
      case 'auth/popup-blocked':
        return 'El navegador bloqueó la ventana de Google. Habilita los popups e intenta de nuevo.';
      case 'auth/account-exists-with-different-credential':
        return 'Ya existe una cuenta con ese correo usando otro método de acceso.';
      case 'auth/network-request-failed':
        return 'Problema de conexión. Revisa tu internet e intenta de nuevo.';
      default:
        return 'No se pudo entrar con Google. Intenta de nuevo.';
    }
  }
}