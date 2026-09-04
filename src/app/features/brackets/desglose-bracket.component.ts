import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EscudoComponent } from '../../shared/escudo.component';
import { Bracket, PronosticoBracket } from '../../core/models/bracket.model';
import { detalleDePronostico, ItemDesglose } from '../../core/services/bracket-cuadro';

/**
 * Explica de dónde salieron los puntos de un pronóstico de bracket:
 * un renglón por acierto (avance, campeón, finalista, marcador) y los
 * fallos en gris. Es puramente informativo y se calcula en el cliente
 * a partir del cuadro real ya jugado + las elecciones del jugador.
 */
@Component({
  selector: 'app-desglose-bracket',
  standalone: true,
  imports: [CommonModule, EscudoComponent],
  template: `
    @if (items().length > 0) {
      <div class="desglose">
        <div class="cabecera">
          <span class="titulo">Cómo sumaste tus puntos</span>
          <span class="total">{{ total() }} pts</span>
        </div>

        <ul class="lista">
          @for (it of items(); track $index) {
            <li class="item" [class.item--fallo]="it.tipo === 'fallo'">
              <span class="marca">
                @if (it.tipo === 'fallo') {
                  <i class="ti ti-x"></i>
                } @else {
                  <i class="ti ti-check"></i>
                }
              </span>
              <app-escudo [equipo]="it.equipo" [size]="18" />
              <span class="texto">
                <span class="equipo">{{ it.equipo }}</span>
                <span class="detalle">{{ etiqueta(it) }}</span>
              </span>
              <span class="pts" [class.pts--cero]="it.puntos === 0">
                {{ it.puntos > 0 ? '+' + it.puntos : '0' }}
              </span>
            </li>
          }
        </ul>
      </div>
    }
  `,
  styles: [
    `
      .desglose {
        border: 1px solid var(--border);
        border-radius: var(--radius);
        overflow: hidden;
      }
      .cabecera {
        display: flex; align-items: center; justify-content: space-between;
        padding: 11px 13px; background: var(--surface-1);
        border-bottom: 1px solid var(--border);
      }
      .titulo { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
      .total { font-size: 15px; font-weight: 800; color: var(--accent-text); }

      .lista { list-style: none; margin: 0; padding: 0; }
      .item {
        display: flex; align-items: center; gap: 9px;
        padding: 9px 13px; font-size: 13px;
      }
      .item + .item { border-top: 1px solid var(--border); }

      .marca {
        flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 700;
        background: var(--success-bg); color: var(--success-text);
      }
      .item--fallo .marca { background: var(--surface-1); color: var(--text-muted); }

      .texto { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .equipo {
        font-weight: 600; color: var(--text-primary);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .item--fallo .equipo { color: var(--text-muted); }
      .detalle { font-size: 11px; color: var(--text-muted); }

      .pts {
        flex-shrink: 0; font-weight: 700; font-variant-numeric: tabular-nums;
        color: var(--success-text);
      }
      .pts--cero { color: var(--text-muted); }
    `,
  ],
})
export class DesgloseBracketComponent {
  readonly bracket = input.required<Bracket>();
  readonly pronostico = input.required<PronosticoBracket | null>();

  private readonly detalle = computed(() => {
    const b = this.bracket();
    const p = this.pronostico();
    if (!p) return { total: 0, items: [] as ItemDesglose[], marcadoresAcertados: 0 };
    return detalleDePronostico(b.llaves, p.avances ?? {}, p.marcadores, b.puntaje);
  });

  readonly items = computed(() => this.detalle().items);
  readonly total = computed(() => this.detalle().total);

  /** Texto explicativo de cada renglón según su tipo. */
  etiqueta(it: ItemDesglose): string {
    switch (it.tipo) {
      case 'avance':
        return `Avanzó a ${it.nombreRonda.toLowerCase()}`;
      case 'campeon':
        return 'Campeón acertado';
      case 'finalista':
        return 'Finalista acertado';
      case 'marcador-exacto':
        return `Marcador global exacto (${it.nombreRonda.toLowerCase()})`;
      case 'marcador-resultado':
        return `Resultado global acertado (${it.nombreRonda.toLowerCase()})`;
      case 'fallo':
        // En la final, "fallar" significa que llegó pero no se coronó: el
        // texto correcto es "No fue campeón", no "No llegó a la final".
        return it.nombreRonda.toLowerCase() === 'final'
          ? 'No fue campeón'
          : `No llegó a ${it.nombreRonda.toLowerCase()}`;
      default:
        return '';
    }
  }
}
