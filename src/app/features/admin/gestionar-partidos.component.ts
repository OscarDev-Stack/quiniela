import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { AdminService } from '../../core/services/admin.service';
import { Partido, TipoPartido, fechaCierre } from '../../core/models/partido.model';
import { Bolsa } from '../../core/models/bolsa.model';
import { ConfirmarService } from '../../shared/confirmar.service';
import { ToastService } from '../../shared/toast.service';
import { ContextoService } from '../../shared/contexto.service';

interface Outcome {
    value: string;
    label: string;
}

@Component({
    selector: 'app-gestionar-partidos',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink],
    template: `
    <div class="stats">
      <div class="stat"><div class="stat-label">Partidos</div><div class="stat-val">{{ partidos().length }}</div></div>
      <div class="stat"><div class="stat-label">Abiertos</div><div class="stat-val">{{ abiertos() }}</div></div>
      <div class="stat"><div class="stat-label">Cerrados</div><div class="stat-val">{{ cerrados() }}</div></div>
      <div class="stat">
        <div class="stat-label">Puntos en juego</div>
        <div class="stat-val accent">{{ totalEnJuego() | number }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Puntos repartidos</div>
        <div class="stat-val">{{ sistema()?.repartido ?? 0 | number }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Reserva</div>
        <div class="stat-val">{{ sistema()?.total ?? 0 | number }}</div>
      </div>
    </div>

    <a class="btn-primary ancho-crear" routerLink="/admin/partidos/crear">
      <i class="ti ti-plus"></i> Crear partido
    </a>

    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title">Partidos</h2>
        <button class="btn" [disabled]="recalculando()" (click)="recalcularBolsas()">
          {{ recalculando() ? 'Recalculando…' : 'Recalcular bolsas' }}
        </button>
      </div>

      <nav class="tabs">
        <button class="tab" [class.tab--on]="tabPartidos() === 'en-juego'" (click)="tabPartidos.set('en-juego')">
          En juego <span class="tab-num">{{ enJuego() }}</span>
        </button>
        <button class="tab" [class.tab--on]="tabPartidos() === 'abiertos'" (click)="tabPartidos.set('abiertos')">
          Abiertos <span class="tab-num">{{ abiertos() }}</span>
        </button>
        <button class="tab" [class.tab--on]="tabPartidos() === 'cerrados'" (click)="tabPartidos.set('cerrados')">
          Cerrados <span class="tab-num">{{ cerrados() }}</span>
        </button>
      </nav>

      @if (partidosVisibles().length === 0) {
        <p class="empty">No hay partidos en esta sección.</p>
      }
      @for (p of partidosVisibles(); track p.id) {
        <div class="row">
          <div class="row-main">
            <div class="row-title">{{ p.homeTeam }} vs {{ p.awayTeam }}</div>
            <div class="row-sub">
              {{ p.competition }} · {{ typeLabel(p.type) }}
              @if (cierre(p); as c) { · cierra {{ c | date: 'dd/MM, h:mm a' }} }
            </div>
            <div class="row-origen">
              @if (p.apiFixtureId) {
                <span class="origen origen--api"><i class="ti ti-cloud"></i> API</span>
              } @else {
                <span class="origen origen--manual"><i class="ti ti-hand-finger"></i> Manual</span>
              }
            </div>
          </div>
          <span class="tag tag--{{ p.status }}">{{ p.status }}</span>
          <div class="row-actions">
            @if (p.status !== 'cerrado' && p.status !== 'cancelado') {
              <button class="btn" (click)="abrirResultado(p)">Resultado</button>
              <button class="btn" (click)="cancelar(p)">Cancelar</button>
            } @else if (p.resultadoOficial) {
              <span class="result">Resultado: {{ nombreDeResultado(p, p.resultadoOficial) }}</span>
            }
          </div>

          @if (p.alertaApi) {
            <div class="alerta"><i class="ti ti-alert-triangle"></i> {{ p.alertaApi }}</div>
          }

          @if (p.resultadoPropuesto && !p.liquidado) {
            <div class="propuesta">
              <div>
                <i class="ti ti-sparkles"></i>
                La API reporta <strong>{{ p.marcadorPropuesto }}</strong> ·
                gana <strong>{{ nombreDeResultado(p, p.resultadoPropuesto) }}</strong>
              </div>
              <button class="btn-primary sm" [disabled]="liquidando()" (click)="confirmarPropuesta(p)">
                {{ liquidando() ? 'Liquidando…' : 'Confirmar y liquidar' }}
              </button>
            </div>
          }

          @if (bolsa(p.id); as b) {
            <div class="bolsa">
              <div class="bolsa-top">
                <span><i class="ti ti-coins"></i> Bolsa: <strong>{{ b.total | number }}</strong> pts</span>
              </div>
              <div class="bolsa-grid">
                @for (o of outcomesFor(p.type); track o.value) {
                  <div class="bolsa-cell">
                    <div class="bolsa-label">{{ nombreEquipo(p, o) }}</div>
                    <div class="bolsa-val">{{ b.porResultado?.[o.value] ?? 0 | number }}</div>
                    <div class="bolsa-sub">{{ b.conteos?.[o.value] ?? 0 }} pronóstico(s)</div>
                  </div>
                }
              </div>
            </div>
          }

          @if (resultFor() === p.id) {
            <div class="result-box">
              <select [(ngModel)]="chosenOutcome">
                <option value="" disabled>Elige el resultado…</option>
                @for (o of outcomesFor(p.type); track o.value) {
                  <option [value]="o.value">{{ etiquetaOpcion(p, o) }}</option>
                }
              </select>
              <button class="btn-primary sm" [disabled]="!chosenOutcome || liquidando()" (click)="guardarResultado(p)">
                {{ liquidando() ? 'Liquidando…' : 'Liquidar' }}
              </button>
              <button class="btn sm" (click)="resultFor.set(null)">Cancelar</button>
            </div>
          }
        </div>
      }
    </section>
  `,
    styles: [
        `
      .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
      .stat { background: var(--surface-1); border-radius: var(--radius); padding: 12px 14px; }
      .stat-label { font-size: 12px; color: var(--text-secondary); }
      .stat-val { font-size: 22px; font-weight: 600; }

      .panel {
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 12px; padding: 16px 18px; margin-bottom: 18px;
      }
      .panel-title { font-size: 15px; font-weight: 600; margin: 0 0 14px; }
      .panel--contexto { border: 1px solid var(--accent-fill); }
      .ctx-field { display: block; }
      .ctx-field > span { display: block; font-size: 14px; font-weight: 600; margin-bottom: 8px; }
      .ctx-field select {
        width: 100%; padding: 10px 12px; border: 1px solid var(--border);
        border-radius: var(--radius); background: var(--surface-1);
        color: var(--text-primary); font-size: 14px;
      }
      .ctx-pista { display: block; font-size: 12px; color: var(--text-muted); margin-top: 6px; }
      .panel-title--boton {
        display: flex; align-items: center; gap: 8px; width: 100%;
        cursor: pointer; text-align: left; margin: 0;
        background: transparent; border: none; padding: 0; color: inherit;
      }
      .panel-title--boton i { font-size: 17px; color: var(--text-muted); }
      .panel-title--boton:hover { color: var(--accent-text); }
      .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
      .field { display: block; margin-bottom: 12px; }
      .equipo-input { display: flex; align-items: center; gap: 8px; }
      .equipo-input input { flex: 1; }
      .btn-liga {
        flex-shrink: 0; padding: 8px 10px; font-size: 12px; font-weight: 600; cursor: pointer;
        border: 1px solid var(--border-strong); border-radius: var(--radius);
        background: transparent; color: var(--text-secondary);
      }
      .field span { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
      select {
        width: 100%; padding: 10px 12px; border: 1px solid var(--border);
        border-radius: var(--radius); background: var(--surface-2); font-size: 14px;
      }

      .btn-primary {
        padding: 10px 18px; border: none; border-radius: var(--radius);
        background: var(--accent-fill); color: #fff; font-weight: 600; font-size: 14px; cursor: pointer;
      }
      .btn-primary:disabled { opacity: 0.6; cursor: default; }
      .ancho-crear {
        display: flex; align-items: center; justify-content: center; gap: 6px;
        width: 100%; text-decoration: none; margin-bottom: 18px;
      }
      .btn-primary.sm, .btn.sm { padding: 7px 12px; font-size: 13px; }
      .btn {
        padding: 7px 14px; border: 1px solid var(--border-strong); border-radius: var(--radius);
        background: var(--surface-2); font-size: 13px; cursor: pointer;
      }

      .empty { color: var(--text-muted); font-size: 14px; }
      .row {
        display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
        padding: 12px 0; border-bottom: 1px solid var(--border);
      }
      .row:last-child { border-bottom: none; }
      .row-main { flex: 1; min-width: 160px; }
      .row-title { font-size: 14px; font-weight: 600; }
      .row-sub { font-size: 12px; color: var(--text-muted); }
      .tabs { display: flex; gap: 6px; margin-top: 8px; margin-bottom: 18px; }
      .tab {
        flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
        padding: 9px 6px; font-size: 13px; font-weight: 600; cursor: pointer;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-secondary);
      }
      .tab--on { background: var(--accent-fill); color: #fff; border-color: var(--accent-fill); }
      .tab-num {
        flex-shrink: 0; width: 22px; height: 22px; box-sizing: border-box;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 11px; border-radius: 999px;
        background: rgba(0, 0, 0, 0.12);
      }
      .tab--on .tab-num { background: rgba(255, 255, 255, 0.25); }
      .row-origen { margin-top: 6px; }
      .origen { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 74px; box-sizing: border-box; font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
      .origen--api { color: var(--tipo-elim-fill); background: var(--tipo-elim-bg, rgba(55, 138, 221, 0.12)); }
      .origen--manual { color: var(--text-secondary); background: var(--surface-1); }
      .row-actions { display: flex; gap: 6px; align-items: center; }
      .result { font-size: 12px; color: var(--text-secondary); }

      .tag { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; background: var(--surface-1); color: var(--text-secondary); }
      .tag--abierto { color: var(--success-text); background: var(--success-bg); }
      .tag--cierra-pronto { color: var(--warning-text); background: var(--warning-bg); }
      .tag--cancelado { color: var(--danger-text); background: var(--danger-bg); }

      .alerta {
        width: 100%; margin-top: 8px; font-size: 13px; padding: 9px 12px;
        border-radius: var(--radius); background: var(--warning-bg); color: var(--warning-text);
      }
      .propuesta {
        width: 100%; margin-top: 8px; display: flex; align-items: center; gap: 10px;
        flex-wrap: wrap; justify-content: space-between;
        font-size: 13px; padding: 10px 12px; border-radius: var(--radius);
        background: var(--accent-bg); color: var(--accent-text);
      }
      .msg {
        display: flex; align-items: center; gap: 8px; cursor: pointer;
        margin-bottom: 16px; font-size: 13px; padding: 11px 13px;
        border-radius: var(--radius);
        background: var(--success-bg); color: var(--success-text);
      }
      .msg .cerrar { margin-left: auto; opacity: 0.7; }
      .stat-val.accent { color: var(--accent-text); }

      .bolsa { width: 100%; margin-top: 10px; background: var(--surface-1); border-radius: var(--radius); padding: 10px 12px; }
      .bolsa-top { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
      .bolsa-grid { display: flex; gap: 8px; flex-wrap: wrap; }
      .bolsa-cell { flex: 1; min-width: 90px; text-align: center; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 6px; }
      .bolsa-label { font-size: 12px; color: var(--text-muted); }
      .bolsa-val { font-size: 16px; font-weight: 600; }
      .bolsa-sub { font-size: 11px; color: var(--text-muted); }

      .result-box { display: flex; gap: 8px; width: 100%; margin-top: 8px; }

      /* En pantallas chicas, una columna por campo. */
      @media (max-width: 620px) {
        .grid { grid-template-columns: 1fr; }
        .stats { grid-template-columns: 1fr 1fr; }
        .bolsa-grid { flex-direction: column; }
        .result-box { flex-wrap: wrap; }
        .result-box select { flex: 1 1 100%; }
        .row { flex-wrap: wrap; }
        .row-actions { width: 100%; }
        .row-actions button { flex: 1; }
      }
      .result-box select { flex: 1; }
    `,
    ],
})
export class GestionarPartidosComponent {
    private readonly confirmar = inject(ConfirmarService);

    private readonly admin = inject(AdminService);
    private readonly toast = inject(ToastService);
    private readonly contexto = inject(ContextoService);

    private readonly todos = toSignal(this.admin.getPartidos(), { initialValue: [] as Partido[] });

    /** Partidos del contexto activo (Global o el grupo elegido). */
    readonly partidos = computed(() => {
        const ctx = this.contexto.grupoId();
        return this.todos().filter((p) => (p.grupoId ?? null) === ctx);
    });

    readonly abiertos = computed(
        () => this.partidos().filter((p) => p.status === 'abierto' || p.status === 'cierra-pronto').length,
    );
    readonly cerrados = computed(() => this.partidos().filter((p) => p.status === 'cerrado').length);
    readonly enJuego = computed(() => this.partidos().filter((p) => p.status === 'en-juego').length);

    /** Tab activo de la lista de partidos. */
    readonly tabPartidos = signal<'en-juego' | 'abiertos' | 'cerrados'>('abiertos');

    /** Ordena por hora de cierre (el más próximo primero); sin fecha, al final. */
    private porCierre(lista: Partido[]): Partido[] {
        return [...lista].sort((a, b) => {
            const fa = fechaCierre(a)?.getTime() ?? Infinity;
            const fb = fechaCierre(b)?.getTime() ?? Infinity;
            return fa - fb;
        });
    }

    /** Partidos del tab activo, ya ordenados por cierre. */
    readonly partidosVisibles = computed(() => {
        const t = this.tabPartidos();
        const todos = this.partidos();
        if (t === 'en-juego') {
            return this.porCierre(todos.filter((p) => p.status === 'en-juego'));
        }
        if (t === 'cerrados') {
            return this.porCierre(todos.filter((p) => p.status === 'cerrado'));
        }
        // abiertos (incluye cierra-pronto)
        return this.porCierre(todos.filter((p) => p.status === 'abierto' || p.status === 'cierra-pronto'));
    });

    private readonly bolsas = toSignal(this.admin.getBolsas(), { initialValue: [] as Bolsa[] });

    /** Acumulados globales (reserva y puntos repartidos). */
    readonly sistema = toSignal(this.admin.getSistema(), { initialValue: null });

    /** Suma de todo lo apostado en partidos aún sin liquidar. */
    readonly totalEnJuego = computed(() =>
        this.bolsas().reduce((acc, b) => acc + (b.total ?? 0), 0),
    );

    bolsa(partidoId: string): Bolsa | null {
        return this.bolsas().find((b) => b.id === partidoId) ?? null;
    }

    /** Nombre legible del resultado, usando los equipos del partido. */
    nombreEquipo(p: Partido, o: { value: string; label: string }): string {
        switch (o.value) {
            case 'local':
            case 'pasa-local':
                return p.homeTeam;
            case 'visitante':
            case 'pasa-visitante':
                return p.awayTeam;
            default:
                return o.label;
        }
    }


    /** Mínimo del selector: ahora mismo, en formato datetime-local. */

    readonly resultFor = signal<string | null>(null);
    readonly liquidando = signal(false);
    readonly recalculando = signal(false);

    /* Los formularios se usan de vez en cuando: nacen cerrados
       para que la lista de partidos quede a la vista al entrar. */

    /** Crea el partido con los datos reales y su vínculo con la API. */
    /** Confirma el resultado precargado por la API y liquida. */
    async confirmarPropuesta(p: Partido): Promise<void> {
        if (!p.resultadoPropuesto) return;
        const ok = await this.confirmar.pedir({
            titulo: 'Liquidar el partido',
            mensaje: `Se usará el marcador ${p.marcadorPropuesto} y se repartirán los puntos.`,
            aceptar: 'Liquidar',
            peligro: true,
        });
        if (!ok) return;

        this.liquidando.set(true);
        try {
            const r = p.grupoId
                ? await this.admin.liquidarPartidoGrupo(p.id, p.resultadoPropuesto)
                : await this.admin.liquidar(p.id, p.resultadoPropuesto);
            this.toast.exito(
                `Liquidado: ${r.ganadores} de ${r.participantes} · bolsa ${r.bolsa} · sobrante ${r.sobrante}.`,
            );
        } catch (e: unknown) {
            this.toast.error((e as Error)?.message ?? 'No se pudo liquidar.');
        } finally {
            this.liquidando.set(false);
        }
    }

    async recalcularBolsas(): Promise<void> {
        this.recalculando.set(true);
        try {
            const r = await this.admin.recalcularBolsas();
            this.toast.exito(`Bolsas recalculadas: ${r.partidos} partido(s).`);
        } catch (e: unknown) {
            this.toast.error((e as Error)?.message ?? 'No se pudo recalcular.');
        } finally {
            this.recalculando.set(false);
        }
    }
    chosenOutcome = '';

    private readonly typeLabels: Record<TipoPartido, string> = {
        '1x2': '1-X-2',
        '1-2': '1-2',
        'quien-pasa': '¿Quién pasa?',
    };
    typeLabel(t: TipoPartido): string {
        return this.typeLabels[t];
    }

    /** Resultado ya registrado, con el nombre del equipo. */
    nombreDeResultado(p: Partido, r: string): string {
        if (r === 'local' || r === 'pasa-local') return p.homeTeam;
        if (r === 'visitante' || r === 'pasa-visitante') return p.awayTeam;
        return 'Empate';
    }

    /** Texto del resultado con el nombre real del equipo. */
    etiquetaOpcion(p: Partido, o: Outcome): string {
        switch (o.value) {
            case 'local':
                return `Gana ${p.homeTeam}`;
            case 'visitante':
                return `Gana ${p.awayTeam}`;
            case 'pasa-local':
                return `Pasa ${p.homeTeam}`;
            case 'pasa-visitante':
                return `Pasa ${p.awayTeam}`;
            default:
                return 'Empate';
        }
    }

    cierre(p: Partido): Date | null {
        return fechaCierre(p);
    }

    outcomesFor(t: TipoPartido): Outcome[] {
        if (t === 'quien-pasa') {
            return [
                { value: 'pasa-local', label: 'Pasa el local' },
                { value: 'pasa-visitante', label: 'Pasa el visitante' },
            ];
        }
        if (t === '1-2') {
            return [
                { value: 'local', label: 'Gana local' },
                { value: 'visitante', label: 'Gana visitante' },
            ];
        }
        return [
            { value: 'local', label: 'Gana local' },
            { value: 'empate', label: 'Empate' },
            { value: 'visitante', label: 'Gana visitante' },
        ];
    }

    async cancelar(p: Partido): Promise<void> {
        const ok = await this.confirmar.pedir({
            titulo: 'Cancelar el partido',
            mensaje: `${p.homeTeam} vs ${p.awayTeam}. Se devolverán los puntos apostados.`,
            aceptar: 'Cancelar partido',
            cancelar: 'Volver',
            peligro: true,
        });
        if (!ok) return;
        try {
            const r = await this.admin.cancelarPartido(p.id);
            this.toast.exito(
                `Partido cancelado · ${r.devoluciones} devolución(es) · ${r.puntosDevueltos} pts devueltos.`,
            );
        } catch (e: unknown) {
            this.toast.error((e as Error)?.message ?? 'No se pudo cancelar.');
        }
    }

    abrirResultado(p: Partido): void {
        this.chosenOutcome = '';
        this.resultFor.set(p.id);
    }

    async guardarResultado(p: Partido): Promise<void> {
        if (!this.chosenOutcome) return;
        const ok = await this.confirmar.pedir({
            titulo: 'Liquidar el partido',
            mensaje: 'Se reparten los puntos entre los ganadores. No se puede deshacer.',
            aceptar: 'Liquidar',
            peligro: true,
        });
        if (!ok) return;

        this.liquidando.set(true);
        try {
            const r = p.grupoId
                ? await this.admin.liquidarPartidoGrupo(p.id, this.chosenOutcome)
                : await this.admin.liquidar(p.id, this.chosenOutcome);
            this.toast.exito(
                `Liquidado: ${r.ganadores} ganadores de ${r.participantes} participantes · ` +
                `bolsa ${r.bolsa} pts · sobrante ${r.sobrante} pts a reserva.`,
            );
            this.resultFor.set(null);
        } catch (e: unknown) {
            this.toast.error((e as Error)?.message ?? 'No se pudo liquidar.');
        } finally {
            this.liquidando.set(false);
        }
    }
}