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
import { CompeticionesService } from '../../core/services/competiciones.service';
import { Competicion } from '../../core/models/competicion.model';

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
          <div class="matchup">
            <span class="chip">{{ p.competition }}</span>
            @if (p.closesLabel) {
              <span class="closes">{{ p.closesLabel }}</span>
            }
          </div>
          <div class="teams">
            <span class="team team--home">{{ p.homeTeam }}</span>
            <span class="vs">VS</span>
            <span class="team team--away">{{ p.awayTeam }}</span>
          </div>

          @if (formaLocalEfectiva() || formaVisitanteEfectiva()) {
            <div class="forma">
              <div class="forma-lado">
                <span class="forma-eq">{{ p.homeTeam }}</span>
                <span class="racha">
                  @for (r of formaDe(formaLocalEfectiva()); track $index) {
                    <span class="punto" [class]="'punto--' + r"></span>
                  }
                </span>
              </div>
              <div class="forma-lado forma-lado--der">
                <span class="racha">
                  @for (r of formaDe(formaVisitanteEfectiva()); track $index) {
                    <span class="punto" [class]="'punto--' + r"></span>
                  }
                </span>
                <span class="forma-eq">{{ p.awayTeam }}</span>
              </div>
            </div>
            <div class="forma-nota">Forma reciente (últimos partidos)</div>
          }

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
              <strong class="stake">{{ apuesta() | number }}</strong>
            </div>
            <div class="row row--divider">
              <span>Saldo después</span>
              <span class="balance">
                <span class="balance-from">{{ saldo() | number }}</span>
                <span class="balance-arrow">→</span>
                <strong
                  class="balance-to"
                  [class.balance-to--neg]="saldo() - apuesta() < 0"
                >{{ saldo() - apuesta() | number }}</strong>
              </span>
            </div>
          </div>

          <div class="hint">
            <span class="hint-dot"></span>
            El premio se revela al iniciar el partido.
          </div>

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
      .card {
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 20px 18px 18px;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06);
      }

      .matchup {
        display: flex; align-items: center; justify-content: center; gap: 8px;
        margin-bottom: 12px; flex-wrap: wrap;
      }
      .chip {
        font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
        color: var(--accent-text); background: var(--accent-bg);
        padding: 4px 10px; border-radius: 999px;
      }
      .closes { font-size: 11px; color: var(--text-muted); }

      .teams {
        display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
        gap: 12px; margin-bottom: 20px;
      }
      .team { font-size: 18px; font-weight: 700; line-height: 1.2; }
      .team--home { text-align: right; }
      .team--away { text-align: left; }
      .vs {
        display: inline-flex; align-items: center; justify-content: center;
        width: 30px; height: 30px; border-radius: 50%;
        font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
        color: var(--text-muted); background: var(--surface-1);
        border: 1px solid var(--border);
      }

      .forma {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; margin: -6px 0 4px;
      }
      .forma-lado { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .forma-lado--der { justify-content: flex-end; }
      .forma-eq {
        font-size: 11px; color: var(--text-muted);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px;
      }
      .racha { display: inline-flex; gap: 3px; }
      .punto { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--surface-1); }
      .punto--W { background: var(--success-text); }
      .punto--D { background: var(--text-muted); }
      .punto--L { background: var(--danger-text); }
      .forma-nota { font-size: 10px; color: var(--text-muted); text-align: center; margin-bottom: 16px; }

      .error {
        background: var(--danger-bg); color: var(--danger-text);
        font-size: 13px; padding: 10px 12px; border-radius: var(--radius); margin-bottom: 14px;
      }

      .label {
        font-size: 12px; font-weight: 600; letter-spacing: 0.2px;
        text-transform: uppercase; color: var(--text-muted); margin-bottom: 10px;
      }
      .options { display: flex; gap: 8px; margin-bottom: 20px; }
      .option {
        flex: 1; padding: 14px 4px; font-size: 14px; font-weight: 600; cursor: pointer;
        border: 1.5px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-secondary);
        transition: border-color 0.15s, background 0.15s, color 0.15s, transform 0.05s;
      }
      .option:hover:not(.option--sel) { border-color: var(--border-strong); color: var(--text-primary); }
      .option:active { transform: scale(0.98); }
      .option--sel {
        border-color: var(--accent-fill); background: var(--accent-bg);
        color: var(--accent-text); font-weight: 700;
        box-shadow: inset 0 0 0 1px var(--accent-fill);
      }

      .mults { display: flex; gap: 6px; margin-bottom: 18px; }
      .mult {
        flex: 1; padding: 12px 4px; font-size: 14px; font-weight: 600; cursor: pointer;
        border: 1.5px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-secondary);
        transition: border-color 0.15s, background 0.15s, color 0.15s, transform 0.05s;
      }
      .mult:hover:not(.mult--sel):not(:disabled) { border-color: var(--border-strong); color: var(--text-primary); }
      .mult:active:not(:disabled) { transform: scale(0.96); }
      .mult--sel {
        border-color: var(--accent-fill); background: var(--accent-bg);
        color: var(--accent-text); font-weight: 700;
        box-shadow: inset 0 0 0 1px var(--accent-fill);
      }
      .mult:disabled { opacity: 0.3; cursor: not-allowed; }

      .summary {
        background: var(--surface-1); border: 1px solid var(--border);
        border-radius: 12px; padding: 6px 14px; margin-bottom: 14px;
      }
      .row {
        display: flex; align-items: center; justify-content: space-between;
        font-size: 14px; padding: 10px 0;
      }
      .row span { color: var(--text-secondary); }
      .row--divider { border-top: 1px solid var(--border); }
      .stake { font-size: 16px; font-weight: 700; color: var(--text-primary); }

      .balance { display: inline-flex; align-items: center; gap: 8px; }
      .balance-from { color: var(--text-muted); }
      .balance-arrow { color: var(--text-muted); font-size: 12px; }
      .balance-to { font-size: 15px; font-weight: 700; color: var(--text-primary); }
      .balance-to--neg { color: var(--danger-text); }

      .hint {
        display: flex; align-items: center; gap: 8px;
        font-size: 12px; color: var(--text-muted); margin-bottom: 18px;
      }
      .hint-dot {
        width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
        background: var(--warning-text);
      }

      .confirm {
        width: 100%; padding: 14px; border: none; border-radius: var(--radius);
        background: var(--accent-fill); color: #fff; font-size: 15px; font-weight: 700;
        letter-spacing: 0.2px; cursor: pointer;
        transition: filter 0.15s, transform 0.05s, box-shadow 0.15s;
        box-shadow: 0 2px 8px rgba(55, 138, 221, 0.3);
      }
      .confirm:hover:not(:disabled) { filter: brightness(1.06); }
      .confirm:active:not(:disabled) { transform: scale(0.99); }
      .confirm:disabled { opacity: 0.55; cursor: default; box-shadow: none; }
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
  private readonly competiciones = inject(CompeticionesService);

  readonly multiplicadores = Array.from({ length: MULTIPLICADOR_MAX }, (_, i) => i + 1);

  private readonly id = this.route.snapshot.paramMap.get('id')!;

  /** Todas las competiciones, para localizar la tabla cacheada por apiLigaId. */
  private readonly comps = toSignal(this.competiciones.competiciones(), {
    initialValue: [] as Competicion[],
  });

  /**
   * Forma reciente efectiva de un lado del partido. Prioriza la guardada en el
   * partido (football-data). Si no hay pero el partido tiene apiLigaId, la
   * busca en la tabla cacheada de esa liga (TheSportsDB), cruzando por nombre
   * de equipo. Así Liga MX (que football-data no cubre) también muestra forma.
   */
  private formaDesdeTabla(equipo: string): string {
    const p = this.partido();
    if (!p?.apiLigaId) return '';
    const comp = this.comps().find((c) => c.apiLigaId === p.apiLigaId && (c.tabla?.length ?? 0) > 0);
    const fila = comp?.tabla?.find((f) => f.equipo === equipo);
    return fila?.forma ?? '';
  }

  readonly formaLocalEfectiva = computed(() => {
    const p = this.partido();
    return p?.formaLocal || this.formaDesdeTabla(p?.homeTeam ?? '');
  });

  readonly formaVisitanteEfectiva = computed(() => {
    const p = this.partido();
    return p?.formaVisitante || this.formaDesdeTabla(p?.awayTeam ?? '');
  });

  /** Convierte la forma "WWDLW" en un arreglo de W/D/L para pintar puntitos. */
  formaDe(forma: string | undefined): string[] {
    if (!forma) return [];
    return forma
      .toUpperCase()
      .split('')
      .filter((c) => c === 'W' || c === 'D' || c === 'L')
      .slice(-5);
  }

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