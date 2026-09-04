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
      <app-nav [back]="true" title="Invitación a eliminatoria" />

      <div class="invitacion">
        <div class="ico">🏆</div>

        @if (info(); as b) {
          <h1>{{ b.nombre }}</h1>
          <p class="sub">
            {{ b.modo === 'duenos' ? 'Modo dueños' : 'Pronóstico' }}
            · {{ b.equipos }} equipos
            · {{ b.formatoRondas === 'ida-vuelta' ? 'ida y vuelta' : 'partido único' }}
          </p>

          <div class="reglas">
            @if (b.costoEntrada > 0) {
              <div class="regla"><i class="ti ti-coins"></i> Entrada: {{ b.costoEntrada | number }} pts</div>
            } @else {
              <div class="regla"><i class="ti ti-gift"></i> Entrada gratis</div>
            }
            <div class="regla">
              <i class="ti ti-sitemap"></i>
              {{ b.avance === 'reordena' ? 'Liguilla (resiembra cada ronda)' : 'Copa (cuadro fijo)' }}
            </div>
            @if (b.estado !== 'inscripcion') {
              <div class="regla regla--aviso"><i class="ti ti-lock"></i> Ya no admite inscripciones.</div>
            }
          </div>
        } @else if (!error()) {
          <h1>Te invitaron a una eliminatoria</h1>
          <p class="sub">Código <strong>{{ codigo }}</strong></p>
        }

        @if (error()) {
          <p class="error">{{ error() }}</p>
        }

        @if (sesion()) {
          <button
            class="btn btn--primary"
            [disabled]="uniendo() || (info() && info()!.estado !== 'inscripcion')"
            (click)="unirse()"
          >
            {{ uniendo() ? 'Uniéndome…' : 'Unirme a la eliminatoria' }}
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
      .sub { font-size: 13px; color: var(--text-secondary); margin: 0 0 16px; }
      .sub strong { letter-spacing: 2px; color: var(--accent-text); }
      .reglas {
        text-align: left; background: var(--surface-1); border-radius: var(--radius);
        padding: 12px 14px; margin: 0 0 18px; display: flex; flex-direction: column; gap: 8px;
      }
      .regla { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); }
      .regla i { color: var(--accent-text); }
      .regla--aviso { color: var(--warning-text); }
      .regla--aviso i { color: var(--warning-text); }
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
