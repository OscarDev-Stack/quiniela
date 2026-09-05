import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EscudoComponent } from '../../shared/escudo.component';
import { Jornada, PartidoJornada } from '../../core/models/competicion.model';

/**
 * Los enfrentamientos de la jornada, como referencia de "¿contra quién juega
 * cada equipo?" mientras eliges (survivor). Es informativo: no muestra ni
 * actualiza marcadores. Resalta el partido del equipo que ya elegiste.
 */
@Component({
  selector: 'app-partidos-jornada',
  standalone: true,
  imports: [CommonModule, EscudoComponent],
  template: `
    <section class="panel">
      <div class="panel-head">
        <h3>Enfrentamientos de la jornada</h3>
        <span class="restantes">Contra quién juega cada equipo</span>
      </div>

      @for (p of jornada().partidos; track p.local + '|' + p.visitante) {
        <div class="encuentro" [class.encuentro--mio]="esMio(p)">
          <span class="lado">
            <span class="nom">{{ p.local }}</span>
            <app-escudo [equipo]="p.local" [size]="22" />
          </span>

          <span class="marcador">
            @if (p.resultado === 'pospuesto') {
              <span class="apl">Apl.</span>
            } @else {
              <span class="sin">vs</span>
            }
          </span>

          <span class="lado lado--der">
            <app-escudo [equipo]="p.visitante" [size]="22" />
            <span class="nom">{{ p.visitante }}</span>
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

      .lado {
        display: flex; align-items: center; justify-content: flex-end; gap: 7px;
        color: var(--text-secondary); min-width: 0;
      }
      .lado--der { justify-content: flex-start; }
      .lado .nom { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .marcador {
        font-size: 15px; font-weight: 700; min-width: 46px; text-align: center;
        color: var(--text-primary);
      }
      .marcador .sin { font-size: 11px; font-weight: 500; color: var(--text-muted); }
      .marcador .apl { font-size: 11px; font-weight: 600; color: var(--warning-text); }
    `,
  ],
})
export class PartidosJornadaComponent {
  readonly jornada = input.required<Jornada>();
  /** Equipo elegido por quien mira, para resaltar su partido. */
  readonly miEquipo = input<string | null>(null);

  esMio(p: PartidoJornada): boolean {
    const mio = this.miEquipo();
    return !!mio && (p.local === mio || p.visitante === mio);
  }
}
