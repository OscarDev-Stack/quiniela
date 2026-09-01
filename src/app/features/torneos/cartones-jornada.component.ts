import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EscudoComponent } from '../../shared/escudo.component';
import { Jornada, PartidoJornada } from '../../core/models/competicion.model';
import { Quiniela } from '../../core/models/torneo.model';

const PUNTOS_EXACTO = 5;
const PUNTOS_RESULTADO = 3;

/**
 * Cartones de la jornada, en vista POR PARTIDO: una tarjeta por encuentro
 * (con escudos y nombre completo, sin abreviaturas ambiguas), su marcador
 * real, y debajo el pronóstico de cada jugador con el color de su acierto.
 * El color dice cuánto sumó, así cualquiera verifica los puntos.
 */
@Component({
  selector: 'app-cartones-jornada',
  standalone: true,
  imports: [CommonModule, EscudoComponent],
  template: `
    <section class="panel">
      <div class="panel-head">
        <h3>Cartones de la jornada {{ jornada().numero }}</h3>
      </div>

      <div class="leyenda">
        <span class="leyenda-item"><span class="muestra muestra--5"></span> Exacto · 5 pts</span>
        <span class="leyenda-item"><span class="muestra muestra--3"></span> Resultado · 3 pts</span>
        <span class="leyenda-item"><span class="muestra muestra--0"></span> Sin acierto</span>
      </div>

      <p class="ayuda">Ya cerró el plazo, así que todos los pronósticos quedan a la vista.</p>

      @if (cartones().length === 0) {
        <p class="vacio">Nadie envió pronósticos en esta jornada.</p>
      } @else {
        <!-- Totales de la jornada, arriba para no perder el ranking. -->
        <div class="totales">
          @for (c of cartones(); track c.id) {
            <span class="chip-total" [class.chip-total--yo]="c.uid === miUid()">
              {{ c.uid === miUid() ? 'Tú' : c.alias }}
              <strong>{{ puntosCarton(c) }}</strong>
            </span>
          }
        </div>

        <div class="partidos">
          @for (p of jornada().partidos; track $index) {
            <div class="match">
              <div class="match-head">
                <span class="lado">
                  <app-escudo [equipo]="p.local" [size]="22" />
                  <span class="eq">{{ p.local }}</span>
                </span>
                <span class="centro">
                  @if (p.resultado && p.resultado !== 'pospuesto') {
                    <span class="marcador">{{ p.golesLocal }} - {{ p.golesVisitante }}</span>
                  } @else if (p.resultado === 'pospuesto') {
                    <span class="estado apl">Aplazado</span>
                  } @else if (tieneVivo(p)) {
                    <span class="marcador marcador--vivo">{{ p.vivoLocal }} - {{ p.vivoVisitante }}</span>
                    @if (p.vivoMinuto) {
                      <span class="minuto-vivo"><span class="live-dot" aria-hidden="true"></span> {{ minutoTexto(p.vivoMinuto) }}</span>
                    }
                  } @else {
                    <span class="estado">vs</span>
                  }
                </span>
                <span class="lado lado--der">
                  <span class="eq">{{ p.visitante }}</span>
                  <app-escudo [equipo]="p.visitante" [size]="22" />
                </span>
              </div>

              <div class="picks">
                @for (c of cartones(); track c.id) {
                  <div class="pick" [class.pick--yo]="c.uid === miUid()">
                    <span class="pick-alias">{{ c.uid === miUid() ? 'Tú' : c.alias }}</span>
                    @if (c.marcadores[$index]; as m) {
                      <span class="pick-marca" [class]="'pick-marca--' + acierto(p, m)">
                        {{ m.local }}-{{ m.visitante }}
                      </span>
                    } @else {
                      <span class="pick-marca pick-marca--vacio">–</span>
                    }
                  </div>
                }
              </div>
            </div>
          }
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
      .panel-head { margin-bottom: 8px; }
      h3 { font-size: 15px; font-weight: 600; margin: 0; }

      .leyenda {
        display: flex; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 10px;
        font-size: 11px; color: var(--text-muted);
      }
      .leyenda-item { display: inline-flex; align-items: center; gap: 6px; }
      .muestra { width: 12px; height: 12px; border-radius: 4px; flex-shrink: 0; background: var(--surface-1); }
      .muestra--5 { background: var(--success-bg); border: 1px solid var(--success-text); }
      .muestra--3 { background: var(--accent-bg); border: 1px solid var(--accent-text); }
      .muestra--0 { background: var(--surface-1); border: 1px solid var(--border); opacity: 0.6; }
      .ayuda { font-size: 12px; color: var(--text-secondary); margin: 0 0 12px; }
      .vacio { font-size: 13px; color: var(--text-muted); margin: 8px 0; }

      /* Ranking compacto de totales de la jornada. */
      .totales { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
      .chip-total {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 12px; color: var(--text-secondary);
        background: var(--surface-1); border: 1px solid var(--border);
        border-radius: 999px; padding: 3px 10px;
      }
      .chip-total strong { color: var(--accent-text); font-variant-numeric: tabular-nums; }
      .chip-total--yo { border-color: var(--accent-text); color: var(--accent-text); }

      .partidos { display: flex; flex-direction: column; gap: 12px; }
      .match {
        border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
        background: var(--surface-1);
      }
      .match-head {
        display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
        gap: 8px; padding: 10px 12px; background: var(--surface-2);
        border-bottom: 1px solid var(--border);
      }
      .lado { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .lado--der { justify-content: flex-end; }
      .eq {
        font-size: 13px; font-weight: 600; color: var(--text-primary);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .centro { text-align: center; white-space: nowrap; display: flex; flex-direction: column; align-items: center; gap: 1px; }
      .marcador { font-size: 17px; font-weight: 800; color: var(--text-primary); font-variant-numeric: tabular-nums; }
      .marcador--vivo { color: #d63b3b; }
      .minuto-vivo {
        display: inline-flex; align-items: center; gap: 4px;
        font-size: 10px; font-weight: 700; color: #d63b3b;
      }
      .minuto-vivo .live-dot {
        width: 6px; height: 6px; border-radius: 50%; background: #d63b3b;
        box-shadow: 0 0 0 0 rgba(214, 59, 59, 0.6);
        animation: latido-carton 1.4s ease-out infinite;
      }
      @keyframes latido-carton {
        0% { box-shadow: 0 0 0 0 rgba(214, 59, 59, 0.6); }
        70% { box-shadow: 0 0 0 5px rgba(214, 59, 59, 0); }
        100% { box-shadow: 0 0 0 0 rgba(214, 59, 59, 0); }
      }
      @media (prefers-reduced-motion: reduce) { .minuto-vivo .live-dot { animation: none; } }
      .estado { font-size: 12px; color: var(--text-muted); }
      .estado.apl { color: var(--warning-text); }

      .picks { display: flex; flex-direction: column; }
      .pick {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 7px 12px; font-size: 13px;
      }
      .pick + .pick { border-top: 1px solid var(--border); }
      .pick--yo { background: color-mix(in srgb, var(--accent-fill) 8%, transparent); }
      .pick-alias {
        color: var(--text-secondary); min-width: 0;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .pick--yo .pick-alias { color: var(--accent-text); font-weight: 600; }
      .pick-marca {
        flex-shrink: 0; padding: 2px 9px; border-radius: 6px; font-weight: 600;
        background: var(--surface-2); color: var(--text-secondary);
        font-variant-numeric: tabular-nums;
      }
      .pick-marca--5 { background: var(--success-bg); color: var(--success-text); font-weight: 700; }
      .pick-marca--3 { background: var(--accent-bg); color: var(--accent-text); }
      .pick-marca--0 { opacity: 0.5; }
      .pick-marca--vacio { opacity: 0.3; }
    `,
  ],
})
export class CartonesJornadaComponent {
  readonly jornada = input.required<Jornada>();
  readonly quinielas = input.required<Quiniela[]>();
  readonly miUid = input<string | null>(null);

  /**
   * Puntos a mostrar de un cartón: el oficial si la jornada ya se resolvió,
   * o la previa (resultados parciales) mientras sigue en curso.
   */
  puntosCarton(c: Quiniela): number {
    return c.puntos ?? c.puntosPrevia ?? 0;
  }

  readonly cartones = computed(() =>
    [...this.quinielas()].sort((a, b) => {
      const pa = this.puntosCarton(a);
      const pb = this.puntosCarton(b);
      if (pa !== pb) return pb - pa;
      return a.alias.localeCompare(b.alias, 'es');
    }),
  );

  /** ¿El partido tiene marcador en vivo para mostrar? */
  tieneVivo(p: PartidoJornada): boolean {
    return typeof p.vivoLocal === 'number' && typeof p.vivoVisitante === 'number';
  }

  /** "63" → "63'"; los estados ("HT"…) se muestran tal cual. */
  minutoTexto(min: string): string {
    return /^\d+$/.test(min) ? `${min}'` : min;
  }

  /** Cuánto vale un pronóstico contra el resultado real. */
  acierto(partido: PartidoJornada, marcador: { local: number; visitante: number }): number {
    if (!partido.resultado || partido.resultado === 'pospuesto') return 0;

    if (
      typeof partido.golesLocal === 'number' &&
      typeof partido.golesVisitante === 'number' &&
      marcador.local === partido.golesLocal &&
      marcador.visitante === partido.golesVisitante
    ) {
      return PUNTOS_EXACTO;
    }

    const mio =
      marcador.local > marcador.visitante
        ? 'local'
        : marcador.local < marcador.visitante
          ? 'visitante'
          : 'empate';
    return mio === partido.resultado ? PUNTOS_RESULTADO : 0;
  }
}
