import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PronosticoBracket } from '../../core/models/bracket.model';

/**
 * Tabla de una eliminatoria ya calificada: quién quedó en cada lugar,
 * con sus puntos y el premio que se llevó. Ordena por posición si ya
 * viene calculada; si no, por puntos.
 */
@Component({
    selector: 'app-tabla-bracket',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div class="tabla">
      @for (p of ordenados(); track p.id) {
        <div class="fila" [class.fila--yo]="p.uid === miUid()">
          <span class="pos" [class.pos--premio]="(p.premio ?? 0) > 0">{{ p.posicion ?? '–' }}</span>
          <span class="alias">{{ p.uid === miUid() ? 'Tú' : p.alias }}</span>
          @if ((p.premio ?? 0) > 0) {
            <span class="premio">+{{ p.premio | number }}</span>
          }
          <span class="puntos">{{ p.puntos ?? 0 }}</span>
        </div>
      } @empty {
        <p class="vacio">Nadie pronosticó esta eliminatoria.</p>
      }
    </div>
  `,
    styles: [
        `
      .fila {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 0; border-bottom: 1px solid var(--border);
      }
      .fila:last-child { border-bottom: none; }
      .fila--yo .alias { color: var(--accent-text); font-weight: 700; }
      .pos {
        width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 700;
        background: var(--surface-1); color: var(--text-muted);
      }
      .pos--premio { background: var(--accent-bg); color: var(--accent-text); }
      .alias { flex: 1; font-size: 14px; font-weight: 600; min-width: 0; }
      .premio { font-size: 12px; font-weight: 600; color: var(--success-text); }
      .puntos {
        font-size: 16px; font-weight: 700; color: var(--accent-text);
        min-width: 34px; text-align: right;
      }
      .vacio { font-size: 13px; color: var(--text-muted); margin: 0; }
    `,
    ],
})
export class TablaBracketComponent {
    readonly pronosticos = input.required<PronosticoBracket[]>();
    readonly miUid = input<string | null>(null);

    readonly ordenados = computed(() =>
        [...this.pronosticos()].sort((a, b) => {
            if (a.posicion && b.posicion) return a.posicion - b.posicion;
            return (b.puntos ?? 0) - (a.puntos ?? 0);
        }),
    );
}