import { Component, computed, effect, input, output, signal } from '@angular/core';
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
 * En ambos modos el enfrentamiento se muestra en diagonal: equipo local
 * arriba a la izquierda, "vs" en el centro, equipo visitante abajo a la
 * derecha y la hora al final. Cada nombre ocupa su propia fila completa, así
 * que los nombres largos envuelven en varias líneas en vez de cortarse.
 */
@Component({
  selector: 'app-partidos-jornada',
  standalone: true,
  imports: [CommonModule, EscudoComponent],
  template: `
    <section class="panel">
      <!-- Encabezado tocable: pliega/despliega los enfrentamientos. -->
      <button
        type="button"
        class="panel-head panel-head--boton"
        (click)="alternar()"
        [attr.aria-expanded]="abierto()"
      >
        <div class="panel-head-txt">
          <h3>Enfrentamientos de la jornada</h3>
          @if (interactivo()) {
            <span class="restantes">Toca al equipo que crees que gana</span>
          } @else {
            <span class="restantes">Contra quién juega cada equipo</span>
          }
        </div>
        <i class="ti ti-chevron-down chevron" [class.chevron--abierto]="abierto()"></i>
      </button>

      @if (abierto()) {
        @if (interactivo()) {
          <p class="leyenda">
            <span class="leyenda-item"><span class="punto punto--ok"></span> Puedes elegirlo</span>
            <span class="leyenda-item"><span class="punto punto--no"></span> Ya no disponible</span>
          </p>
        }

        @for (p of jornada().partidos; track p.local + '|' + p.visitante) {
        <div
          class="encuentro"
          [class.encuentro--mio]="esMio(p)"
          [class.encuentro--elegido]="tieneEleccion(p)"
        >
          <!-- Cabecera de la tarjeta: fecha/hora como chip. -->
          @if (hora(p); as h) {
            <span class="hora-chip"><i class="ti ti-clock"></i> {{ h }}</span>
          }

          <!-- Enfrentamiento en diagonal: local arriba-izquierda, visitante
               abajo-derecha. De fondo, cada escudo grande y difuminado (local
               a la izquierda, visitante a la derecha) integrado en la tarjeta,
               con un "VS" al centro. Los nombres van encima. -->
          <div class="duelo">
            <!-- Escudos grandes de fondo, difuminados en la tarjeta. Crecen y
                 se aclaran según el estado (elegido / rival / hover). -->
            <span
              class="escudo-fondo escudo-fondo--izq"
              [class.escudo-fondo--activo]="p.local === seleccionado()"
              [class.escudo-fondo--rival]="esRival(p, p.local)"
              aria-hidden="true"
            >
              <app-escudo [equipo]="p.local" [size]="96" />
            </span>
            <span
              class="escudo-fondo escudo-fondo--der"
              [class.escudo-fondo--activo]="p.visitante === seleccionado()"
              [class.escudo-fondo--rival]="esRival(p, p.visitante)"
              aria-hidden="true"
            >
              <app-escudo [equipo]="p.visitante" [size]="96" />
            </span>

            <!-- Marca de agua "VS" al centro. -->
            <span class="vs-fondo" aria-hidden="true">
              @if (p.resultado === 'pospuesto') {
                APL
              } @else {
                VS
              }
            </span>

            <!-- LOCAL (fila superior, alineado a la izquierda) -->
            @if (interactivo()) {
              <button
                type="button"
                class="lado lado--btn"
                [class.lado--elegido]="p.local === seleccionado()"
                [class.lado--rival]="esRival(p, p.local)"
                [class.lado--disp]="puedeElegir(p.local)"
                [class.lado--nodisp]="!disponible(p.local)"
                [disabled]="!puedeElegir(p.local) || guardando()"
                (click)="elegir.emit(p.local)"
              >
                <span class="nom">{{ p.local }}</span>
                @if (p.local === seleccionado()) {
                  <i class="ti ti-circle-check-filled marca marca--check"></i>
                } @else if (!disponible(p.local)) {
                  <i class="ti ti-lock marca marca--lock"></i>
                }
              </button>
            } @else {
              <span class="lado">
                <span class="nom">{{ p.local }}</span>
              </span>
            }

            <!-- VISITANTE (fila inferior, alineado a la derecha) -->
            @if (interactivo()) {
              <button
                type="button"
                class="lado lado--der lado--btn"
                [class.lado--elegido]="p.visitante === seleccionado()"
                [class.lado--rival]="esRival(p, p.visitante)"
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
              </button>
            } @else {
              <span class="lado lado--der">
                <span class="nom">{{ p.visitante }}</span>
              </span>
            }
          </div>
        </div>
        }
      } @else if (interactivo() && partidoElegido(); as pe) {
        <!-- Colapsado con elección hecha: resumen del enfrentamiento (solo
             texto, sin escudos), con fecha y la invitación a expandir. -->
        <div class="resumen-colapsado">
          <span class="resumen-duelo">
            <span class="resumen-eq" [class.resumen-eq--mio]="pe.local === seleccionado()">{{ pe.local }}</span>
            <span class="resumen-vs">vs</span>
            <span class="resumen-eq" [class.resumen-eq--mio]="pe.visitante === seleccionado()">{{ pe.visitante }}</span>
          </span>
          @if (hora(pe); as h) {
            <span class="resumen-hora"><i class="ti ti-clock"></i> {{ h }}</span>
          }
          <span class="resumen-tocar">Toca para ver los enfrentamientos</span>
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
      /* Encabezado como botón: ocupa el ancho, sin marco, tocable. */
      .panel-head--boton {
        width: 100%; border: none; background: transparent; cursor: pointer;
        font: inherit; text-align: left; padding: 0; color: inherit;
      }
      .panel-head-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .chevron {
        flex-shrink: 0; font-size: 20px; color: var(--text-muted);
        transition: transform 0.18s ease;
      }
      .chevron--abierto { transform: rotate(180deg); }
      h3 { font-size: 15px; font-weight: 600; margin: 0; }
      .restantes { font-size: 12px; color: var(--text-muted); }

      /* Resumen visible cuando está colapsado y ya hay elección: solo texto,
         sin escudos. Muestra el enfrentamiento, la fecha y la invitación. */
      .resumen-colapsado {
        display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 0;
      }
      .resumen-duelo {
        display: inline-flex; align-items: center; gap: 8px;
        font-size: 14px; font-weight: 600; color: var(--text-primary);
      }
      .resumen-eq { min-width: 0; }
      /* Tu equipo elegido en el resumen, resaltado. */
      .resumen-eq--mio { color: var(--accent-text); font-weight: 800; }
      .resumen-vs { font-size: 11px; font-weight: 700; color: var(--text-muted); font-style: italic; }
      .resumen-hora {
        display: inline-flex; align-items: center; gap: 4px;
        font-size: 12px; color: var(--text-muted); text-transform: capitalize;
      }
      .resumen-hora .ti { font-size: 13px; }
      .resumen-tocar {
        flex-basis: 100%; font-size: 12px; color: var(--text-muted);
      }

      /* Leyenda de disponibilidad (solo modo elección). */
      .leyenda {
        display: flex; flex-wrap: wrap; gap: 6px 16px;
        margin: 0 0 12px; font-size: 12px; color: var(--text-muted);
      }
      .leyenda-item { display: inline-flex; align-items: center; gap: 6px; }
      .punto { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
      .punto--ok { background: var(--accent); }
      .punto--no { background: var(--text-muted); opacity: 0.5; }

      /* (A) Cada enfrentamiento es una tarjeta con profundidad: degradado
         sutil, borde y sombra suave. Una franja de acento arriba le da acento
         "deportivo". */
      .encuentro {
        position: relative;
        display: flex; flex-direction: column; gap: 6px;
        padding: 11px 14px 12px; margin-bottom: 10px;
        background: linear-gradient(160deg, var(--surface-1), var(--surface-2));
        border: 1px solid var(--border);
        border-radius: 13px; overflow: hidden;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
      }
      .encuentro:last-child { margin-bottom: 0; }
      /* Franja superior decorativa (acento tenue). */
      .encuentro::before {
        content: ''; position: absolute; inset: 0 0 auto 0; height: 3px;
        background: linear-gradient(90deg, var(--accent), transparent 70%);
        opacity: 0.5;
      }
      /* Mi partido (el equipo del jugador juega aquí): franja superior de
         acento a full, sin fondo teñido para no saturar. */
      .encuentro--mio::before { opacity: 1; }

      /* Partido donde el jugador hizo su elección: borde izquierdo azul grueso
         (como box-shadow interno para no alterar el padding) y un tinte azul de
         fondo, para que se sienta claramente "el elegido". */
      .encuentro--elegido {
        border-color: var(--accent);
        background: linear-gradient(160deg, var(--accent-bg), var(--surface-2) 70%);
        box-shadow: 0 2px 14px rgba(0, 0, 0, 0.22), inset 4px 0 0 0 var(--accent),
          0 0 0 1px var(--accent);
      }

      /* (A) Fecha/hora como renglón completo, centrado, con fondo de acento.
         Sangra a los bordes de la tarjeta para verse como una franja. */
      .hora-chip {
        display: flex; align-items: center; justify-content: center; gap: 6px;
        margin: -11px -14px 2px; padding: 6px 12px;
        background: linear-gradient(90deg,
          color-mix(in srgb, var(--accent) 24%, transparent),
          color-mix(in srgb, var(--accent) 38%, transparent),
          color-mix(in srgb, var(--accent) 24%, transparent));
        border-bottom: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
        font-size: 12px; font-weight: 700; color: var(--text-primary);
        text-transform: capitalize; letter-spacing: 0.3px;
      }
      .hora-chip .ti { font-size: 13px; color: var(--accent); }

      /* Enfrentamiento en diagonal por columnas: local en la mitad izquierda
         (arriba), visitante en la mitad derecha (abajo). Cada mitad es un
         botón, así el clic se reparte por lados y nunca invade al otro. */
      .duelo {
        position: relative;
        display: grid; grid-template-columns: 1fr 1fr; align-items: stretch;
        min-height: 92px; padding: 2px 0;
      }

      /* Escudos grandes de fondo: uno por lado, difuminados e integrados en la
         tarjeta como marca de agua. El local sangra por la izquierda; el
         visitante, por la derecha. Crecen y se aclaran según el estado. */
      .escudo-fondo {
        position: absolute; top: 50%; z-index: 0;
        display: flex; align-items: center; justify-content: center;
        opacity: 0.14; filter: grayscale(0.2);
        pointer-events: none; user-select: none;
        transform: translateY(-50%) scale(0.8);
        transition: opacity 0.18s ease, transform 0.18s ease, filter 0.18s ease;
      }
      .escudo-fondo--izq { left: -18px; transform-origin: left center; }
      .escudo-fondo--der { right: -18px; transform-origin: right center; }

      /* Elegido: su escudo se ve nítido y con presencia, sin difuminar. */
      .escudo-fondo--activo {
        opacity: 0.7; filter: blur(0) grayscale(0);
        transform: translateY(-50%) scale(1.3);
      }
      .escudo-fondo--izq.escudo-fondo--activo { transform: translateY(-50%) scale(1.3); }
      .escudo-fondo--der.escudo-fondo--activo { transform: translateY(-50%) scale(1.3); }
      /* Rival del elegido: su escudo se encoge y se apaga bastante. */
      .escudo-fondo--rival {
        opacity: 0.07; filter: blur(2.5px) grayscale(0.7);
        transform: translateY(-50%) scale(0.68);
      }

      /* (B) "VS" de fondo, discreto, centrado entre los dos equipos. */
      .vs-fondo {
        position: absolute; inset: 0; z-index: 1;
        display: flex; align-items: center; justify-content: center;
        font-size: 26px; font-weight: 900; font-style: italic;
        letter-spacing: 1px; line-height: 1;
        background: linear-gradient(180deg, var(--accent), var(--text-primary));
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent; color: transparent;
        opacity: 0.16;
        pointer-events: none; user-select: none;
      }

      /* Lado del enfrentamiento: ocupa su celda completa (toda su mitad),
         para tocarse en cualquier parte de ese lado. El contenido (nombre) se
         alinea a la esquina que da el escalonado diagonal. El nombre puede
         ocupar varias líneas sin cortarse. */
      .lado {
        position: relative; z-index: 2;
        display: flex; align-items: flex-start; justify-content: flex-start; gap: 8px;
        color: var(--text-primary); min-width: 0; font-size: 14px; font-weight: 700;
        grid-column: 1; height: 100%; text-align: left;
      }
      /* Visitante: mitad derecha, contenido alineado abajo-derecha. */
      .lado--der {
        grid-column: 2;
        align-items: flex-end; justify-content: flex-end; text-align: right;
      }
      /* Nombre: sin fondo, solo una sombra de texto marcada para que se lea
         nítido sobre el escudo de fondo. */
      .lado .nom {
        min-width: 0; overflow-wrap: anywhere; white-space: normal;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85), 0 0 2px rgba(0, 0, 0, 0.6);
      }

      /* Modo elección: cada lado es un botón tocable que cubre toda su franja,
         SIN marco ni fondo azul. El feedback visual lo da el escudo de fondo
         (crece en hover/selección). Alto generoso para tocar cómodo. */
      .lado--btn {
        border: none; background: transparent;
        font: inherit; cursor: pointer; padding: 8px 6px;
        border-radius: 10px; transition: color 0.14s ease, transform 0.1s ease;
        height: 100%;
        -webkit-tap-highlight-color: transparent; /* sin recuadro gris en móvil */
        -webkit-touch-callout: none; user-select: none;
        outline: none;
      }
      /* Feedback táctil en móvil (no hay hover): al presionar, el nombre se
         tiñe de acento y el lado se hunde un poco. */
      .lado--disp:not(.lado--elegido):active:not(:disabled) .nom { color: var(--accent); }
      .lado--disp:not(.lado--elegido):active:not(:disabled) { transform: scale(0.97); }

      /* Marca de estado (check o candado) al costado. */
      .marca { flex-shrink: 0; }
      .marca--check { font-size: 18px; color: var(--success, #22c55e); }
      .marca--lock { font-size: 14px; color: var(--text-muted); }

      /* Disponible + hover (solo si NO es el ya elegido): el nombre se tiñe de
         acento. El elegido no reacciona al hover. */
      .lado--disp:not(.lado--elegido):hover:not(:disabled) .nom { color: var(--accent); }

      /* Hover/tap sobre un lado disponible no elegido: crece el escudo de fondo
         de ese mismo lado, dando el efecto de "zoom" sin recuadros. Se incluye
         :active para tener feedback en móvil (donde no hay hover). */
      .duelo:has(.lado:not(.lado--der).lado--disp:not(.lado--elegido):hover:not(:disabled)) .escudo-fondo--izq:not(.escudo-fondo--activo),
      .duelo:has(.lado:not(.lado--der).lado--disp:not(.lado--elegido):active:not(:disabled)) .escudo-fondo--izq:not(.escudo-fondo--activo) {
        opacity: 0.34; filter: blur(0) grayscale(0.05);
        transform: translateY(-50%) scale(1.05);
      }
      .duelo:has(.lado--der.lado--disp:not(.lado--elegido):hover:not(:disabled)) .escudo-fondo--der:not(.escudo-fondo--activo),
      .duelo:has(.lado--der.lado--disp:not(.lado--elegido):active:not(:disabled)) .escudo-fondo--der:not(.escudo-fondo--activo) {
        opacity: 0.34; filter: blur(0) grayscale(0.05);
        transform: translateY(-50%) scale(1.05);
      }

      /* (C) Equipo elegido: SIN fondo ni banda azul. Se distingue por tamaño
         (más grande) y la palomita verde. */
      .lado--elegido {
        color: var(--text-primary); font-weight: 800; font-size: 16px;
      }
      .lado--elegido .nom { color: var(--text-primary); }

      /* Rival del elegido: más chico y atenuado, para que el elegido resalte
         por contraste. */
      .lado--rival {
        font-size: 12px; font-weight: 600; opacity: 0.8;
      }
      .lado--rival .nom {
        color: var(--text-muted); text-shadow: none;
      }

      /* Equipo ya no disponible (usado o comprometido): apagado. El candado y
         el atenuado bastan para marcarlo; no se tacha el nombre. */
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

  /**
   * Estado de plegado forzado por el usuario. null = automático (según haya
   * elección). Al tocar el encabezado, el usuario fija su preferencia.
   */
  private readonly abiertoManual = signal<boolean | null>(null);

  constructor() {
    // Cada vez que cambia la elección (elegir o cambiar de equipo), se vuelve
    // al comportamiento automático: con elección hecha, el panel se colapsa
    // solo, aunque antes lo hubieras abierto/cerrado a mano.
    effect(() => {
      this.seleccionado();
      this.abiertoManual.set(null);
    });
  }

  /**
   * ¿El panel está abierto? Si el usuario ya lo tocó, manda su elección. Si no,
   * arranca abierto salvo que ya haya una elección hecha (entonces colapsado).
   */
  readonly abierto = computed(() => {
    const manual = this.abiertoManual();
    if (manual !== null) return manual;
    return !this.seleccionado();
  });

  /** Pliega o despliega el panel de enfrentamientos. */
  alternar(): void {
    this.abiertoManual.set(!this.abierto());
  }

  esMio(p: PartidoJornada): boolean {
    const mio = this.miEquipo();
    return !!mio && (p.local === mio || p.visitante === mio);
  }

  /**
   * ¿Este equipo es el rival del elegido en este mismo partido? Es decir, hay
   * una elección hecha en este enfrentamiento y no es este equipo. Sirve para
   * atenuar y achicar al no elegido.
   */
  esRival(p: PartidoJornada, equipo: string): boolean {
    const sel = this.seleccionado();
    return !!sel && (p.local === sel || p.visitante === sel) && equipo !== sel;
  }

  /** ¿Este partido es donde el jugador hizo su elección de la jornada? */
  tieneEleccion(p: PartidoJornada): boolean {
    const sel = this.seleccionado();
    return !!sel && (p.local === sel || p.visitante === sel);
  }

  /** El partido donde el jugador hizo su elección (para el resumen colapsado). */
  readonly partidoElegido = computed<PartidoJornada | null>(() => {
    const sel = this.seleccionado();
    if (!sel) return null;
    return this.jornada().partidos.find((p) => p.local === sel || p.visitante === sel) ?? null;
  });

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
