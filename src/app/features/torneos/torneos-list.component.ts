import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavComponent } from '../../shared/nav.component';
import { TorneosService } from '../../core/services/torneos.service';
import { Torneo } from '../../core/models/torneo.model';

@Component({
  selector: 'app-torneos-list',
  standalone: true,
  imports: [CommonModule, NavComponent],
  template: `
    <div class="screen">
      <app-nav title="Torneos" />

      @if (visibles().length === 0) {
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
    `,
  ],
})
export class TorneosListComponent {
  private readonly service = inject(TorneosService);
  private readonly router = inject(Router);

  private readonly torneos = toSignal(this.service.misTorneos$, { initialValue: [] as Torneo[] });

  readonly visibles = computed(() =>
    [...this.torneos()].sort((a, b) => a.estado.localeCompare(b.estado)),
  );

  abrir(t: Torneo): void {
    this.router.navigate(['/torneos', t.id]);
  }
}