import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { tap } from 'rxjs/operators';
import { NavComponent } from '../../shared/nav.component';
import { CargandoComponent } from '../../shared/cargando.component';
import { apagarCargando } from '../../shared/cargando.util';
import { EscudoComponent } from '../../shared/escudo.component';
import { PronosticosService } from '../../core/services/pronosticos.service';
import { PartidosService } from '../../core/services/partidos.service';
import { Pronostico, gananciaNeta } from '../../core/models/pronostico.model';
import { Partido } from '../../core/models/partido.model';

@Component({
  selector: 'app-mis-pronosticos',
  standalone: true,
  imports: [CommonModule, NavComponent, CargandoComponent, EscudoComponent],
  template: `
    <div class="screen">
      <app-nav title="Mis pronósticos" />

      @if (cargando()) {
        <app-cargando texto="Cargando pronósticos" />
      } @else if (pronosticos().length === 0) {
        <p class="empty">Todavía no has hecho ningún pronóstico.</p>
      }

      @for (p of pronosticos(); track p.id) {
        <div class="row">
          <div class="row-main">
            <div class="row-title">{{ p.partidoLabel }}</div>
            <div class="row-sub">
              @if (equipoParaEscudo(p)) {
                <app-escudo [equipo]="equipoParaEscudo(p)" [size]="18" />
              }
              {{ equipoElegido(p) }} · x{{ p.multiplicador }} ({{ p.apuesta | number }} pts)
            </div>
          </div>

          <div class="row-right">
            @switch (p.estado) {
              @case ('activo') { <span class="tag tag--warn">Activo</span> }
              @case ('ganado') { <span class="tag tag--ok">Ganado</span> }
              @case ('perdido') { <span class="tag">Perdido</span> }
              @case ('devuelto') { <span class="tag">Devuelto</span> }
            }

            @if (p.estado === 'ganado' || p.estado === 'perdido') {
              <div class="neto" [class.neto--pos]="neto(p) > 0" [class.neto--neg]="neto(p) < 0">
                {{ neto(p) > 0 ? '+' : '' }}{{ neto(p) | number }} pts
              </div>
            }

            @if (puedeEditar(p)) {
              <button class="editar" (click)="editar(p)">
                <i class="ti ti-pencil"></i> Editar
              </button>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .screen { max-width: 460px; margin: 0 auto; padding: 16px; }
      .title { font-size: 18px; font-weight: 600; margin: 0 0 14px; }
      .empty { color: var(--text-muted); font-size: 14px; text-align: center; padding: 32px 0; }

      .row {
        display: flex; align-items: center; gap: 12px;
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 12px; padding: 12px 14px; margin-bottom: 10px;
      }
      .row-main { flex: 1; }
      .row-title { font-size: 14px; font-weight: 600; }
      .row-sub { font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 6px; }
      .row-right { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }

      .tag {
        width: 84px; box-sizing: border-box;
        font-size: 12px; font-weight: 600; padding: 4px 0; border-radius: 999px;
        background: var(--surface-1); color: var(--text-secondary);
        display: inline-flex; align-items: center; justify-content: center;
      }
      .tag--ok { color: var(--success-text); background: var(--success-bg); }
      .tag--warn { color: var(--warning-text); background: var(--warning-bg); }

      .neto { font-size: 13px; font-weight: 600; }
      .neto--pos { color: var(--success-text); }
      .neto--neg { color: var(--danger-text); }

      .editar {
        width: 84px; box-sizing: border-box;
        display: inline-flex; align-items: center; justify-content: center; gap: 4px;
        font-size: 12px; font-weight: 600; cursor: pointer;
        padding: 4px 0; border-radius: 999px;
        border: 1px solid var(--accent-fill); background: transparent; color: var(--accent-fill);
      }
    `,
  ],
})
export class MisPronosticosComponent {
  private readonly service = inject(PronosticosService);
  private readonly partidosSrv = inject(PartidosService);
  private readonly router = inject(Router);

  readonly cargando = signal(true);
  private readonly inicioCarga = Date.now();

  readonly pronosticos = toSignal(
    this.service.misPronosticos().pipe(tap(() => apagarCargando(this.cargando, this.inicioCarga))),
    { initialValue: [] as Pronostico[] },
  );

  private readonly partidos = toSignal(this.partidosSrv.getPartidos(), { initialValue: [] as Partido[] });

  /** IDs de los partidos que siguen aceptando pronósticos (abiertos). */
  private readonly abiertos = computed(
    () =>
      new Set(
        this.partidos()
          .filter((m) => m.status === 'abierto' || m.status === 'cierra-pronto')
          .map((m) => m.id),
      ),
  );

  /** Solo se puede editar si el pronóstico sigue activo y su partido está abierto. */
  puedeEditar(p: Pronostico): boolean {
    return p.estado === 'activo' && this.abiertos().has(p.partidoId);
  }

  /** Va a la pantalla de pronóstico para modificarlo. */
  editar(p: Pronostico): void {
    this.router.navigate(['/pronosticar', p.partidoId]);
  }

  neto(p: Pronostico): number {
    return gananciaNeta(p);
  }

  /** Nombre del equipo elegido, sacado de la etiqueta "A vs B". */
  equipoElegido(p: Pronostico): string {
    const [local, visitante] = (p.partidoLabel ?? '').split(' vs ');
    switch (p.resultado) {
      case 'local':
        return local || 'Local';
      case 'visitante':
        return visitante || 'Visitante';
      case 'pasa-local':
        return `Pasa ${local || 'local'}`;
      case 'pasa-visitante':
        return `Pasa ${visitante || 'visitante'}`;
      default:
        return 'Empate';
    }
  }

  /** Solo el nombre del equipo elegido (sin "Pasa"), para su escudo. Vacío si fue empate. */
  equipoParaEscudo(p: Pronostico): string {
    const [local, visitante] = (p.partidoLabel ?? '').split(' vs ');
    switch (p.resultado) {
      case 'local':
      case 'pasa-local':
        return local?.trim() ?? '';
      case 'visitante':
      case 'pasa-visitante':
        return visitante?.trim() ?? '';
      default:
        return '';
    }
  }
}