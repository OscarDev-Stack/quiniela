import { Component, computed, effect, input, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EscudoComponent } from '../../shared/escudo.component';
import {
  Bracket,
  Llave,
  PronosticoBracket,
  nombreRonda,
  rondasDe,
} from '../../core/models/bracket.model';
import { globalDeLlave } from '../../core/services/bracket-cuadro';

/**
 * Dibuja el cuadro de eliminatoria con navegación por ronda: unos tabs
 * arriba (Octavos, Cuartos, Semifinal, Final según el tamaño) y las llaves
 * de la ronda elegida a lo ancho, con transición al cambiar. Cada equipo
 * puede expandir un detalle: quién lo pronosticó (modo pronóstico) o su
 * dueño (modo dueños). Solo pinta lo que recibe; no toca datos ni lógica.
 */
@Component({
  selector: 'app-cuadro-bracket',
  standalone: true,
  imports: [CommonModule, EscudoComponent],
  template: `
    <div class="cuadro">
      <!-- Tabs de ronda: Octavos · Cuartos · Semifinal · Final -->
      <div class="rondas-tabs" role="tablist">
        @for (r of rondas(); track r) {
          <button
            class="tab"
            role="tab"
            [class.tab--activa]="rondaActiva() === r"
            [attr.aria-selected]="rondaActiva() === r"
            (click)="irARonda(r)"
          >
            {{ nombreCorto(r) }}
          </button>
        }
      </div>

      <!-- Una sola ronda a lo ancho. El track por ronda reinicia la animación. -->
      @for (r of [rondaActiva()]; track r) {
        <div class="llaves">
          @for (l of llavesDe(r); track l.id) {
            <div class="llave" [class.llave--resuelta]="!!l.ganador">
              <!-- Lado local -->
              <div
                class="lado"
                [class.lado--gana]="esGanador(l, l.local?.nombre)"
                [class.lado--acierto]="marcaMia(l, l.local?.nombre) === 'acierto'"
                [class.lado--fallo]="marcaMia(l, l.local?.nombre) === 'fallo'"
              >
                @if (l.local) {
                  <span class="siembra">{{ l.local.siembra }}</span>
                  <app-escudo [equipo]="l.local.nombre" [size]="18" />
                  <span class="equipo">{{ l.local.nombre }}</span>
                  @if (elegiEste(l, l.local.nombre)) {
                    <span class="mi-pick" title="Tu pronóstico"><i class="ti ti-user-check"></i></span>
                  }
                  @if (contarDetalle(l, l.local.nombre); as n) {
                    <button class="detalle-btn" (click)="alternarDetalle(l.id + '-L')" [attr.aria-expanded]="abierto(l.id + '-L')">
                      <i class="ti ti-users"></i> {{ n }}
                      <i class="ti chev" [class.ti-chevron-down]="!abierto(l.id + '-L')" [class.ti-chevron-up]="abierto(l.id + '-L')"></i>
                    </button>
                  }
                } @else {
                  <span class="equipo por-definir">Por definir</span>
                }
                <span class="goles">{{ golLocal(l) }}</span>
              </div>

              @if (abierto(l.id + '-L') && l.local) {
                <div class="detalle">
                  <div class="detalle-fila">
                    @for (nom of detalleDe(l, l.local.nombre); track nom) {
                      <span class="chip-nom">{{ nom }}</span>
                    }
                  </div>
                </div>
              }

              <!-- Lado visitante -->
              <div
                class="lado"
                [class.lado--gana]="esGanador(l, l.visitante?.nombre)"
                [class.lado--acierto]="marcaMia(l, l.visitante?.nombre) === 'acierto'"
                [class.lado--fallo]="marcaMia(l, l.visitante?.nombre) === 'fallo'"
              >
                @if (l.visitante) {
                  <span class="siembra">{{ l.visitante.siembra }}</span>
                  <app-escudo [equipo]="l.visitante.nombre" [size]="18" />
                  <span class="equipo">{{ l.visitante.nombre }}</span>
                  @if (elegiEste(l, l.visitante.nombre)) {
                    <span class="mi-pick" title="Tu pronóstico"><i class="ti ti-user-check"></i></span>
                  }
                  @if (contarDetalle(l, l.visitante.nombre); as n) {
                    <button class="detalle-btn" (click)="alternarDetalle(l.id + '-V')" [attr.aria-expanded]="abierto(l.id + '-V')">
                      <i class="ti ti-users"></i> {{ n }}
                      <i class="ti chev" [class.ti-chevron-down]="!abierto(l.id + '-V')" [class.ti-chevron-up]="abierto(l.id + '-V')"></i>
                    </button>
                  }
                } @else {
                  <span class="equipo por-definir">Por definir</span>
                }
                <span class="goles">{{ golVisitante(l) }}</span>
              </div>

              @if (abierto(l.id + '-V') && l.visitante) {
                <div class="detalle">
                  <div class="detalle-fila">
                    @for (nom of detalleDe(l, l.visitante.nombre); track nom) {
                      <span class="chip-nom">{{ nom }}</span>
                    }
                  </div>
                </div>
              }

              @if (l.resueltoPor && l.resueltoPor !== 'global') {
                <span class="por">
                  {{ l.resueltoPor === 'penales' ? 'Penales' : 'Mejor posicionado' }}
                </span>
              }
            </div>
          }
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
        flex-direction: column;
        gap: 14px;
        padding: 4px 0 12px;
      }

      /* Tabs de ronda: se desplazan solos si no caben. */
      .rondas-tabs {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        padding-bottom: 2px;
      }
      .tab {
        flex-shrink: 0;
        padding: 7px 14px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--surface-1);
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
      }
      .tab--activa {
        background: var(--accent-fill);
        color: #fff;
        border-color: var(--accent-fill);
      }

      /* Llaves de la ronda activa, apiladas. La animación entra al cambiar
         de ronda (el @for con track por ronda vuelve a montar el bloque). */
      .llaves {
        display: flex;
        flex-direction: column;
        gap: 12px;
        animation: entra-ronda 0.24s ease;
      }
      @keyframes entra-ronda {
        from { opacity: 0; transform: translateX(10px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .llaves { animation: none; }
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
      /*
       * Resaltado del pronóstico propio: verde si acerté (mi elegido fue
       * el ganador real de esa llave), rojo tenue si fallé. Un borde
       * izquierdo marca el lado sin pelear con el resaltado del ganador.
       */
      .lado--acierto {
        box-shadow: inset 3px 0 0 0 var(--success-text);
      }
      .lado--fallo {
        box-shadow: inset 3px 0 0 0 var(--danger-text);
      }
      .mi-pick {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        font-size: 12px;
        color: var(--text-muted);
      }
      .lado--acierto .mi-pick { color: var(--success-text); }
      .lado--fallo .mi-pick { color: var(--danger-text); }

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

      /* Indicador de detalle (nº de pronósticos / dueño) junto al equipo. */
      .detalle-btn {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px 7px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--surface-1);
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
      }
      .detalle-btn .chev { font-size: 12px; }
      .detalle-btn:hover { color: var(--text-secondary); }

      /* Panel colapsable: ancho fijo con scroll horizontal si hay muchos. */
      .detalle {
        border-top: 1px dashed var(--border);
        background: var(--surface-1);
        animation: entra-detalle 0.18s ease;
      }
      @keyframes entra-detalle {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .detalle-fila {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        padding: 8px 10px;
      }
      .chip-nom {
        flex-shrink: 0;
        padding: 3px 9px;
        border-radius: 999px;
        background: var(--surface-2);
        border: 1px solid var(--border);
        color: var(--text-secondary);
        font-size: 12px;
        white-space: nowrap;
      }
      @media (prefers-reduced-motion: reduce) {
        .detalle { animation: none; }
      }
    `,
  ],
})
export class CuadroBracketComponent {
  readonly bracket = input.required<Bracket>();
  /**
   * Elecciones del jugador (idLlave → nombre del equipo). Opcional: si se
   * pasa, el cuadro resalta en verde/rojo los aciertos y fallos del jugador.
   * Solo se marca en llaves que ya tienen ganador real.
   */
  readonly misAvances = input<Record<string, string> | null>(null);

  /**
   * Pronósticos de todos (solo llegan con el bracket en-curso/finalizado, por
   * la regla de Firestore). Alimentan el detalle "quién puso a este equipo a
   * avanzar". En modo dueños no se usan: ahí el detalle sale de bracket.duenos.
   */
  readonly pronosticos = input<PronosticoBracket[]>([]);

  readonly totalRondas = computed(() => rondasDe(this.bracket().config.equipos));
  readonly rondas = computed(() => Array.from({ length: this.totalRondas() }, (_, i) => i));

  /** Ronda que se está viendo. Arranca en la última con ganador (lo más nuevo). */
  readonly rondaActiva = signal(0);

  constructor() {
    // Coloca la ronda inicial en la más avanzada que ya tenga ganador, una
    // sola vez, cuando llega el cuadro. Después manda la elección del usuario.
    let ajustada = false;
    effect(() => {
      const llaves = this.bracket().llaves;
      if (ajustada || llaves.length === 0) return;
      ajustada = true;
      const conGanador = llaves.filter((l) => l.ganador).map((l) => l.ronda);
      untracked(() => this.rondaActiva.set(conGanador.length ? Math.max(...conGanador) : 0));
    });
  }

  irARonda(r: number): void {
    this.detallesAbiertos.set(new Set()); // al cambiar de ronda, cierra detalles
    this.rondaActiva.set(r);
  }

  nombre(ronda: number): string {
    return nombreRonda(ronda, this.totalRondas());
  }

  /** Nombre compacto para el tab (Cuartos, Semifinal, Final, Octavos…). */
  nombreCorto(ronda: number): string {
    return nombreRonda(ronda, this.totalRondas()).replace(' de final', '');
  }

  /* --- Detalle colapsable por lado de llave --- */
  private readonly detallesAbiertos = signal<Set<string>>(new Set());
  abierto(clave: string): boolean {
    return this.detallesAbiertos().has(clave);
  }
  alternarDetalle(clave: string): void {
    this.detallesAbiertos.update((s) => {
      const n = new Set(s);
      if (n.has(clave)) n.delete(clave);
      else n.add(clave);
      return n;
    });
  }

  /**
   * Nombres a mostrar en el detalle de un equipo:
   *  · modo dueños → el dueño de ese equipo (uno).
   *  · modo pronóstico → los usuarios que pusieron ese equipo a avanzar en
   *    la ronda de esta llave (mismo criterio por equipo+ronda que los puntos).
   */
  detalleDe(l: Llave, nombre?: string): string[] {
    if (!nombre) return [];
    const b = this.bracket();
    if (b.modo === 'duenos') {
      const d = (b.duenos ?? []).find((x) => x.equipo === nombre);
      return d ? [d.nombre] : [];
    }
    const rondaPorId = new Map(b.llaves.map((x) => [x.id, x.ronda]));
    return this.pronosticos()
      .filter((p) => {
        for (const [idLlave, equipo] of Object.entries(p.avances ?? {})) {
          if (equipo === nombre && rondaPorId.get(idLlave) === l.ronda) return true;
        }
        return false;
      })
      .map((p) => p.alias);
  }

  /** Cuántos hay en el detalle (0 = no mostramos el indicador). */
  contarDetalle(l: Llave, nombre?: string): number {
    return this.detalleDe(l, nombre).length;
  }

  llavesDe(ronda: number): Llave[] {
    return this.bracket()
      .llaves.filter((l) => l.ronda === ronda)
      .sort((a, b) => a.posicion - b.posicion);
  }

  esGanador(l: Llave, nombre?: string): boolean {
    return !!nombre && l.ganador?.nombre === nombre;
  }

  /**
   * Equipos que el jugador puso a avanzar en cada ronda, tomados de sus
   * elecciones. Se resuelve POR EQUIPO Y RONDA (no por posición de llave),
   * igual que la calificación de puntos: así el resaltado coincide con los
   * puntos y funciona también en la Final, aunque el reordenamiento del
   * cuadro real y el del pronóstico dejen a los equipos en llaves distintas.
   */
  private readonly misPorRonda = computed<Map<number, Set<string>>>(() => {
    const av = this.misAvances();
    const mapa = new Map<number, Set<string>>();
    if (!av) return mapa;
    // ronda de cada llave real, por id, para ubicar cada elección.
    const rondaPorId = new Map(this.bracket().llaves.map((l) => [l.id, l.ronda]));
    for (const [idLlave, equipo] of Object.entries(av)) {
      const ronda = rondaPorId.get(idLlave);
      if (ronda === undefined) continue;
      if (!mapa.has(ronda)) mapa.set(ronda, new Set());
      mapa.get(ronda)!.add(equipo);
    }
    return mapa;
  });

  /** ¿El jugador puso a este equipo a avanzar en la ronda de esta llave? */
  elegiEste(l: Llave, nombre?: string): boolean {
    return !!nombre && (this.misPorRonda().get(l.ronda)?.has(nombre) ?? false);
  }

  /**
   * Marca del pronóstico propio para un lado de la llave:
   *  · 'acierto' si lo elegí para avanzar y de verdad avanzó (fue el ganador),
   *  · 'fallo' si lo elegí para avanzar y NO avanzó (la llave ya resuelta),
   *  · null si no lo elegí o la llave aún no tiene ganador.
   */
  marcaMia(l: Llave, nombre?: string): 'acierto' | 'fallo' | null {
    if (!this.elegiEste(l, nombre) || !l.ganador) return null;
    return l.ganador.nombre === nombre ? 'acierto' : 'fallo';
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