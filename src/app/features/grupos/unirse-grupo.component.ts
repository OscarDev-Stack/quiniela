import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Auth, user } from '@angular/fire/auth';
import { GruposService } from '../../core/services/grupos.service';
import { ContextoService } from '../../shared/contexto.service';
import { ToastService } from '../../shared/toast.service';
import { NavComponent } from '../../shared/nav.component';
import { guardarInvitacion, limpiarInvitacion } from '../../shared/invitacion.util';

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
      <app-nav [back]="true" title="Invitación" />

      <div class="invitacion">
        <div class="card">
          <div class="hero">
            <div class="hero__glow"></div>
            <span class="hero__badge">Te invitaron</span>
            <div class="hero__ico"><i class="ti ti-users-group"></i></div>
            <h1 class="hero__nombre">Únete al grupo</h1>
            <p class="hero__tipo">Comparte quinielas y compite con tu gente</p>
          </div>

          <div class="body">
            <div class="codigo">
              <span class="codigo__label">Código de invitación</span>
              <span class="codigo__valor">{{ codigo }}</span>
            </div>

            <p class="detalle">
              <i class="ti ti-friends"></i>
              Demuestra quién sabe más de futbol.
            </p>

            @if (error()) {
              <p class="error"><i class="ti ti-alert-circle"></i> {{ error() }}</p>
            }

            @if (sesion()) {
              <button class="btn btn--primary" [disabled]="uniendo()" (click)="unirse()">
                <i class="ti ti-check"></i>
                {{ uniendo() ? 'Uniéndome…' : 'Unirme al grupo' }}
              </button>
              <p class="pie">Te están esperando 👋</p>
            } @else {
              <button class="btn btn--primary" (click)="ir('login')">
                <i class="ti ti-login"></i> Iniciar sesión y unirme
              </button>
              <button class="btn btn--ghost" (click)="ir('registro')">Crear cuenta</button>
              <p class="pie">Guardamos tu invitación mientras entras.</p>
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .invitacion { max-width: 440px; margin: 16px auto 0; padding: 0 4px; }

      .card {
        border: 1px solid var(--border); border-radius: var(--radius-lg);
        background: var(--surface-2); overflow: hidden;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
      }

      /* Hero con el teal de grupos. */
      .hero {
        position: relative; overflow: hidden; text-align: center;
        padding: 28px 20px 24px;
        background: radial-gradient(120% 120% at 50% -10%, var(--grupo-fill) 0%, var(--grupo-text) 90%);
        color: #fff;
      }
      .hero__glow {
        position: absolute; inset: 0;
        background: radial-gradient(60% 50% at 50% 0%, rgba(255, 255, 255, 0.28), transparent 70%);
        pointer-events: none;
      }
      .hero__badge {
        position: relative; display: inline-block;
        font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
        padding: 4px 10px; border-radius: 999px; margin-bottom: 14px;
        background: rgba(255, 255, 255, 0.18); color: #fff;
        backdrop-filter: blur(2px);
      }
      .hero__ico {
        position: relative; width: 66px; height: 66px; margin: 0 auto 12px;
        display: flex; align-items: center; justify-content: center;
        font-size: 32px; border-radius: 20px;
        background: rgba(255, 255, 255, 0.16);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
      }
      .hero__ico i { line-height: 1; }
      .hero__nombre { position: relative; font-size: 23px; font-weight: 800; margin: 0 0 4px; }
      .hero__tipo { position: relative; font-size: 13px; margin: 0; opacity: 0.9; }

      .body { padding: 20px 18px 22px; }

      /* Código destacado. */
      .codigo {
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        background: var(--grupo-bg); border-radius: var(--radius);
        padding: 14px 16px; margin-bottom: 14px;
      }
      .codigo__label {
        font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
        color: var(--grupo-text); opacity: 0.85;
      }
      .codigo__valor {
        font-size: 26px; font-weight: 800; letter-spacing: 4px; color: var(--grupo-text);
      }

      .detalle {
        display: flex; align-items: center; gap: 8px;
        font-size: 12.5px; color: var(--text-secondary); margin: 0 2px 16px;
      }
      .detalle i { color: var(--grupo-fill); font-size: 16px; }

      .error {
        display: flex; align-items: center; gap: 8px;
        font-size: 13px; color: var(--danger-text);
        background: var(--danger-bg); border-radius: var(--radius);
        padding: 10px 12px; margin: 0 0 14px;
      }

      .btn {
        width: 100%; padding: 13px; margin-top: 8px; cursor: pointer;
        font-size: 15px; font-weight: 700;
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-primary);
        transition: transform 0.05s ease, filter 0.15s ease;
      }
      .btn:active { transform: translateY(1px); }
      .btn--primary {
        background: var(--grupo-fill); color: #fff; border-color: var(--grupo-fill);
        box-shadow: 0 6px 16px rgba(13, 148, 136, 0.35);
      }
      .btn--primary:hover:not(:disabled) { filter: brightness(1.05); }
      .btn--ghost { background: transparent; }
      .btn:disabled { opacity: 0.6; cursor: default; box-shadow: none; }

      .pie { text-align: center; font-size: 12.5px; color: var(--text-muted); margin: 12px 0 0; }
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

  ir(destino: 'login' | 'registro'): void {
    // Sin sesión: guarda la invitación para retomarla tras login/registro.
    guardarInvitacion('grupo', this.codigo);
    this.router.navigate(['/' + destino]);
  }

  async unirse(): Promise<void> {
    this.uniendo.set(true);
    this.error.set('');
    try {
      const r = await this.gruposSrv.unirse(this.codigo);
      limpiarInvitacion();
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
