import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EscudoComponent } from '../../shared/escudo.component';
import { Jornada, PartidoJornada, horaPartido } from '../../core/models/competicion.model';

/**
 * Los enfrentamientos de la jornada. Cumple dos papeles:
 *
 * 1. Referencia (quiniela en inscripción): muestra "¿quién juega contra quién?"
 *    sin interacción ni marcadores.
 * 2. Elección (survivor, jornada abierta): cada equipo del enfrentamiento es
 *    seleccionable. Se elige aquí mismo. Los equipos que ya no están
 *    disponibles (usados o comprometidos en otras jornadas) se ven apagados y
 *    no se pueden tocar. Los que descansan tampoco juegan, así que ni aparecen.
 *
 * En ambos modos el enfrentamiento se muestra en vertical: equipo local
 * arriba, "VS" en medio, equipo visitante abajo y la hora al final.
 */
@Component({
  selector: 'app-partidos-jornada',
  standalone: true,
  imports: [CommonModule, EscudoComponent],
  template: `
    <section class="panel">
      <div class="panel-head">
        <h3>Enfrentamientos de la jornada</h3>
        @if (interactivo()) {
          <span class="restantes">Toca al equipo que crees que gana</span>
        } @else {
          <span class="restantes">Contra quién juega cada equipo</span>
        }
      </div>

      @if (interactivo()) {
        <p class="leyenda">
          <span class="leyenda-item"><span class="punto punto--ok"></span> Puedes elegirlo</span>
          <span class="leyenda-item"><span class="punto punto--no"></span> Ya no disponible</span>
        </p>
      }

      @for (p of jornada().partidos; track p.local + '|' + p.visitante) {
        <div class="encuentro" [class.encuentro--mio]="esMio(p)">
          <div class="fila">
            <!-- LOCAL -->
            @if (interactivo()) {
              <button
                type="button"
                class="lado lado--btn"
                [class.lado--elegido]="p.local === seleccionado()"
                [class.lado--disp]="puedeElegir(p.local)"
                [class.lado--nodisp]="!disponible(p.local)"
                [disabled]="!puedeElegir(p.local) || guardando()"
                (click)="elegir.emit(p.local)"
              >
                <app-escudo [equipo]="p.local" [size]="22" />
                <span class="nom">{{ p.local }}</span>
                @if (p.local === seleccionado()) {
                  <i class="ti ti-circle-check-filled marca marca--check"></i>
                } @else if (!disponible(p.local)) {
                  <i class="ti ti-lock marca marca--lock"></i>
                }
              </button>
            } @else {
              <span class="lado">
                <app-escudo [equipo]="p.local" [size]="22" />
                <span class="nom">{{ p.local }}</span>
              </span>
            }

            <span class="vs">
              @if (p.resultado === 'pospuesto') {
                <span class="apl">Apl.</span>
              } @else {
                <span class="vs-txt">vs</span>
              }
            </span>

            <!-- VISITANTE -->
            @if (interactivo()) {
              <button
                type="button"
                class="lado lado--der lado--btn"
                [class.lado--elegido]="p.visitante === seleccionado()"
                [class.lado--disp]="puedeElegir(p.visitante)"
                [class.lado--nodisp]="!disponible(p.visitante)"
                [disabled]="!puedeElegir(p.visitante) || guardando()"
                (click)="elegir.emit(p.visitante)"
              >
                @if (p.visitante === seleccionado()) {
                  <i class="ti ti-circle-check-filled marca marca--check"></i>
                } @else if (!disponible(p.visitante)) {
                  <i class="ti ti-lock marca marca--lock"></i>
                }
                <span class="nom">{{ p.visitante }}</span>
                <app-escudo [equipo]="p.visitante" [size]="22" />
              </button>
            } @else {
              <span class="lado lado--der">
                <span class="nom">{{ p.visitante }}</span>
                <app-escudo [equipo]="p.visitante" [size]="22" />
              </span>
            }
          </div>

          @if (hora(p); as h) {
            <span class="hora"><i class="ti ti-clock"></i> {{ h }}</span>
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
      .panel-head {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; margin-bottom: 10px;
      }
      h3 { font-size: 15px; font-weight: 600; margin: 0; }
      .restantes { font-size: 12px; color: var(--text-muted); }

      /* Leyenda de disponibilidad (solo modo elección). */
      .leyenda {
        display: flex; flex-wrap: wrap; gap: 6px 16px;
        margin: 0 0 12px; font-size: 12px; color: var(--text-muted);
      }
      .leyenda-item { display: inline-flex; align-items: center; gap: 6px; }
      .punto { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
      .punto--ok { background: var(--accent); }
      .punto--no { background: var(--text-muted); opacity: 0.5; }

      /* Cada enfrentamiento: fila limpia con separador fino, sin tarjeta. */
      .encuentro {
        display: flex; flex-direction: column; gap: 2px;
        padding: 9px 4px; border-bottom: 1px solid var(--border);
        border-radius: 8px;
      }
      .encuentro:last-child { border-bottom: none; }
      .encuentro--mio {
        background: var(--accent-bg);
      }

      /* Fila principal: local · vs · visitante. */
      .fila {
        display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
        gap: 8px;
      }

      /* Lado del enfrentamiento: escudo + nombre en una línea. */
      .lado {
        display: flex; align-items: center; justify-content: flex-end; gap: 7px;
        color: var(--text-primary); min-width: 0; font-size: 13px; font-weight: 500;
      }
      .lado--der { justify-content: flex-start; }
      .lado .nom {
        min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      /* VS separador central compacto. */
      .vs { display: flex; align-items: center; justify-content: center; }
      .vs-txt { font-size: 11px; font-weight: 600; color: var(--text-muted); }
      .apl { font-size: 10px; font-weight: 700; color: var(--warning-text); }

      .hora {
        display: inline-flex; align-items: center; justify-content: center; gap: 4px;
        font-size: 11px; color: var(--text-muted); text-transform: capitalize;
      }

      /* Modo elección: cada lado es un botón compacto y tocable, sin marco
         por defecto para no llenar la vista de líneas. */
      .lado--btn {
        border: 1px solid transparent; background: transparent;
        font: inherit; cursor: pointer; padding: 6px 8px;
        border-radius: 9px; transition: background 0.12s, border-color 0.12s;
      }
      .lado--btn .nom { flex: 1; }

      /* Marca de estado (check o candado) al costado. */
      .marca { flex-shrink: 0; }
      .marca--check { font-size: 16px; color: var(--success, #22c55e); }
      .marca--lock { font-size: 13px; color: var(--text-muted); }

      /* Disponible: el marco solo aparece al pasar el cursor. */
      .lado--disp:hover:not(:disabled) {
        border-color: var(--accent); background: var(--accent-bg);
      }

      /* Equipo elegido esta jornada: sin marco propio (el fondo azul de toda la
         fila ya lo destaca). Solo la palomita verde y el texto en negrita. */
      .lado--elegido {
        color: var(--text-primary); font-weight: 700;
      }

      /* Equipo ya no disponible (usado o comprometido): apagado, sin marco.
         El candado y el atenuado bastan para marcarlo; no se tacha el nombre
         para que siga leyéndose bien. */
      .lado--nodisp {
        opacity: 0.5; cursor: default;
      }
      .lado--nodisp .nom {
        color: var(--text-muted);
      }
      .lado--btn:disabled { cursor: default; }
    `,
  ],
})
export class PartidosJornadaComponent {
  readonly jornada = input.required<Jornada>();
  /** Equipo elegido por quien mira, para resaltar su partido. */
  readonly miEquipo = input<string | null>(null);

  /**
   * Modo elección (survivor, jornada abierta). Cuando es true, cada equipo se
   * puede seleccionar tocándolo directamente en su enfrentamiento.
   */
  readonly interactivo = input<boolean>(false);
  /** Equipos que el jugador todavía puede elegir esta jornada. */
  readonly disponibles = input<string[]>([]);
  /** Equipo elegido por el jugador esta jornada (se resalta como activo). */
  readonly seleccionado = input<string | null>(null);
  /** Bloquea la interacción mientras se guarda una elección. */
  readonly guardando = input<boolean>(false);

  /** Se emite cuando el jugador toca un equipo elegible. */
  readonly elegir = output<string>();

  private readonly disponiblesSet = computed(() => new Set(this.disponibles()));

  esMio(p: PartidoJornada): boolean {
    const mio = this.miEquipo();
    return !!mio && (p.local === mio || p.visitante === mio);
  }

  /** ¿Este equipo sigue disponible para el jugador esta jornada? */
  disponible(equipo: string): boolean {
    return this.disponiblesSet().has(equipo) || equipo === this.seleccionado();
  }

  /** ¿Se puede tocar? Disponible y en modo interactivo. */
  puedeElegir(equipo: string): boolean {
    return this.interactivo() && this.disponible(equipo);
  }

  /** Hora de inicio legible del partido, o '' si no hay. */
  hora(p: PartidoJornada): string {
    return horaPartido(p.fechaInicio);
  }
}
