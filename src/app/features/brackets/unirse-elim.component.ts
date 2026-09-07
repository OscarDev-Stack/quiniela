import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Auth, user } from '@angular/fire/auth';
import { BracketsService } from '../../core/services/brackets.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../shared/toast.service';
import { StatsService } from '../../shared/stats.service';
import { NavComponent } from '../../shared/nav.component';
import { guardarInvitacion } from '../../shared/invitacion.util';

/**
 * Pantalla de invitación a una ELIMINATORIA por código (a la que lleva el QR
 * o el enlace). Muestra el nombre y las reglas antes de aceptar. Igual que la
 * de torneos: si no hay sesión, guarda la invitación y ofrece login/registro;
 * al volver, permite unirse con un toque.
 */
@Component({
  selector: 'app-unirse-elim',
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
            <div class="hero__ico"><i class="ti ti-trophy"></i></div>
            @if (info(); as b) {
              <h1 class="hero__nombre">{{ b.nombre }}</h1>
              <p class="hero__tipo">Eliminatoria · {{ b.modo === 'duenos' ? 'Modo dueños' : 'Pronóstico' }}</p>
            } @else if (!error()) {
              <h1 class="hero__nombre">Eliminatoria</h1>
              <p class="hero__tipo">Código {{ codigo }}</p>
            } @else {
              <h1 class="hero__nombre">Ups…</h1>
            }
          </div>

          <div class="body">
            @if (info(); as b) {
              <div class="chips">
                <span class="chip"><i class="ti ti-users-group"></i> {{ b.equipos }} equipos</span>
                <span class="chip">
                  <i class="ti ti-arrows-shuffle"></i>
                  {{ b.formatoRondas === 'ida-vuelta' ? 'Ida y vuelta' : 'Partido único' }}
                </span>
                <span class="chip">
                  <i class="ti ti-sitemap"></i>
                  {{ b.avance === 'reordena' ? 'Liguilla' : 'Copa' }}
                </span>
              </div>

              <div class="entrada" [class.entrada--free]="b.costoEntrada <= 0">
                @if (b.costoEntrada > 0) {
                  <div class="entrada__ico"><i class="ti ti-coins"></i></div>
                  <div class="entrada__txt">
                    <span class="entrada__label">Entrada</span>
                    <span class="entrada__valor">{{ b.costoEntrada | number }} <small>pts</small></span>
                  </div>
                } @else {
                  <div class="entrada__ico"><i class="ti ti-gift"></i></div>
                  <div class="entrada__txt">
                    <span class="entrada__label">Entrada</span>
                    <span class="entrada__valor">Gratis</span>
                  </div>
                }
              </div>

              <p class="detalle">
                <i class="ti ti-sitemap"></i>
                {{ b.avance === 'reordena' ? 'Liguilla: se resiembra el cuadro cada ronda.' : 'Copa: el cuadro queda fijo desde el inicio.' }}
              </p>

              @if (b.estado !== 'inscripcion') {
                <p class="aviso"><i class="ti ti-lock"></i> Esta eliminatoria ya no admite inscripciones.</p>
              }
            }

            @if (error()) {
              <p class="error"><i class="ti ti-alert-circle"></i> {{ error() }}</p>
            }

            @if (sesion()) {
              <button
                class="btn btn--primary"
                [disabled]="uniendo() || (info() && info()!.estado !== 'inscripcion')"
                (click)="unirse()"
              >
                <i class="ti ti-check"></i>
                {{ uniendo() ? 'Uniéndome…' : 'Unirme a la eliminatoria' }}
              </button>
              @if (info() && info()!.estado === 'inscripcion') {
                <p class="pie">Te están esperando 👀</p>
              }
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

      /* Hero con degradado en el azul de eliminatorias. */
      .hero {
        position: relative; overflow: hidden; text-align: center;
        padding: 28px 20px 24px;
        background:
          radial-gradient(120% 120% at 50% -10%, var(--tipo-elim-fill) 0%, var(--tipo-elim-text) 90%);
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

      /* Chips de un vistazo. */
      .chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 16px; }
      .chip {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 12.5px; font-weight: 600; color: var(--tipo-elim-text);
        background: var(--tipo-elim-bg); border-radius: 999px; padding: 6px 12px;
      }
      .chip i { font-size: 15px; }

      /* Entrada como gancho principal. */
      .entrada {
        display: flex; align-items: center; gap: 14px;
        background: var(--surface-1); border-radius: var(--radius);
        padding: 14px 16px; margin-bottom: 14px;
      }
      .entrada__ico {
        width: 44px; height: 44px; flex: none; border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        font-size: 22px; color: var(--warning-text); background: var(--warning-bg);
      }
      .entrada--free .entrada__ico { color: var(--success-text); background: var(--success-bg); }
      .entrada__txt { display: flex; flex-direction: column; text-align: left; }
      .entrada__label {
        font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
        color: var(--text-muted);
      }
      .entrada__valor { font-size: 20px; font-weight: 800; color: var(--text-primary); }
      .entrada__valor small { font-size: 12px; font-weight: 600; color: var(--text-secondary); }

      .detalle {
        display: flex; align-items: center; gap: 8px;
        font-size: 12.5px; color: var(--text-secondary); margin: 0 2px 16px;
      }
      .detalle i { color: var(--accent-text); font-size: 16px; }

      .aviso {
        display: flex; align-items: center; gap: 8px;
        font-size: 13px; color: var(--warning-text);
        background: var(--warning-bg); border-radius: var(--radius);
        padding: 10px 12px; margin: 0 0 14px;
      }
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
        background: var(--tipo-elim-fill); color: #fff; border-color: var(--tipo-elim-fill);
        box-shadow: 0 6px 16px rgba(55, 138, 221, 0.35);
      }
      .btn--primary:hover:not(:disabled) { filter: brightness(1.05); }
      .btn--ghost { background: transparent; }
      .btn:disabled { opacity: 0.6; cursor: default; box-shadow: none; }

      .pie { text-align: center; font-size: 12.5px; color: var(--text-muted); margin: 12px 0 0; }
    `,
  ],
})
export class UnirseElimComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly brackets = inject(BracketsService);
  private readonly toast = inject(ToastService);
  private readonly stats = inject(StatsService);
  private readonly auth = inject(Auth);
  private readonly users = inject(UserService);

  readonly codigo = (this.route.snapshot.paramMap.get('codigo') ?? '').toUpperCase();
  readonly sesion = toSignal(user(this.auth), { initialValue: null });
  private readonly me = toSignal(this.users.me$, { initialValue: undefined });

  readonly uniendo = signal(false);
  readonly error = signal('');
  readonly info = signal<{
    id: string;
    nombre: string;
    modo: 'pronostico' | 'duenos';
    equipos: number;
    avance: string;
    formatoRondas: string;
    costoEntrada: number;
    estado: string;
  } | null>(null);

  /** La cuenta debe estar validada por un administrador para participar. */
  readonly validada = computed(() => this.me()?.validada === true);

  constructor() {
    // Consulta las reglas para mostrarlas (funciona con o sin sesión).
    if (this.codigo) {
      this.brackets
        .consultar(this.codigo)
        .then((b) => this.info.set(b))
        .catch((e: Error) => this.error.set(e?.message ?? 'No encontramos esa eliminatoria.'));
    }
  }

  /** Sin sesión: guarda la invitación para retomarla tras login/registro. */
  ir(destino: 'login' | 'registro'): void {
    guardarInvitacion('bracket', this.codigo);
    this.router.navigate(['/' + destino]);
  }

  async unirse(): Promise<void> {
    if (!this.validada()) {
      this.error.set('Tu cuenta aún no ha sido validada por un administrador.');
      return;
    }
    this.uniendo.set(true);
    this.error.set('');
    try {
      const r = await this.brackets.unirse(this.codigo);
      this.stats.evento('bracket_union');
      this.toast.exito('¡Listo! Ya estás dentro.');
      this.router.navigate(['/eliminatorias', r.id]);
    } catch (e: unknown) {
      this.error.set((e as Error)?.message ?? 'No se pudo unir.');
    } finally {
      this.uniendo.set(false);
    }
  }
}
