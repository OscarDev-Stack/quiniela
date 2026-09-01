import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Jornada, PartidoJornada } from '../../core/models/competicion.model';
import { Quiniela } from '../../core/models/torneo.model';

const PUNTOS_EXACTO = 5;
const PUNTOS_RESULTADO = 3;

/**
 * Los pronósticos de todos, uno por fila y un partido por columna.
 * El color de cada celda dice cuánto sumó: así cualquiera puede
 * verificar los puntos sin creerle a nadie.
 */
@Component({
    selector: 'app-cartones-jornada',
    standalone: true,
    imports: [CommonModule],
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

      <div class="tablero">
        <table>
          <thead>
            <tr>
              <th class="col-jugador">Jugador</th>
              @for (p of jornada().partidos; track $index) {
                <th [title]="p.local + ' vs ' + p.visitante">
                  <span class="abrev">{{ abreviar(p.local) }}</span>
                  <span class="abrev abrev--vis">{{ abreviar(p.visitante) }}</span>
                  @if (p.resultado && p.resultado !== 'pospuesto') {
                    <span class="real">{{ p.golesLocal }}-{{ p.golesVisitante }}</span>
                  } @else if (p.resultado === 'pospuesto') {
                    <span class="real apl">Apl</span>
                  } @else {
                    <span class="real">–</span>
                  }
                </th>
              }
              <th class="col-total">Pts</th>
            </tr>
          </thead>

          <tbody>
            @for (c of cartones(); track c.id) {
              <tr [class.fila-yo]="c.uid === miUid()">
                <td class="col-jugador">{{ c.alias }}</td>
                @for (p of jornada().partidos; track $index) {
                  <td>
                    @if (c.marcadores[$index]; as m) {
                      <span class="celda" [class]="'celda--' + acierto(p, m)">
                        {{ m.local }}-{{ m.visitante }}
                      </span>
                    } @else {
                      <span class="celda celda--vacio">–</span>
                    }
                  </td>
                }
                <td class="col-total">{{ puntosCarton(c) }}</td>
              </tr>
            } @empty {
              <tr>
                <td class="col-jugador" [attr.colspan]="jornada().partidos.length + 2">
                  Nadie envió pronósticos en esta jornada.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
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
        gap: 8px; margin-bottom: 8px;
      }
      h3 { font-size: 15px; font-weight: 600; margin: 0; }
      .leyenda {
        display: flex; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 10px;
        font-size: 11px; color: var(--text-muted);
      }
      .leyenda-item { display: inline-flex; align-items: center; gap: 6px; }
      .muestra {
        width: 12px; height: 12px; border-radius: 4px; flex-shrink: 0;
        background: var(--surface-1);
      }
      .muestra--5 { background: var(--success-bg); border: 1px solid var(--success-text); }
      .muestra--3 { background: var(--accent-bg); border: 1px solid var(--accent-text); }
      .muestra--0 { background: var(--surface-1); border: 1px solid var(--border); opacity: 0.6; }
      .ayuda { font-size: 12px; color: var(--text-secondary); margin: 0 0 12px; }

      .tablero { overflow-x: auto; margin: 0 -4px; -webkit-overflow-scrolling: touch; }
      table { border-collapse: collapse; font-size: 12px; }
      th, td { padding: 6px 5px; text-align: center; white-space: nowrap; }
      thead th {
        font-weight: 500; color: var(--text-muted); font-size: 10px;
        border-bottom: 1px solid var(--border); vertical-align: bottom;
      }
      .abrev { display: block; line-height: 1.25; }
      .abrev--vis { color: var(--text-secondary); }
      .real {
        display: block; margin-top: 3px; font-weight: 700;
        font-size: 11px; color: var(--text-primary);
      }
      .real.apl { color: var(--warning-text); font-weight: 500; }

      .col-jugador {
        position: sticky; left: 0; z-index: 1; text-align: left;
        background: var(--surface-2); padding-right: 10px;
        font-weight: 600; max-width: 96px; overflow: hidden; text-overflow: ellipsis;
      }
      .col-total { font-weight: 700; color: var(--accent-text); }
      .fila-yo .col-jugador { color: var(--accent-text); }
      tbody tr { border-bottom: 1px solid var(--border); }
      tbody tr:last-child { border-bottom: none; }

      .celda {
        display: inline-block; padding: 3px 7px; border-radius: 6px;
        background: var(--surface-1); color: var(--text-secondary);
      }
      .celda--5 { background: var(--success-bg); color: var(--success-text); font-weight: 700; }
      .celda--3 { background: var(--accent-bg); color: var(--accent-text); font-weight: 600; }
      .celda--0 { opacity: 0.45; }
      .celda--vacio { opacity: 0.3; }
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

    /** Nombre corto para que quepa en el tablero. */
    abreviar(nombre: string): string {
        return nombre.length <= 4 ? nombre : nombre.slice(0, 4);
    }
}