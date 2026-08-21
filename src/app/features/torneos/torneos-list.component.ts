import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { tap } from 'rxjs/operators';
import { NavComponent } from '../../shared/nav.component';
import { CargandoComponent } from '../../shared/cargando.component';
import { apagarCargando } from '../../shared/cargando.util';
import { TorneosService } from '../../core/services/torneos.service';
import { BracketsService } from '../../core/services/brackets.service';
import { Torneo } from '../../core/models/torneo.model';
import { Bracket } from '../../core/models/bracket.model';

@Component({
  selector: 'app-torneos-list',
  standalone: true,
  imports: [CommonModule, NavComponent, CargandoComponent],
  template: `
    <div class="screen">
      <app-nav title="Torneos" />

      @if (cargando()) {
        <app-cargando texto="Cargando torneos" />
      } @else if (visibles().length === 0 && brackets().length === 0) {
        <div class="vacio">
          <i class="ti ti-tournament"></i>
          <p>No participas en ningún torneo.</p>
          <p class="pista">Los torneos son por invitación: alguien debe compartirte su enlace.</p>
        </div>
      }

      @for (t of visibles(); track t.id) {
        <article class="card" (click)="abrir(t)">
          <div class="top">
            <span class="competicion">{{ t.competicionNombre }}</span>
            @switch (t.estado) {
              @case ('inscripcion') { <span class="tag tag--ok">Inscripciones</span> }
              @case ('en-curso') { <span class="tag tag--warn">Jornada {{ t.jornadaActual }}</span> }
              @case ('finalizado') { <span class="tag">Finalizado</span> }
            }
          </div>
          <h2>{{ t.nombre }}</h2>
          <div class="meta">
            @if (t.modo === 'quiniela') {
              <span><i class="ti ti-target-arrow"></i> Por puntos</span>
              @if (t.jornadas) {
                <span><i class="ti ti-list-numbers"></i> {{ t.jornadas }} jornadas</span>
              }
            } @else {
              <span><i class="ti ti-heart"></i> 1 vida</span>
            }
            @if (t.estado === 'inscripcion') {
              <span><i class="ti ti-flag"></i> Inicia en J{{ t.jornadaInicial }}</span>
            }
            @if (t.costoEntrada > 0) {
              <span class="bolsa">
                <i class="ti ti-coins"></i> Bolsa {{ t.bolsa | number }} pts
              </span>
            }
            @if (t.ganadorAlias) {
              <span class="ganador"><i class="ti ti-trophy"></i> {{ t.ganadorAlias }}</span>
            }
            @if (t.premioPagado) {
              <span class="premio">{{ t.premioPagado | number }} pts</span>
            }
          </div>
        </article>
      }

      @if (brackets().length > 0) {
        <h3 class="seccion">Eliminatorias</h3>
        @for (b of brackets(); track b.id) {
          <article class="card card--bracket" (click)="abrirBracket(b)">
            <div class="top">
              <span class="competicion">Eliminatoria</span>
              @switch (b.estado) {
                @case ('inscripcion') { <span class="tag tag--ok">Abierta</span> }
                @case ('en-curso') { <span class="tag tag--warn">En juego</span> }
                @case ('finalizado') { <span class="tag">Finalizada</span> }
              }
            </div>
            <h2>{{ b.nombre }}</h2>
            <div class="meta">
              <span><i class="ti ti-sitemap"></i> {{ tipoBracket(b) }}</span>
              <span><i class="ti ti-users"></i> {{ b.config.equipos }} equipos</span>
              @if (b.costoEntrada > 0) {
                <span class="bolsa"><i class="ti ti-coins"></i> Bolsa {{ b.bolsa | number }} pts</span>
              }
              @if (b.ganadorAlias) {
                <span class="ganador"><i class="ti ti-trophy"></i> {{ b.ganadorAlias }}</span>
              }
            </div>
          </article>
        }
      }
    </div>
  `,
  styles: [
    `
      .vacio { text-align: center; color: var(--text-muted); padding: 48px 0; }
      .vacio i { font-size: 36px; opacity: 0.5; }
      .vacio p { font-size: 14px; margin: 10px 0 0; }
      .vacio .pista { font-size: 12px; opacity: 0.8; }

      .card {
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 15px; margin-bottom: 12px; cursor: pointer;
      }
      .top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      .competicion { font-size: 12px; color: var(--text-muted); }
      h2 { font-size: 17px; font-weight: 600; margin: 0 0 8px; }
      .meta { display: flex; gap: 14px; font-size: 13px; color: var(--text-secondary); }
      .meta i { font-size: 14px; vertical-align: -1px; }
      .ganador { color: var(--warning-text); font-weight: 600; }
      .bolsa { color: var(--success-text); font-weight: 600; }
      .premio { color: var(--success-text); }

      .tag { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px;
        background: var(--surface-1); color: var(--text-secondary); }
      .tag--ok { color: var(--success-text); background: var(--success-bg); }
      .tag--warn { color: var(--warning-text); background: var(--warning-bg); }
      .seccion {
        font-size: 13px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;
        color: var(--text-muted); margin: 22px 0 12px;
      }
      .card--bracket { border-left: 3px solid var(--accent-fill); }
    `,
  ],
})
export class TorneosListComponent {
  private readonly service = inject(TorneosService);
  private readonly bracketsService = inject(BracketsService);
  private readonly router = inject(Router);

  /** True hasta que llegan los primeros torneos. */
  readonly cargando = signal(true);
  private readonly inicioCarga = Date.now();

  private readonly torneos = toSignal(
    this.service.misTorneos$.pipe(tap(() => apagarCargando(this.cargando, this.inicioCarga))),
    { initialValue: [] as Torneo[] },
  );
  readonly brackets = toSignal(this.bracketsService.misBrackets(), { initialValue: [] as Bracket[] });

  readonly visibles = computed(() =>
    [...this.torneos()].sort((a, b) => a.estado.localeCompare(b.estado)),
  );

  abrir(t: Torneo): void {
    this.router.navigate(['/torneos', t.id]);
  }

  abrirBracket(b: Bracket): void {
    this.router.navigate(['/eliminatorias', b.id]);
  }

  /** Describe el tipo de eliminatoria: formato y cruces. */
  tipoBracket(b: Bracket): string {
    const rondas = b.config.formatoRondas === 'ida-vuelta' ? 'ida y vuelta' : 'partido único';
    return b.config.avance === 'reordena' ? `Liguilla · ${rondas}` : `Copa · ${rondas}`;
  }
}