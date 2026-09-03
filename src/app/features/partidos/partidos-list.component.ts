import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { tap } from 'rxjs/operators';
import { NavComponent } from '../../shared/nav.component';
import { CargandoComponent } from '../../shared/cargando.component';
import { apagarCargando } from '../../shared/cargando.util';
import { EscudoComponent } from '../../shared/escudo.component';
import { PartidosService } from '../../core/services/partidos.service';
import { PronosticosService } from '../../core/services/pronosticos.service';
import { BracketsService } from '../../core/services/brackets.service';
import { ContextoService } from '../../shared/contexto.service';
import { Pronostico } from '../../core/models/pronostico.model';
import { Partido, TipoPartido, textoRestante, fechaCierre, minutoVivoTexto } from '../../core/models/partido.model';

@Component({
  selector: 'app-partidos-list',
  standalone: true,
  imports: [CommonModule, NavComponent, CargandoComponent, EscudoComponent],
  template: `
    <div class="screen">
      <app-nav title="Partidos" />

      <nav class="filters">
        @for (f of filtros; track f) {
          <button class="chip" [class.chip--on]="filtro() === f" (click)="filtro.set(f)">
            {{ f }}
          </button>
        }
        <button class="ayuda-btn" (click)="verAyuda.set(true)" aria-label="Cómo se juega" title="Cómo se juega">
          <i class="ti ti-help-circle"></i>
        </button>
      </nav>

      @if (cargando()) {
        <app-cargando texto="Cargando partidos" />
      } @else if (visibles().length === 0) {
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
        <article class="card" [class.card--dim]="m.status !== 'abierto' && m.status !== 'cierra-pronto'"
          [class.card--e-abierto]="m.status === 'abierto'"
          [class.card--e-pronto]="m.status === 'cierra-pronto'"
          [class.card--e-vivo]="m.status === 'en-juego'"
          [class.card--e-cerrado]="m.status === 'cerrado'">
          <div class="card-top">
            <span class="competition">{{ m.competition }}</span>
            @switch (m.status) {
              @case ('abierto') { <span class="badge badge--open">Abierto</span> }
              @case ('cierra-pronto') { <span class="badge badge--soon">Cierra pronto</span> }
              @case ('en-juego') { <span class="badge badge--live"><span class="live-dot" aria-hidden="true"></span> En juego</span> }
              @case ('cerrado') { <span class="badge badge--done">Finalizado</span> }
            }
          </div>

          <div class="teams">
            <span class="team">
              <app-escudo [equipo]="m.homeTeam" [size]="26" />
              {{ m.homeTeam }}
            </span>
            @if (hayMarcadorVivo(m)) {
              <span class="marcador-vivo">{{ m.vivoLocal }} - {{ m.vivoVisitante }}</span>
            } @else {
              <span class="vs">vs</span>
            }
            <span class="team team--right">
              {{ m.awayTeam }}
              <app-escudo [equipo]="m.awayTeam" [size]="26" />
            </span>
          </div>

          @if (m.status === 'en-juego' && m.vivoMinuto) {
            <div class="minuto-vivo"><span class="live-dot" aria-hidden="true"></span> {{ minutoTexto(m.vivoMinuto) }}</div>
          }

          @if (fechaHora(m); as fh) {
            <div class="fecha-partido"><i class="ti ti-calendar-event"></i> {{ fh }}</div>
          }

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
              <i class="ti ti-coins"></i>
              @if (m.status === 'abierto' || m.status === 'cierra-pronto') {
                Bolsa: se revela al cerrar
              } @else {
                Bolsa: {{ m.poolTotal ?? 0 | number }} pts
              }
              @if (m.resultadoOficial) {
                <span class="winner">· ganó {{ nombreResultado(m, m.resultadoOficial) }}</span>
              }
            </div>

            @if (m.premioPor100 && m.status !== 'cerrado') {
              <div class="premios">
                @for (o of resultadosDe(m); track o) {
                  <div class="premio-cell">
                    <div class="premio-label">{{ nombreResultado(m, o) }}</div>
                    @if (hayApuestas(m, o)) {
                      <div class="premio-val">+{{ netoPor100(m, o) | number }}</div>
                      <div class="premio-sub">{{ m.conteos?.[o] ?? 0 }} apuesta(s)</div>
                    } @else {
                      <div class="premio-val soft">—</div>
                      <div class="premio-sub">sin apuestas</div>
                    }
                  </div>
                }
              </div>
            }

            <!-- Complemento: aparece solo cuando ya cerraron los pronósticos
                 (en juego o finalizado). Aclara cómo se reparte la bolsa. -->
            @if (m.status === 'en-juego' || m.status === 'cerrado') {
              <p class="nota-reparto">
                <i class="ti ti-info-circle"></i>
                La bolsa se reparte entre quienes acierten, según lo que apostó
                cada uno. El “+X por cada 100” es tu ganancia neta por cada 100 apostados.
              </p>
            }
          }
        </article>
      }

      <!-- Modal estático: cómo se juega (mecánica de premios). -->
      @if (verAyuda()) {
        <div class="modal-fondo" (click)="verAyuda.set(false)">
          <div class="modal" (click)="$event.stopPropagation()">
            <div class="modal-cab">
              <h2 class="modal-tit"><i class="ti ti-trophy"></i> ¿Cómo se gana?</h2>
              <button class="modal-x" (click)="verAyuda.set(false)" aria-label="Cerrar">
                <i class="ti ti-x"></i>
              </button>
            </div>

            <div class="modal-cuerpo">
              <p>
                Cada partido tiene una <strong>bolsa</strong>: la suma de todo lo
                que apostó la gente. Al cerrar, se reparte <strong>entre quienes
                acertaron</strong>, según lo que puso cada uno. No es cuota fija.
              </p>

              <!-- Ejemplo visual: una tarjeta como las reales (simplificada). -->
              <div class="ej-card">
                <div class="ej-top">
                  <span class="ej-comp">Ejemplo</span>
                  <span class="ej-badge">Bolsa 400</span>
                </div>
                <div class="ej-vs">
                  <span class="ej-eq ej-eq--gana">Local <i class="ti ti-trophy"></i></span>
                  <span class="ej-x">vs</span>
                  <span class="ej-eq">Visitante</span>
                </div>
                <div class="ej-premios">
                  <div class="ej-cell ej-cell--gana">
                    <div class="ej-lbl">Gana Local</div>
                    <div class="ej-val">+100</div>
                    <div class="ej-sub">por cada 100</div>
                  </div>
                  <div class="ej-cell">
                    <div class="ej-lbl">Empate</div>
                    <div class="ej-val soft">—</div>
                    <div class="ej-sub">sin apuestas</div>
                  </div>
                  <div class="ej-cell">
                    <div class="ej-lbl">Gana Visitante</div>
                    <div class="ej-val soft">—</div>
                    <div class="ej-sub">sin apuestas</div>
                  </div>
                </div>
                <p class="ej-apuestas">
                  Apostaron 100 cada uno: <strong>Brian</strong> y <strong>Gio</strong> al Local ·
                  <strong>Gabo</strong> y <strong>Erick</strong> al Visitante.
                </p>
              </div>

              <p>
                Ganó el <strong>Local</strong>. La bolsa (400) se reparte entre los
                que acertaron, <strong>Brian y Gio</strong>: cada uno recupera sus
                100 y gana <strong>100 más</strong>. Por eso ves
                <strong>“+100 por cada 100”</strong>. Gabo y Erick pierden lo que
                apostaron.
              </p>

              <p class="ej-nota">
                Mientras más gente falle, más grande es el premio de quien acierta.
                El número se ajusta hasta que el partido inicia; ahí queda fijo.
              </p>
            </div>

            <button class="modal-ok" (click)="verAyuda.set(false)">Entendido</button>
          </div>
        </div>
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
        border: 1px solid var(--border); border-left: 4px solid var(--tipo-elim-fill);
        border-radius: var(--radius);
        background: var(--tipo-elim-bg);
      }
      .bracket-info { min-width: 0; }
      .bracket-nom { display: block; font-size: 14px; font-weight: 700; color: var(--text-primary); }
      .bracket-meta { display: block; font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
      .bracket-cta {
        flex-shrink: 0; display: flex; align-items: center; gap: 2px;
        font-size: 13px; font-weight: 600; color: var(--accent-text);
      }
      :host { display: block; }

      .filters { display: flex; align-items: center; gap: 8px; overflow-x: auto; padding-bottom: 16px; }
      .ayuda-btn {
        flex-shrink: 0; margin-left: auto; width: 34px; height: 34px; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        border: 1px solid var(--border); border-radius: 50%;
        background: transparent; color: var(--text-muted); font-size: 18px;
      }
      .ayuda-btn:hover { color: var(--accent-text); border-color: var(--accent-fill); }
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
      .badge--live {
        color: #fff; background: #d63b3b;
        display: inline-flex; align-items: center; gap: 6px;
      }
      /* Punto blanco que late para reforzar el "en vivo". */
      .live-dot {
        width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
        background: #fff; box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7);
        animation: latido-vivo 1.4s ease-out infinite;
      }
      @keyframes latido-vivo {
        0% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7); }
        70% { box-shadow: 0 0 0 6px rgba(255, 255, 255, 0); }
        100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .live-dot { animation: none; }
      }
      .badge--done { color: var(--text-muted); background: var(--surface-2); }

      /* Indicador visual de estado en la orilla de la tarjeta. */
      .card--e-abierto { border-left: 4px solid var(--success-text); }
      .card--e-pronto { border-left: 4px solid var(--warning-text); }
      .card--e-vivo { border-left: 4px solid #d63b3b; }
      .card--e-cerrado { border-left: 4px solid var(--border); }

      .teams {
        display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
        gap: 10px; margin-bottom: 14px;
      }
      .team {
        font-size: 17px; font-weight: 600;
        display: flex; align-items: center; gap: 8px; min-width: 0;
      }
      .team--right { justify-content: flex-end; }
      .vs { font-size: 13px; color: var(--text-muted); }
      .marcador-vivo {
        font-size: 20px; font-weight: 800; color: var(--text-primary);
        font-variant-numeric: tabular-nums; white-space: nowrap;
      }
      .minuto-vivo {
        display: flex; align-items: center; justify-content: center; gap: 6px;
        font-size: 12px; font-weight: 700; color: #d63b3b; margin: -8px 0 12px;
      }
      .minuto-vivo .live-dot {
        width: 7px; height: 7px; border-radius: 50%; background: #d63b3b;
        box-shadow: 0 0 0 0 rgba(214, 59, 59, 0.6);
        animation: latido-vivo 1.4s ease-out infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .minuto-vivo .live-dot { animation: none; }
      }

      .fecha-partido {
        display: flex; align-items: center; justify-content: center; gap: 5px;
        font-size: 12px; color: var(--text-muted); margin: -6px 0 12px;
        text-transform: capitalize;
      }

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

      /* Nota de reparto (complemento, solo cuando ya cerró). */
      .nota-reparto {
        display: flex; gap: 7px; margin: 10px 0 0; padding: 9px 11px;
        font-size: 12px; line-height: 1.45; color: var(--text-secondary);
        background: var(--surface-1); border-radius: var(--radius);
      }
      .nota-reparto i { flex-shrink: 0; margin-top: 1px; color: var(--accent-text); }

      /* Modal "¿Cómo se gana?" */
      .modal-fondo {
        position: fixed; inset: 0; z-index: 60; background: rgba(0, 0, 0, 0.55);
        display: flex; align-items: center; justify-content: center; padding: 20px;
      }
      .modal {
        width: 100%; max-width: 440px; max-height: 85vh; overflow-y: auto;
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 18px 20px;
      }
      .modal-cab { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
      .modal-tit { display: flex; align-items: center; gap: 8px; font-size: 18px; margin: 0; }
      .modal-x {
        flex-shrink: 0; background: transparent; border: none; cursor: pointer;
        color: var(--text-muted); font-size: 20px; padding: 4px;
      }
      .modal-cuerpo p { font-size: 14px; line-height: 1.55; color: var(--text-secondary); margin: 0 0 12px; }
      .ej-nota {
        background: var(--accent-bg); color: var(--accent-text) !important;
        border-radius: var(--radius); padding: 10px 12px; font-size: 13px !important;
      }

      /* Tarjeta de ejemplo (simplificada, imita una tarjeta de partido). */
      .ej-card {
        border: 1px solid var(--border); border-radius: 12px; padding: 12px;
        margin: 0 0 14px; background: var(--surface-1);
      }
      .ej-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .ej-comp { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
      .ej-badge {
        font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px;
        background: var(--surface-2); color: var(--success-text);
      }
      .ej-vs { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 12px; }
      .ej-eq { font-size: 15px; font-weight: 700; color: var(--text-secondary); display: inline-flex; align-items: center; gap: 5px; }
      .ej-eq--gana { color: var(--text-primary); }
      .ej-eq--gana i { color: #f1c40f; font-size: 14px; }
      .ej-x { font-size: 11px; color: var(--text-muted); }
      .ej-premios { display: flex; gap: 8px; }
      .ej-cell {
        flex: 1; text-align: center; background: var(--surface-2);
        border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 4px;
      }
      .ej-cell--gana { border-color: color-mix(in srgb, var(--success-text) 45%, var(--border)); }
      .ej-lbl { font-size: 11px; color: var(--text-muted); }
      .ej-val { font-size: 16px; font-weight: 800; color: var(--success-text); }
      .ej-val.soft { color: var(--text-muted); font-weight: 600; }
      .ej-sub { font-size: 10px; color: var(--text-muted); }
      .ej-apuestas {
        font-size: 12px !important; color: var(--text-secondary); line-height: 1.5;
        margin: 12px 0 0 !important; padding-top: 10px; border-top: 1px dashed var(--border);
      }
      .modal-ok {
        width: 100%; padding: 12px; margin-top: 4px; cursor: pointer; font-weight: 600; font-size: 15px;
        border: none; border-radius: var(--radius); background: var(--accent-fill); color: #fff;
      }
    `,
  ],
})
export class PartidosListComponent {
  private readonly service = inject(PartidosService);
  private readonly contexto = inject(ContextoService);
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
  /** Modal estático "¿Cómo se gana?". */
  readonly verAyuda = signal(false);

  /** True hasta que llegan los primeros partidos, para no ver la vista vacía. */
  readonly cargando = signal(true);
  private readonly inicioCarga = Date.now();

  private readonly partidos = toSignal(
    this.service.getPartidos().pipe(tap(() => apagarCargando(this.cargando, this.inicioCarga))),
    { initialValue: [] as Partido[] },
  );

  readonly visibles = computed(() => {
    const ctx = this.contexto.grupoId(); // null = Global
    const activos = this.partidos().filter(
      (p) => p.status !== 'cancelado' && (p.grupoId ?? null) === ctx,
    );
    const f = this.filtro();
    let lista: Partido[];
    if (f === 'Abiertos') {
      // Incluye los que ya iniciaron pero aún no se liquidan.
      lista = activos.filter(
        (p) =>
          !p.liquidado &&
          (p.status === 'abierto' || p.status === 'cierra-pronto' || p.status === 'en-juego'),
      );
    } else if (f === 'Finalizados') {
      lista = activos.filter((p) => p.status === 'cerrado');
    } else {
      lista = activos;
    }
    return this.ordenar(lista);
  });

  /**
   * Orden de los partidos: primero los que están en juego, luego los que
   * siguen abiertos (el más próximo a cerrar primero), y al final los
   * cerrados. Dentro de cada grupo se ordena por su hora de cierre.
   */
  private ordenar(lista: Partido[]): Partido[] {
    const grupo = (p: Partido): number => {
      if (p.status === 'en-juego') return 0;
      if (p.status === 'abierto' || p.status === 'cierra-pronto') return 1;
      return 2; // cerrado y cualquier otro
    };
    return [...lista].sort((a, b) => {
      const ga = grupo(a);
      const gb = grupo(b);
      if (ga !== gb) return ga - gb;
      const fa = fechaCierre(a)?.getTime() ?? Infinity;
      const fb = fechaCierre(b)?.getTime() ?? Infinity;
      return fa - fb;
    });
  }

  /** Se actualiza cada 30 s para refrescar la cuenta regresiva. */
  private readonly ahora = signal(Date.now());

  constructor() {
    const t = setInterval(() => this.ahora.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  restante(p: Partido): string {
    return textoRestante(p, this.ahora());
  }

  /** ¿El partido tiene marcador en vivo para mostrar? (solo en juego). */
  hayMarcadorVivo(p: Partido): boolean {
    return (
      p.status === 'en-juego' &&
      typeof p.vivoLocal === 'number' &&
      typeof p.vivoVisitante === 'number'
    );
  }

  /** Texto del minuto/estado en vivo, traducido al español. */
  minutoTexto(min: string): string {
    return minutoVivoTexto(min);
  }

  /** Fecha y hora del partido en zona MX, ej. "sáb 6 sep · 19:00". Null si no hay. */
  fechaHora(p: Partido): string | null {
    const f = fechaCierre(p);
    if (!f) return null;
    const fecha = f.toLocaleDateString('es-MX', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    const hora = f.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    return `${fecha} · ${hora}`;
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

  /**
   * Indica si hay al menos una apuesta registrada en este resultado.
   *
   * El bug anterior usaba `netoPor100` directamente en un `@if(... ; as n)`,
   * lo cual trataba el valor 0 como falsy y mostraba "sin apuestas" incluso
   * cuando SÍ había apuestas pero el premio neto era 0 (ej: todos apostaron
   * al mismo resultado → premioPor100 = 100 → neto = 0).
   *
   * Ahora verificamos si `porResultado[r]` tiene un monto > 0, lo que indica
   * que al menos alguien apostó a esa opción, independientemente del premio.
   */
  hayApuestas(m: Partido, r: string): boolean {
    return (m.porResultado?.[r] ?? 0) > 0;
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