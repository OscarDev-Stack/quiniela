import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { tap, switchMap } from 'rxjs/operators';
import { NavComponent } from '../../shared/nav.component';
import { CargandoComponent } from '../../shared/cargando.component';
import { StatsService } from '../../shared/stats.service';
import { apagarCargando } from '../../shared/cargando.util';
import { UserService } from '../../core/services/user.service';
import {
  PronosticosService,
  APUESTA_BASE,
  MULTIPLICADOR_MAX,
  TOPE_INFERIOR,
} from '../../core/services/pronosticos.service';
import { Partido, TipoPartido, fechaCierre } from '../../core/models/partido.model';
import { ResultadoPronostico } from '../../core/models/pronostico.model';

interface Opcion {
  value: ResultadoPronostico;
  label: string;
}

@Component({
  selector: 'app-pronostico',
  standalone: true,
  imports: [CommonModule, NavComponent, CargandoComponent],
  template: `
    <div class="screen">
      <app-nav [back]="true" title="Confirmar pronóstico" />

      @if (partido(); as p) {
        <div class="card">
          <div class="competition">{{ p.competition }} · {{ p.closesLabel }}</div>
          <div class="teams">
            <span class="team">{{ p.homeTeam }}</span>
            <span class="vs">vs</span>
            <span class="team">{{ p.awayTeam }}</span>
          </div>

          @if (error()) {
            <div class="error">{{ error() }}</div>
          }

          @if (cerrado(p)) {
            <div class="error">Este partido ya cerró. Ya no se aceptan pronósticos.</div>
            <button class="confirm" (click)="volver()">Volver a partidos</button>
          } @else {

          <div class="label">¿Quién gana?</div>
          <div class="options">
            @for (o of opciones(); track o.value) {
              <button
                class="option"
                [class.option--sel]="resultado() === o.value"
                (click)="resultado.set(o.value)"
              >
                {{ o.label }}
              </button>
            }
          </div>

          <div class="label">Multiplicador de apuesta</div>
          <div class="mults">
            @for (m of multiplicadores; track m) {
              <button
                class="mult"
                [class.mult--sel]="multiplicador() === m"
                [disabled]="!permitido(m)"
                (click)="multiplicador.set(m)"
              >
                x{{ m }}
              </button>
            }
          </div>

          <div class="summary">
            <div class="row">
              <span>Puntos en juego</span>
              <strong>{{ apuesta() | number }}</strong>
            </div>
            <div class="row">
              <span>Saldo después</span>
              <strong>{{ saldo() | number }} → {{ saldo() - apuesta() | number }}</strong>
            </div>
          </div>

          <div class="hint">El premio se revela al iniciar el partido.</div>

          <button class="confirm" [disabled]="!resultado() || saving()" (click)="confirmar(p)">
            {{ saving() ? 'Enviando…' : (editando() ? 'Actualizar pronóstico' : 'Confirmar pronóstico') }}
          </button>
          }
        </div>
      } @else if (cargando()) {
        <app-cargando texto="Cargando partido" />
      } @else {
        <p class="loading">No se encontró el partido.</p>
      }
    </div>
  `,
  styles: [
    `
      .card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 16px; padding: 18px; }

      .competition { font-size: 12px; color: var(--text-muted); text-align: center; margin-bottom: 6px; }
      .teams { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 18px; }
      .team { font-size: 18px; font-weight: 600; }
      .vs { font-size: 13px; color: var(--text-muted); }

      .error {
        background: var(--danger-bg); color: var(--danger-text);
        font-size: 13px; padding: 10px 12px; border-radius: var(--radius); margin-bottom: 14px;
      }

      .label { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
      .options { display: flex; gap: 8px; margin-bottom: 18px; }
      .option {
        flex: 1; padding: 10px 4px; font-size: 14px; cursor: pointer;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-secondary);
      }
      .option--sel {
        border: 2px solid var(--accent); background: var(--accent-bg);
        color: var(--accent-text); font-weight: 600;
      }

      .mults { display: flex; gap: 6px; margin-bottom: 16px; }
      .mult {
        flex: 1; padding: 11px 4px; font-size: 14px; cursor: pointer;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-secondary);
      }
      .mult--sel {
        border: 2px solid var(--accent); background: var(--accent-bg);
        color: var(--accent-text); font-weight: 600;
      }
      .mult:disabled { opacity: 0.35; cursor: not-allowed; }

      .summary { background: var(--surface-1); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; }
      .row { display: flex; justify-content: space-between; font-size: 14px; padding: 4px 0; }
      .row span { color: var(--text-secondary); }

      .hint { font-size: 12px; color: var(--text-muted); margin-bottom: 16px; }

      .confirm {
        width: 100%; padding: 12px; border: none; border-radius: var(--radius);
        background: var(--accent-fill); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
      }
      .confirm:disabled { opacity: 0.6; cursor: default; }
      .back {
        width: 100%; padding: 10px; margin-top: 8px; font-size: 14px; cursor: pointer;
        border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface-2);
      }
      .loading { color: var(--text-muted); text-align: center; padding: 32px 0; }
    `,
  ],
})
export class PronosticoComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly stats = inject(StatsService);
  private readonly db = inject(Firestore);
  private readonly service = inject(PronosticosService);
  private readonly users = inject(UserService);

  readonly multiplicadores = Array.from({ length: MULTIPLICADOR_MAX }, (_, i) => i + 1);

  private readonly id = this.route.snapshot.paramMap.get('id')!;

  readonly cargando = signal(true);
  private readonly inicioCarga = Date.now();

  readonly partido = toSignal(
    (docData(doc(this.db, 'partidos', this.id), { idField: 'id' }) as Observable<Partido | null>)
      .pipe(tap(() => apagarCargando(this.cargando, this.inicioCarga))),
    { initialValue: null },
  ) as () => Partido | null;

  private readonly me = toSignal(this.users.me$, { initialValue: null });

  /** Mi pronóstico previo (si ya pronostiqué), para poder editarlo. */
  private readonly miPronPrevio = toSignal(
    toObservable(computed(() => this.me()?.id ?? null)).pipe(
      switchMap((uid) =>
        uid
          ? (docData(doc(this.db, 'pronosticos', `${uid}_${this.id}`)) as Observable<
            { resultado?: ResultadoPronostico; multiplicador?: number } | undefined
          >)
          : of(undefined),
      ),
    ),
    { initialValue: undefined },
  );

  /** ¿Estoy editando un pronóstico ya hecho? */
  readonly editando = computed(() => !!this.miPronPrevio());

  readonly resultado = signal<ResultadoPronostico | null>(null);
  readonly multiplicador = signal(1);
  readonly saving = signal(false);
  readonly error = signal('');

  /** Precarga los valores del pronóstico previo una sola vez. */
  private precargado = false;
  private readonly precargar = effect(() => {
    const prev = this.miPronPrevio();
    if (prev && !this.precargado) {
      this.precargado = true;
      if (prev.resultado) this.resultado.set(prev.resultado);
      if (prev.multiplicador) this.multiplicador.set(prev.multiplicador);
    }
  });

  readonly saldo = computed(() => this.me()?.puntos ?? 0);
  readonly apuesta = computed(() => APUESTA_BASE * this.multiplicador());

  opciones(): Opcion[] {
    const p = this.partido();
    if (!p) return [];
    return this.opcionesPara(p.type, p);
  }

  private opcionesPara(t: TipoPartido, p: Partido): Opcion[] {
    if (t === 'quien-pasa') {
      return [
        { value: 'pasa-local', label: `Pasa ${p.homeTeam}` },
        { value: 'pasa-visitante', label: `Pasa ${p.awayTeam}` },
      ];
    }
    if (t === '1-2') {
      return [
        { value: 'local', label: p.homeTeam },
        { value: 'visitante', label: p.awayTeam },
      ];
    }
    return [
      { value: 'local', label: p.homeTeam },
      { value: 'empate', label: 'Empate' },
      { value: 'visitante', label: p.awayTeam },
    ];
  }

  /** True si el partido ya no acepta pronósticos. */
  cerrado(p: Partido): boolean {
    if (p.status !== 'abierto' && p.status !== 'cierra-pronto') return true;
    const f = fechaCierre(p);
    return f ? f.getTime() <= Date.now() : false;
  }

  /** El multiplicador solo se permite si no cruza el tope inferior. */
  permitido(m: number): boolean {
    return this.saldo() - APUESTA_BASE * m >= TOPE_INFERIOR;
  }

  async confirmar(p: Partido): Promise<void> {
    const r = this.resultado();
    if (!r) return;

    this.error.set('');
    this.saving.set(true);
    try {
      await this.service.crear(p, r, this.multiplicador());
      this.stats.evento('pronostico_hecho', { multiplicador: this.multiplicador() });
      this.router.navigate(['/mis-pronosticos']);
    } catch (e: unknown) {
      this.error.set((e as Error)?.message ?? 'No se pudo registrar el pronóstico.');
    } finally {
      this.saving.set(false);
    }
  }

  volver(): void {
    this.router.navigate(['/partidos']);
  }
}