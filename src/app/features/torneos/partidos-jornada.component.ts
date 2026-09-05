import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EscudoComponent } from '../../shared/escudo.component';
import { Jornada, PartidoJornada } from '../../core/models/competicion.model';

/**
 * Los partidos de la jornada con su marcador.
 * Resalta aquel donde juega el equipo que eligió quien mira.
 */
@Component({
  selector: 'app-partidos-jornada',
  standalone: true,
  imports: [CommonModule, EscudoComponent],
  template: `
    <section class="panel">
      <div class="panel-head">
        <h3>Partidos de la jornada</h3>
        <span class="restantes">{{ jugados() }} de {{ jornada().partidos.length }} jugados</span>
      </div>

      @for (p of partidosOrdenados(); track p.local + '|' + p.visitante) {
        <div
          class="encuentro"
          [class.encuentro--mio]="esMio(p)"
          [class.encuentro--vivo]="enJuego(p)"
        >
          <span class="lado" [class.lado--gano]="p.resultado === 'local'">
            <span class="nom">{{ p.local }}</span>
            <app-escudo [equipo]="p.local" [size]="22" />
          </span>

          <span class="marcador">
            @if (p.resultado === 'pospuesto') {
              <span class="apl">Apl.</span>
            } @else if (enJuego(p)) {
              <span class="vivo-marca">{{ p.vivoLocal }}<span class="sep">-</span>{{ p.vivoVisitante }}</span>
              <span class="vivo-etq"><span class="live-dot" aria-hidden="true"></span> En juego</span>
            } @else if (tieneMarcador(p)) {
              {{ p.golesLocal }}<span class="sep">-</span>{{ p.golesVisitante }}
            } @else {
              <span class="sin">vs</span>
            }
          </span>

          <span class="lado lado--der" [class.lado--gano]="p.resultado === 'visitante'">
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

      /* En juego: marco resaltado para que salte a la vista. */
      .encuentro--vivo {
        border: 1px solid #d63b3b;
        background: color-mix(in srgb, #d63b3b 8%, transparent);
        margin-bottom: 6px;
      }
      .vivo-marca { color: #d63b3b; font-weight: 800; }
      .vivo-etq {
        display: flex; align-items: center; justify-content: center; gap: 4px;
        font-size: 10px; font-weight: 700; color: #d63b3b; margin-top: 1px;
      }
      .vivo-etq .live-dot {
        width: 6px; height: 6px; border-radius: 50%; background: #d63b3b;
        box-shadow: 0 0 0 0 rgba(214, 59, 59, 0.6);
        animation: latido-partido 1.4s ease-out infinite;
      }
      @keyframes latido-partido {
        0% { box-shadow: 0 0 0 0 rgba(214, 59, 59, 0.6); }
        70% { box-shadow: 0 0 0 5px rgba(214, 59, 59, 0); }
        100% { box-shadow: 0 0 0 0 rgba(214, 59, 59, 0); }
      }
      @media (prefers-reduced-motion: reduce) { .vivo-etq .live-dot { animation: none; } }

      .lado {
        display: flex; align-items: center; justify-content: flex-end; gap: 7px;
        color: var(--text-secondary); min-width: 0;
      }
      .lado--der { justify-content: flex-start; }
      .lado .nom { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

  /**
   * Partidos ordenados para dar contexto de un vistazo: primero los que están
   * EN JUEGO (marcador en vivo, sin resultado final), luego los ya jugados,
   * y al final los pendientes/aplazados. Conserva el orden original dentro de
   * cada grupo. No muta el arreglo de entrada.
   */
  readonly partidosOrdenados = computed(() => {
    const rango = (p: PartidoJornada): number => {
      if (this.enJuego(p)) return 0; // en juego, arriba
      if (!!p.resultado && p.resultado !== 'pospuesto') return 1; // jugado
      return 2; // pendiente o aplazado
    };
    return [...this.jornada().partidos]
      .map((p, i) => ({ p, i }))
      .sort((a, b) => rango(a.p) - rango(b.p) || a.i - b.i)
      .map((x) => x.p);
  });

  tieneMarcador(p: PartidoJornada): boolean {
    return typeof p.golesLocal === 'number' && typeof p.golesVisitante === 'number';
  }

  /**
   * ¿El partido está EN JUEGO ahora? Solo lo sabemos para partidos con marcador
   * en vivo (los de ligas con API): tiene vivoLocal/vivoVisitante y todavía no
   * un resultado final. Para partidos sin dato en vivo, no se puede afirmar, así
   * que caen en jugado/pendiente según su resultado.
   */
  enJuego(p: PartidoJornada): boolean {
    if (p.resultado && p.resultado !== 'pospuesto') return false; // ya tiene final
    return typeof p.vivoLocal === 'number' && typeof p.vivoVisitante === 'number';
  }

  esMio(p: PartidoJornada): boolean {
    const mio = this.miEquipo();
    return !!mio && (p.local === mio || p.visitante === mio);
  }
}