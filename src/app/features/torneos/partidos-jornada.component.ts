import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Jornada, PartidoJornada } from '../../core/models/competicion.model';

/**
 * Los partidos de la jornada con su marcador.
 * Resalta aquel donde juega el equipo que eligió quien mira.
 */
@Component({
    selector: 'app-partidos-jornada',
    standalone: true,
    imports: [CommonModule],
    template: `
    <section class="panel">
      <div class="panel-head">
        <h3>Partidos de la jornada</h3>
        <span class="restantes">{{ jugados() }} de {{ jornada().partidos.length }} jugados</span>
      </div>

      @for (p of jornada().partidos; track $index) {
        <div class="encuentro" [class.encuentro--mio]="esMio(p)">
          <span class="lado" [class.lado--gano]="p.resultado === 'local'">{{ p.local }}</span>

          <span class="marcador">
            @if (p.resultado === 'pospuesto') {
              <span class="apl">Apl.</span>
            } @else if (tieneMarcador(p)) {
              {{ p.golesLocal }}<span class="sep">-</span>{{ p.golesVisitante }}
            } @else {
              <span class="sin">vs</span>
            }
          </span>

          <span class="lado lado--der" [class.lado--gano]="p.resultado === 'visitante'">
            {{ p.visitante }}
          </span>
        </div>
      }
    </section>
  `,
    styles: [
        `
      .panel {
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 12px; padding: 16px 18px; margin-bottom: 14px;
      }
      .panel-head {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; margin-bottom: 10px;
      }
      h3 { font-size: 15px; font-weight: 600; margin: 0; }
      .restantes { font-size: 12px; color: var(--text-muted); }

      .encuentro {
        display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px;
        padding: 9px 8px; border-bottom: 1px solid var(--border); font-size: 13px;
        border-radius: var(--radius);
      }
      .encuentro:last-child { border-bottom: none; }
      .encuentro--mio { background: var(--accent-bg); }

      .lado { text-align: right; color: var(--text-secondary); min-width: 0; }
      .lado--der { text-align: left; }
      .lado--gano { color: var(--text-primary); font-weight: 700; }

      .marcador {
        font-size: 15px; font-weight: 700; min-width: 46px; text-align: center;
        color: var(--text-primary);
      }
      .marcador .sep { opacity: 0.4; margin: 0 1px; }
      .marcador .sin { font-size: 11px; font-weight: 500; color: var(--text-muted); }
      .marcador .apl { font-size: 11px; font-weight: 600; color: var(--warning-text); }
    `,
    ],
})
export class PartidosJornadaComponent {
    readonly jornada = input.required<Jornada>();
    /** Equipo elegido por quien mira, para resaltar su partido. */
    readonly miEquipo = input<string | null>(null);

    readonly jugados = computed(
        () =>
            this.jornada().partidos.filter((p) => !!p.resultado && p.resultado !== 'pospuesto').length,
    );

    tieneMarcador(p: PartidoJornada): boolean {
        return typeof p.golesLocal === 'number' && typeof p.golesVisitante === 'number';
    }

    esMio(p: PartidoJornada): boolean {
        const mio = this.miEquipo();
        return !!mio && (p.local === mio || p.visitante === mio);
    }
}