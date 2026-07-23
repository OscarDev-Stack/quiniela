import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Participante } from '../../core/models/torneo.model';

/**
 * Tabla del modo quiniela: ordena por puntos y desempata
 * por marcadores exactos acertados.
 */
@Component({
  selector: 'app-tabla-posiciones',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="panel">
      <h3>Tabla de posiciones</h3>

      @for (p of tabla(); track p.id; let i = $index) {
        <div class="fila" [class.fila--yo]="p.id === miUid()">
          <span class="puesto" [class.puesto--lider]="i === 0">{{ i + 1 }}</span>
          <span class="avatar">{{ inicial(p.alias) }}</span>
          <span class="alias">{{ p.alias }}</span>
          <span class="exactos">{{ p.exactos ?? 0 }} exactos</span>
          <span class="puntos">{{ p.puntosTorneo ?? 0 }}</span>
        </div>
      } @empty {
        <p class="vacio">Todavía no hay jugadores.</p>
      }
    </section>
  `,
  styles: [
    `
      .panel {
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 12px; padding: 16px 18px; margin-bottom: 14px;
      }
      h3 { font-size: 15px; font-weight: 600; margin: 0 0 10px; }
      .vacio { font-size: 13px; color: var(--text-muted); margin: 0; }

      .fila {
        display: flex; align-items: center; gap: 10px;
        padding: 9px 0; border-bottom: 1px solid var(--border);
      }
      .fila:last-child { border-bottom: none; }
      .fila--yo .alias { color: var(--accent-text); font-weight: 700; }

      .puesto {
        width: 22px; font-size: 13px; font-weight: 700;
        color: var(--text-muted); text-align: center;
      }
      .puesto--lider { color: var(--warning-text); }

      .avatar {
        width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        background: var(--surface-1); color: var(--text-secondary);
        font-size: 12px; font-weight: 600;
      }
      .alias { flex: 1; font-size: 14px; font-weight: 600; min-width: 0; }
      .exactos { font-size: 11px; color: var(--text-muted); }
      .puntos {
        font-size: 16px; font-weight: 700; color: var(--accent-text);
        min-width: 34px; text-align: right;
      }
    `,
  ],
})
export class TablaPosicionesComponent {
  readonly participantes = input.required<Participante[]>();
  readonly miUid = input<string | null>(null);

  readonly tabla = computed(() =>
    [...this.participantes()].sort((a, b) => {
      const pa = a.puntosTorneo ?? 0;
      const pb = b.puntosTorneo ?? 0;
      if (pa !== pb) return pb - pa;

      const ea = a.exactos ?? 0;
      const eb = b.exactos ?? 0;
      if (ea !== eb) return eb - ea;

      return a.alias.localeCompare(b.alias, 'es');
    }),
  );

  inicial(alias: string): string {
    return (alias ?? '?').charAt(0).toUpperCase();
  }
}