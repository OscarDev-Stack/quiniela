import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Auth, user } from '@angular/fire/auth';
import { GruposService } from '../../core/services/grupos.service';
import { ContextoService } from '../../shared/contexto.service';
import { ToastService } from '../../shared/toast.service';
import { NavComponent } from '../../shared/nav.component';

/**
 * Pantalla de invitación a un GRUPO por código (a la que lleva el QR).
 * Muestra el código y permite unirse con un toque. Si no hay sesión, guarda
 * el código y manda a iniciar sesión para retomar después.
 */
@Component({
  selector: 'app-unirse-grupo',
  standalone: true,
  imports: [CommonModule, NavComponent],
  template: `
    <div class="screen">
      <app-nav [back]="true" title="Invitación a grupo" />

      <div class="invitacion">
        <div class="ico">👥</div>
        <h1>Te invitaron a un grupo</h1>
        <p class="codigo">Código <strong>{{ codigo }}</strong></p>

        @if (error()) {
          <p class="error">{{ error() }}</p>
        }

        @if (sesion()) {
          <button class="btn btn--primary" [disabled]="uniendo()" (click)="unirse()">
            {{ uniendo() ? 'Uniéndome…' : 'Unirme al grupo' }}
          </button>
        } @else {
          <p class="hint">Inicia sesión para unirte. Guardamos la invitación.</p>
          <button class="btn btn--primary" (click)="ir('login')">Iniciar sesión</button>
          <button class="btn" (click)="ir('registro')">Crear cuenta</button>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .invitacion { max-width: 420px; margin: 20px auto 0; text-align: center; }
      .ico {
        width: 72px; height: 72px; border-radius: 18px; margin: 0 auto 14px;
        display: flex; align-items: center; justify-content: center;
        font-size: 34px; background: var(--surface-1);
      }
      h1 { font-size: 20px; margin: 0 0 6px; }
      .codigo { font-size: 14px; color: var(--text-secondary); margin: 0 0 20px; }
      .codigo strong { letter-spacing: 2px; color: var(--accent-text); }
      .error { color: var(--danger-text); font-size: 14px; margin: 0 0 14px; }
      .hint { font-size: 13px; color: var(--text-muted); margin: 0 0 12px; }
      .btn {
        width: 100%; padding: 13px; margin-top: 8px; cursor: pointer; font-size: 15px; font-weight: 600;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-primary);
      }
      .btn--primary { background: var(--accent-fill); color: #fff; border-color: var(--accent-fill); }
      .btn:disabled { opacity: 0.6; cursor: default; }
    `,
  ],
})
export class UnirseGrupoComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly gruposSrv = inject(GruposService);
  private readonly contexto = inject(ContextoService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(Auth);

  readonly codigo = (this.route.snapshot.paramMap.get('codigo') ?? '').toUpperCase();
  readonly sesion = toSignal(user(this.auth), { initialValue: null });
  readonly uniendo = signal(false);
  readonly error = signal('');

  constructor() {
    // La invitación sobrevive al login/registro: se retoma al volver.
    if (this.codigo) localStorage.setItem('invitacionGrupo', this.codigo);
  }

  ir(destino: 'login' | 'registro'): void {
    this.router.navigate(['/' + destino]);
  }

  async unirse(): Promise<void> {
    this.uniendo.set(true);
    this.error.set('');
    try {
      const r = await this.gruposSrv.unirse(this.codigo);
      localStorage.removeItem('invitacionGrupo');
      this.toast.exito(`Te uniste a ${r.nombre}.`);
      // El grupo al que te unes se vuelve el contexto activo.
      this.contexto.cambiar({ grupoId: r.grupoId, nombre: r.nombre, icono: r.icono });
      this.router.navigate(['/grupos', r.grupoId]);
    } catch (e: unknown) {
      this.error.set((e as Error)?.message ?? 'No se pudo unir al grupo.');
    } finally {
      this.uniendo.set(false);
    }
  }
}
