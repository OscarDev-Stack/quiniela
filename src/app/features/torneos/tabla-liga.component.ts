import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EscudoComponent } from '../../shared/escudo.component';
import { Competicion, FilaTablaLiga } from '../../core/models/competicion.model';

/**
 * Tabla de posiciones oficial de la liga (cache de TheSportsDB, guardada en
 * la competición). Muestra la clasificación estándar, la racha reciente como
 * puntitos, y colorea la zona (Liguilla/Descenso) si la API la trae.
 *
 * Es solo lectura y no toca puntos ni torneos: es información para el jugador.
 * Si la competición no tiene tabla cacheada, no muestra nada.
 */
@Component({
  selector: 'app-tabla-liga',
  standalone: true,
  imports: [CommonModule, EscudoComponent],
  template: `
    @if (filas().length > 0) {
      <div class="tabla-liga">
        <div class="cabecera">
          <span class="titulo">Tabla de {{ competicion().nombre }}</span>
          @if (actualizada(); as fecha) {
            <span class="fresca">{{ fecha }}</span>
          }
        </div>

        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th class="c-pos">#</th>
                <th class="c-eq">Equipo</th>
                <th>PJ</th>
                <th>G</th>
                <th>E</th>
                <th>P</th>
                <th>DIF</th>
                <th class="c-pts">PTS</th>
                <th class="c-form">Racha</th>
              </tr>
            </thead>
            <tbody>
              @for (f of filas(); track f.equipo) {
                <tr>
                  <td class="c-pos">
                    <span class="pos" [class]="'pos--' + zonaClase(f.zona)">{{ f.posicion }}</span>
                  </td>
                  <td class="c-eq">
                    <span class="equipo">
                      <app-escudo [equipo]="f.equipo" [size]="20" />
                      <span class="eq-nom">{{ f.equipo }}</span>
                    </span>
                  </td>
                  <td>{{ f.jugados }}</td>
                  <td>{{ f.ganados }}</td>
                  <td>{{ f.empatados }}</td>
                  <td>{{ f.perdidos }}</td>
                  <td [class.dif-pos]="f.diferencia > 0" [class.dif-neg]="f.diferencia < 0">
                    {{ f.diferencia > 0 ? '+' : '' }}{{ f.diferencia }}
                  </td>
                  <td class="c-pts">{{ f.puntos }}</td>
                  <td class="c-form">
                    <span class="racha">
                      @for (r of ultimos(f.forma); track $index) {
                        <span class="punto" [class]="'punto--' + r"></span>
                      }
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (hayZonas()) {
          <div class="leyenda">
            <span class="leyenda-item"><span class="punto-z punto-z--playoff"></span> Liguilla</span>
            <span class="leyenda-item"><span class="punto-z punto-z--descenso"></span> Descenso</span>
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      .cabecera {
        display: flex; align-items: baseline; justify-content: space-between;
        gap: 8px; margin-bottom: 10px;
      }
      .titulo { font-size: 14px; font-weight: 600; color: var(--text-primary); }
      .fresca { font-size: 11px; color: var(--text-muted); white-space: nowrap; }

      .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 0 -4px; }
      table { border-collapse: collapse; width: 100%; font-size: 12px; }
      th, td { padding: 7px 6px; text-align: center; white-space: nowrap; }
      thead th {
        font-weight: 500; color: var(--text-muted); font-size: 10px;
        border-bottom: 1px solid var(--border);
      }
      tbody tr { border-bottom: 1px solid var(--border); }
      tbody tr:last-child { border-bottom: none; }

      .c-eq { text-align: left; }
      .c-pts { font-weight: 700; color: var(--text-primary); }
      .c-pos, .c-form { width: 1%; }

      .equipo { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
      .eq-nom {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        max-width: 130px; color: var(--text-primary);
      }

      .pos {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px; border-radius: 6px;
        font-size: 11px; font-weight: 700;
        background: var(--surface-1); color: var(--text-secondary);
      }
      /* Franja de zona: borde izquierdo de color según Liguilla/Descenso. */
      .pos--playoff { box-shadow: inset 3px 0 0 0 var(--success-text); }
      .pos--descenso { box-shadow: inset 3px 0 0 0 var(--danger-text); }

      .dif-pos { color: var(--success-text); }
      .dif-neg { color: var(--danger-text); }

      .racha { display: inline-flex; gap: 3px; }
      .punto { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--surface-1); }
      .punto--W { background: var(--success-text); }
      .punto--D { background: var(--text-muted); }
      .punto--L { background: var(--danger-text); }

      .leyenda {
        display: flex; gap: 16px; margin-top: 10px;
        font-size: 11px; color: var(--text-muted);
      }
      .leyenda-item { display: inline-flex; align-items: center; gap: 6px; }
      .punto-z { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
      .punto-z--playoff { background: var(--success-text); }
      .punto-z--descenso { background: var(--danger-text); }
    `,
  ],
})
export class TablaLigaComponent {
  readonly competicion = input.required<Competicion>();

  readonly filas = computed<FilaTablaLiga[]>(() =>
    [...(this.competicion().tabla ?? [])].sort((a, b) => a.posicion - b.posicion),
  );

  /** ¿Alguna fila trae zona? Para decidir si mostramos la leyenda. */
  readonly hayZonas = computed(() => this.filas().some((f) => this.zonaClase(f.zona) !== 'normal'));

  /** Fecha legible del último refresco, o null. */
  readonly actualizada = computed<string | null>(() => {
    const v = this.competicion().tablaActualizada as unknown;
    if (!v) return null;
    const o = v as { toDate?: () => Date; seconds?: number };
    const d =
      v instanceof Date
        ? v
        : typeof o.toDate === 'function'
          ? o.toDate()
          : typeof o.seconds === 'number'
            ? new Date(o.seconds * 1000)
            : null;
    if (!d || isNaN(d.getTime())) return null;
    return (
      'Actualizada ' +
      d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    );
  });

  /** Últimos resultados de la racha (máximo 5), como W/D/L en mayúscula. */
  ultimos(forma: string): string[] {
    if (!forma) return [];
    return forma
      .toUpperCase()
      .split('')
      .filter((c) => c === 'W' || c === 'D' || c === 'L')
      .slice(-5);
  }

  /** Clasifica la zona de la API en una clase de color. */
  zonaClase(zona: string): 'playoff' | 'descenso' | 'normal' {
    const z = (zona ?? '').toLowerCase();
    if (z.includes('playoff') || z.includes('liguilla') || z.includes('champion') || z.includes('promotion')) {
      return 'playoff';
    }
    if (z.includes('relegation') || z.includes('descenso')) return 'descenso';
    return 'normal';
  }
}
