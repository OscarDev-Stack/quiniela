import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavComponent } from '../../shared/nav.component';
import { PartidosService } from '../../core/services/partidos.service';
import { PronosticosService } from '../../core/services/pronosticos.service';
import { BracketsService } from '../../core/services/brackets.service';
import { Pronostico } from '../../core/models/pronostico.model';
import { Partido, TipoPartido, textoRestante, fechaCierre } from '../../core/models/partido.model';

@Component({
  selector: 'app-partidos-list',
  standalone: true,
  imports: [CommonModule, NavComponent],
  template: `
    <div class="screen">
      <app-nav />

      @if (bracketsPublicos().length > 0) {
        <section class="publicos">
          <h3 class="publicos-tit"><i class="ti ti-sitemap"></i> Eliminatorias abiertas</h3>
          @for (b of bracketsPublicos(); track b.id) {
            <button class="bracket-card" (click)="abrirBracket(b.id)">
              <div class="bracket-info">
                <span class="bracket-nom">{{ b.nombre }}</span>
                <span class="bracket-meta">
                  {{ b.config.equipos }} equipos
                  @if (b.costoEntrada > 0) { · {{ b.costoEntrada }} pts } @else { · Gratis }
                  @if (b.bolsa > 0) { · Bolsa {{ b.bolsa | number }} }
                </span>
              </div>
              <span class="bracket-cta">Ver <i class="ti ti-chevron-right"></i></span>
            </button>
          }
        </section>
      }

      <nav class="filters">
        @for (f of filtros; track f) {
          <button class="chip" [class.chip--on]="filtro() === f" (click)="filtro.set(f)">
            {{ f }}
          </button>
        }
      </nav>

      @if (visibles().length === 0) {
        <div class="empty">
          <i class="ti ti-ball-football"></i>
          <p>
            @if (filtro() === 'Abiertos') {
              No hay partidos abiertos ni en juego ahora mismo.
            } @else if (filtro() === 'Finalizados') {
              Todavía no hay partidos finalizados.
            } @else {
              No hay partidos disponibles.
            }
          </p>
        </div>
      }

      @for (m of visibles(); track m.id) {
        <article class="card" [class.card--dim]="m.status !== 'abierto' && m.status !== 'cierra-pronto'">
          <div class="card-top">
            <span class="competition">{{ m.competition }}</span>
            @switch (m.status) {
              @case ('abierto') { <span class="badge badge--open">Abierto</span> }
              @case ('cierra-pronto') { <span class="badge badge--soon">Cierra pronto</span> }
              @case ('en-juego') { <span class="badge"><i class="ti ti-player-play"></i> En juego</span> }
              @case ('cerrado') { <span class="badge">Finalizado</span> }
            }
          </div>

          <div class="teams">
            <span class="team">{{ m.homeTeam }}</span>
            <span class="vs">vs</span>
            <span class="team team--right">{{ m.awayTeam }}</span>
          </div>

          @if (aceptaPronosticos(m)) {
            <div class="meta">
              <span class="closes"><i class="ti ti-clock"></i> {{ restante(m) }}</span>
              <span class="type-tag">{{ typeLabel(m.type) }}</span>
            </div>
            <div class="card-footer">
              <span class="locked"><i class="ti ti-lock"></i> Premio se revela al iniciar</span>
              <button class="btn" (click)="pronosticar(m)">Pronosticar <i class="ti ti-arrow-up-right"></i></button>
            </div>
          } @else {
            @if (miPremio(m); as prem) {
              <div class="mi-premio">
                <i class="ti ti-target-arrow"></i>
                Tu pronóstico: <strong>{{ nombreResultado(m, prem.resultado) }}</strong>
                @if (m.status === 'cerrado') {
                  @if (prem.acerto) {
                    <span class="ok">· ganaste {{ prem.neto | number }} pts</span>
                  } @else {
                    <span class="ko">· perdiste {{ prem.apuesta | number }} pts</span>
                  }
                } @else if (prem.neto > 0) {
                  <span class="ok">· ganarías {{ prem.neto | number }} pts</span>
                }
              </div>
            }

            <div class="pool">
              <i class="ti ti-coins"></i> Bolsa: {{ m.poolTotal ?? 0 | number }} pts
              @if (m.resultadoOficial) {
                <span class="winner">· ganó {{ nombreResultado(m, m.resultadoOficial) }}</span>
              }
            </div>

            @if (m.premioPor100 && m.status !== 'cerrado') {
              <div class="premios">
                @for (o of resultadosDe(m); track o) {
                  <div class="premio-cell">
                    <div class="premio-label">{{ nombreResultado(m, o) }}</div>
                    @if (netoPor100(m, o); as n) {
                      <div class="premio-val">+{{ n | number }}</div>
                      <div class="premio-sub">por cada 100</div>
                    } @else {
                      <div class="premio-val soft">—</div>
                      <div class="premio-sub">sin apuestas</div>
                    }
                  </div>
                }
              </div>
            }
          }
        </article>
      }
    </div>
  `,
  styles: [
    `
      .publicos { margin-bottom: 18px; }
      .publicos-tit {
        display: flex; align-items: center; gap: 7px;
        font-size: 13px; font-weight: 700; color: var(--text-secondary); margin: 0 0 10px;
      }
      .bracket-card {
        display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%;
        padding: 13px 14px; margin-bottom: 8px; cursor: pointer; text-align: left;
        border: 1px solid var(--accent-fill); border-radius: var(--radius);
        background: var(--accent-bg);
      }
      .bracket-info { min-width: 0; }
      .bracket-nom { display: block; font-size: 14px; font-weight: 700; color: var(--text-primary); }
      .bracket-meta { display: block; font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
      .bracket-cta {
        flex-shrink: 0; display: flex; align-items: center; gap: 2px;
        font-size: 13px; font-weight: 600; color: var(--accent-text);
      }
      :host { display: block; }

      .filters { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 16px; }
      .chip {
        font-size: 13px; padding: 7px 15px; border-radius: 999px; cursor: pointer;
        border: 1px solid var(--border); background: transparent; color: var(--text-secondary);
        white-space: nowrap;
      }
      .chip--on {
        background: var(--text-primary); color: var(--surface-0);
        border-color: var(--text-primary); font-weight: 600;
      }

      .empty { text-align: center; color: var(--text-muted); padding: 48px 0; }
      .empty i { font-size: 36px; opacity: 0.5; }
      .empty p { font-size: 14px; margin: 10px 0 0; }

      .card {
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 15px; margin-bottom: 12px;
      }
      .card--dim { background: var(--surface-1); }

      .card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 10px; }
      .competition { font-size: 12px; color: var(--text-muted); }

      .badge {
        font-size: 12px; font-weight: 600; padding: 4px 11px; border-radius: 999px;
        background: var(--surface-1); color: var(--text-secondary); white-space: nowrap;
      }
      .badge--open { color: var(--success-text); background: var(--success-bg); }
      .badge--soon { color: var(--warning-text); background: var(--warning-bg); }

      .teams {
        display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
        gap: 10px; margin-bottom: 14px;
      }
      .team { font-size: 17px; font-weight: 600; }
      .team--right { text-align: right; }
      .vs { font-size: 13px; color: var(--text-muted); }

      .meta { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
      .closes { font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 5px; }
      .type-tag {
        background: var(--surface-1); padding: 3px 9px; border-radius: var(--radius);
        font-size: 12px; color: var(--text-secondary); white-space: nowrap;
      }

      .card-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .locked { font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 5px; }

      .btn {
        display: flex; align-items: center; gap: 5px; white-space: nowrap;
        font-size: 14px; padding: 9px 15px; border-radius: var(--radius); cursor: pointer;
        border: 1px solid var(--border-strong); background: transparent;
      }
      .btn:hover { background: var(--surface-1); }

      .pool { font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }
      .mi-premio {
        font-size: 13px; color: var(--text-secondary); display: flex; align-items: center;
        gap: 6px; flex-wrap: wrap; margin-bottom: 8px;
      }
      .mi-premio .ok { color: var(--success-text); font-weight: 600; }
      .mi-premio .ko { color: var(--danger-text); font-weight: 600; }
      .premios { display: flex; gap: 8px; margin-top: 10px; }
      .premio-cell {
        flex: 1; text-align: center; background: var(--surface-2);
        border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 4px;
      }
      .premio-label { font-size: 12px; color: var(--text-muted); }
      .premio-val { font-size: 16px; font-weight: 600; color: var(--success-text); }
      .premio-val.soft { color: var(--text-muted); }
      .premio-sub { font-size: 10px; color: var(--text-muted); }
      .winner { color: var(--text-muted); }
    `,
  ],
})
export class PartidosListComponent {
  private readonly service = inject(PartidosService);
  private readonly pronosticos = inject(PronosticosService);
  private readonly brackets = inject(BracketsService);
  private readonly router = inject(Router);

  /** Eliminatorias públicas abiertas, visibles para todos en el inicio. */
  readonly bracketsPublicos = toSignal(this.brackets.bracketsPublicos(), { initialValue: [] });

  abrirBracket(id: string): void {
    this.router.navigate(['/eliminatorias', id]);
  }

  /** Invitación guardada que aún no se ha aceptado. */
  readonly invitacionPendiente = signal(localStorage.getItem('invitacion'));

  abrirInvitacion(): void {
    const codigo = this.invitacionPendiente();
    if (codigo) this.router.navigate(['/unirse', codigo]);
  }

  readonly filtros = ['Abiertos', 'Todos', 'Finalizados'];
  /* Arranca en Todos: si no hay partidos abiertos, ver la lista vacía confunde. */
  readonly filtro = signal('Todos');

  private readonly partidos = toSignal(this.service.getPartidos(), {
    initialValue: [] as Partido[],
  });

  readonly visibles = computed(() => {
    const activos = this.partidos().filter((p) => p.status !== 'cancelado');
    const f = this.filtro();
    if (f === 'Abiertos') {
      // Incluye los que ya iniciaron pero aún no se liquidan.
      return activos.filter(
        (p) =>
          !p.liquidado &&
          (p.status === 'abierto' || p.status === 'cierra-pronto' || p.status === 'en-juego'),
      );
    }
    if (f === 'Finalizados') {
      return activos.filter((p) => p.status === 'cerrado');
    }
    return activos;
  });

  /** Se actualiza cada 30 s para refrescar la cuenta regresiva. */
  private readonly ahora = signal(Date.now());

  constructor() {
    const t = setInterval(() => this.ahora.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  restante(p: Partido): string {
    return textoRestante(p, this.ahora());
  }

  /** Solo si sigue abierto y su hora de cierre aún no llega. */
  aceptaPronosticos(p: Partido): boolean {
    if (p.status !== 'abierto' && p.status !== 'cierra-pronto') return false;
    const f = fechaCierre(p);
    return f ? f.getTime() > this.ahora() : true;
  }

  private readonly mios = toSignal(this.pronosticos.misPronosticos(), {
    initialValue: [] as Pronostico[],
  });

  /** Mi pronóstico en este partido y cuánto representa. */
  miPremio(m: Partido) {
    const mio = this.mios().find((x) => x.partidoId === m.id);
    if (!mio) return null;

    const apostadoAlMio = m.porResultado?.[mio.resultado] ?? 0;
    const total = m.poolTotal ?? 0;
    const premio = apostadoAlMio > 0 ? Math.floor((mio.apuesta * total) / apostadoAlMio) : 0;

    // Siempre en neto: lo que realmente sumaría o sumó a su saldo.
    const netoPotencial = premio > 0 ? premio - mio.apuesta : 0;
    const netoReal = (mio.premio ?? 0) - mio.apuesta;

    return {
      resultado: mio.resultado,
      apuesta: mio.apuesta,
      premio,
      acerto: mio.estado === 'ganado',
      neto: mio.estado === 'ganado' ? netoReal : netoPotencial,
    };
  }

  /** Resultados posibles según el tipo, para mostrar los premios. */
  resultadosDe(m: Partido): string[] {
    if (m.type === 'quien-pasa') return ['pasa-local', 'pasa-visitante'];
    if (m.type === '1-2') return ['local', 'visitante'];
    return ['local', 'empate', 'visitante'];
  }

  /** Ganancia neta por cada 100 apostados a ese resultado. */
  netoPor100(m: Partido, r: string): number {
    const bruto = m.premioPor100?.[r] ?? 0;
    return bruto > 0 ? bruto - 100 : 0;
  }

  nombreResultado(m: Partido, r: string): string {
    if (r === 'local' || r === 'pasa-local') return m.homeTeam;
    if (r === 'visitante' || r === 'pasa-visitante') return m.awayTeam;
    return 'Empate';
  }

  private readonly typeLabels: Record<TipoPartido, string> = {
    '1x2': '1-X-2',
    '1-2': '1-2',
    'quien-pasa': '¿Quién pasa?',
  };

  typeLabel(t: TipoPartido): string {
    return this.typeLabels[t] ?? t;
  }

  pronosticar(m: Partido): void {
    this.router.navigate(['/pronosticar', m.id]);
  }
}