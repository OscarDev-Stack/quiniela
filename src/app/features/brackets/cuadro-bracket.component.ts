import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EscudoComponent } from '../../shared/escudo.component';
import {
  Bracket,
  Llave,
  nombreRonda,
  rondasDe,
} from '../../core/models/bracket.model';
import { globalDeLlave } from '../../core/services/bracket-cuadro';

/**
 * Dibuja el cuadro de eliminatoria: una columna por ronda, las llaves
 * apiladas, y el marcador global de cada una cuando ya se capturó.
 * Solo pinta lo que recibe; no toca datos ni lógica.
 */
@Component({
  selector: 'app-cuadro-bracket',
  standalone: true,
  imports: [CommonModule, EscudoComponent],
  template: `
    <div class="cuadro" [style.--rondas]="totalRondas()">
      @for (r of rondas(); track r) {
        <div class="ronda">
          <div class="ronda-nombre">{{ nombre(r) }}</div>

          <div class="llaves">
            @for (l of llavesDe(r); track l.id) {
              <div class="llave" [class.llave--resuelta]="!!l.ganador">
                <div class="lado" [class.lado--gana]="esGanador(l, l.local?.nombre)">
                  @if (l.local) {
                    <span class="siembra">{{ l.local.siembra }}</span>
                    <app-escudo [equipo]="l.local.nombre" [size]="18" />
                    <span class="equipo">{{ l.local.nombre }}</span>
                  } @else {
                    <span class="equipo por-definir">Por definir</span>
                  }
                  <span class="goles">{{ golLocal(l) }}</span>
                </div>

                <div class="lado" [class.lado--gana]="esGanador(l, l.visitante?.nombre)">
                  @if (l.visitante) {
                    <span class="siembra">{{ l.visitante.siembra }}</span>
                    <app-escudo [equipo]="l.visitante.nombre" [size]="18" />
                    <span class="equipo">{{ l.visitante.nombre }}</span>
                  } @else {
                    <span class="equipo por-definir">Por definir</span>
                  }
                  <span class="goles">{{ golVisitante(l) }}</span>
                </div>

                @if (l.resueltoPor && l.resueltoPor !== 'global') {
                  <span class="por">
                    {{ l.resueltoPor === 'penales' ? 'Penales' : 'Mejor posicionado' }}
                  </span>
                }
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      /*
       * El cuadro se lee de izquierda a derecha, ronda por ronda.
       * En móvil se desplaza horizontal: cada columna mantiene su
       * ancho y las llaves se centran verticalmente respecto a la
       * ronda anterior, que es lo que da la forma de árbol.
       */
      .cuadro {
        display: flex;
        gap: 20px;
        overflow-x: auto;
        padding: 4px 2px 12px;
        -webkit-overflow-scrolling: touch;
      }

      .ronda {
        display: flex;
        flex-direction: column;
        min-width: 168px;
        flex: 1;
      }
      .ronda-nombre {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-muted);
        margin-bottom: 12px;
        text-align: center;
      }

      /* Las llaves se reparten el alto para alinearse con la ronda previa. */
      .llaves {
        display: flex;
        flex-direction: column;
        justify-content: space-around;
        flex: 1;
        gap: 12px;
      }

      .llave {
        position: relative;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: 10px;
        overflow: hidden;
      }
      .llave--resuelta {
        border-color: color-mix(in srgb, var(--accent-fill) 40%, var(--border));
      }

      .lado {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 9px 10px;
        font-size: 13px;
      }
      .lado + .lado {
        border-top: 1px solid var(--border);
      }
      .lado--gana {
        background: color-mix(in srgb, var(--accent-fill) 12%, transparent);
      }
      .lado--gana .equipo {
        font-weight: 700;
        color: var(--text-primary);
      }

      .siembra {
        flex-shrink: 0;
        width: 18px;
        height: 18px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 700;
        background: var(--surface-1);
        color: var(--text-muted);
      }
      .equipo {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--text-secondary);
      }
      .por-definir {
        color: var(--text-muted);
        font-style: italic;
      }
      .goles {
        flex-shrink: 0;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--text-primary);
      }

      .por {
        display: block;
        font-size: 10px;
        color: var(--warning-text);
        padding: 3px 10px 6px;
        background: color-mix(in srgb, var(--warning-text) 8%, transparent);
      }
    `,
  ],
})
export class CuadroBracketComponent {
  readonly bracket = input.required<Bracket>();

  readonly totalRondas = computed(() => rondasDe(this.bracket().config.equipos));
  readonly rondas = computed(() => Array.from({ length: this.totalRondas() }, (_, i) => i));

  nombre(ronda: number): string {
    return nombreRonda(ronda, this.totalRondas());
  }

  llavesDe(ronda: number): Llave[] {
    return this.bracket()
      .llaves.filter((l) => l.ronda === ronda)
      .sort((a, b) => a.posicion - b.posicion);
  }

  esGanador(l: Llave, nombre?: string): boolean {
    return !!nombre && l.ganador?.nombre === nombre;
  }

  golLocal(l: Llave): string {
    const g = globalDeLlave(l);
    return g ? String(g.local) : '';
  }

  golVisitante(l: Llave): string {
    const g = globalDeLlave(l);
    return g ? String(g.visitante) : '';
  }
}