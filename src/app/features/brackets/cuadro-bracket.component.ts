import { Component, computed, effect, input, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EscudoComponent } from '../../shared/escudo.component';
import {
  Bracket,
  EquipoBracket,
  Llave,
  PronosticoBracket,
  nombreRonda,
  rondasDe,
} from '../../core/models/bracket.model';
import { globalDeLlave } from '../../core/services/bracket-cuadro';

/**
 * Dibuja el cuadro de eliminatoria con dos vistas:
 *
 *  · "Cuadro" (por defecto): el árbol completo con todas las rondas lado a
 *    lado, conectores que unen cada par hacia la ronda siguiente y el
 *    campeón coronado al final. Es la vista con impacto: se lee de un
 *    vistazo cómo avanza cada rama del torneo. Con scroll horizontal en
 *    pantallas chicas.
 *
 *  · "Por ronda": los tabs de antes (Octavos · Cuartos · Semifinal · Final),
 *    útil cuando el cuadro es grande o en móvil.
 *
 * Cada equipo puede expandir un detalle: quién lo pronosticó (modo
 * pronóstico) o su dueño (modo dueños). Solo pinta lo que recibe; no toca
 * datos ni lógica de negocio.
 */
@Component({
  selector: 'app-cuadro-bracket',
  standalone: true,
  imports: [CommonModule, EscudoComponent],
  template: `
    <div class="cuadro">
      <!-- Selector de vista: Cuadro (árbol) / Por ronda -->
      <div class="vista-switch" role="tablist" aria-label="Vista del cuadro">
        <button
          class="vista-op"
          role="tab"
          [class.vista-op--activa]="vista() === 'arbol'"
          [attr.aria-selected]="vista() === 'arbol'"
          (click)="vista.set('arbol')"
        >
          <i class="ti ti-sitemap"></i> Cuadro
        </button>
        <button
          class="vista-op"
          role="tab"
          [class.vista-op--activa]="vista() === 'ronda'"
          [attr.aria-selected]="vista() === 'ronda'"
          (click)="vista.set('ronda')"
        >
          <i class="ti ti-layout-list"></i> Por ronda
        </button>
      </div>

      <!-- =================== VISTA ÁRBOL =================== -->
      @if (vista() === 'arbol') {
        <div class="arbol-scroll">
          <div class="arbol" [style.--rondas]="totalRondas()">
            @for (r of rondas(); track r) {
              <div class="columna" [class.columna--final]="esRondaFinal(r)">
                <div class="col-cabecera">
                  <span class="col-titulo">{{ nombreCorto(r) }}</span>
                </div>
                <div class="col-llaves">
                  @for (l of llavesDe(r); track l.id) {
                    <div
                      class="nodo"
                      [class.nodo--resuelta]="!!l.ganador"
                      [class.nodo--conector]="!esRondaFinal(r)"
                    >
                      <!-- Local -->
                      <div
                        class="fila"
                        [class.fila--gana]="esGanador(l, l.local?.nombre)"
                        [class.fila--acierto]="marcaMia(l, l.local?.nombre) === 'acierto'"
                        [class.fila--fallo]="marcaMia(l, l.local?.nombre) === 'fallo'"
                      >
                        @if (l.local) {
                          <span class="siembra">{{ l.local.siembra }}</span>
                          <app-escudo [equipo]="l.local.nombre" [size]="18" />
                          <span class="equipo">{{ l.local.nombre }}</span>
                          @if (elegiEste(l, l.local.nombre)) {
                            <span class="mi-pick" title="Tu pronóstico"><i class="ti ti-user-check"></i></span>
                          }
                          <span class="goles">{{ golLocal(l) }}</span>
                        } @else {
                          <span class="equipo por-definir">Por definir</span>
                        }
                      </div>
                      <!-- Visitante -->
                      <div
                        class="fila"
                        [class.fila--gana]="esGanador(l, l.visitante?.nombre)"
                        [class.fila--acierto]="marcaMia(l, l.visitante?.nombre) === 'acierto'"
                        [class.fila--fallo]="marcaMia(l, l.visitante?.nombre) === 'fallo'"
                      >
                        @if (l.visitante) {
                          <span class="siembra">{{ l.visitante.siembra }}</span>
                          <app-escudo [equipo]="l.visitante.nombre" [size]="18" />
                          <span class="equipo">{{ l.visitante.nombre }}</span>
                          @if (elegiEste(l, l.visitante.nombre)) {
                            <span class="mi-pick" title="Tu pronóstico"><i class="ti ti-user-check"></i></span>
                          }
                          <span class="goles">{{ golVisitante(l) }}</span>
                        } @else {
                          <span class="equipo por-definir">Por definir</span>
                        }
                      </div>
                    </div>
                  }
                </div>
              </div>
            }

            <!-- Columna del campeón: corona quien ganó la final -->
            <div class="columna columna--trofeo">
              <div class="col-cabecera">
                <span class="col-titulo">Campeón</span>
              </div>
              <div class="col-llaves">
                <div class="campeon" [class.campeon--listo]="!!campeon()">
                  <div class="corona"><i class="ti ti-trophy"></i></div>
                  @if (campeon(); as c) {
                    <app-escudo [equipo]="c.nombre" [size]="34" />
                    <span class="campeon-nombre">{{ c.nombre }}</span>
                  } @else {
                    <span class="campeon-nombre por-definir">Por definir</span>
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
        <p class="arbol-pista">
          <i class="ti ti-arrows-horizontal"></i>
          Desliza para ver todas las rondas
        </p>
      }

      <!-- =================== VISTA POR RONDA =================== -->
      @if (vista() === 'ronda') {
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
          <div class="ronda-cabecera">
            <span class="ronda-titulo">{{ nombre(r) }}</span>
            <span class="ronda-conteo">{{ llavesDe(r).length }} {{ llavesDe(r).length === 1 ? 'llave' : 'llaves' }}</span>
          </div>
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
                    @if (esGanador(l, l.local.nombre)) {
                      <span class="trofeo" title="Avanzó"><i class="ti ti-trophy"></i></span>
                    }
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

                <span class="vs">VS</span>

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
                    @if (esGanador(l, l.visitante.nombre)) {
                      <span class="trofeo" title="Avanzó"><i class="ti ti-trophy"></i></span>
                    }
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
      }
    </div>
  `,
  styles: [
    `
      .cuadro {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 4px 0 12px;
      }

      /* --- Selector de vista Cuadro / Por ronda --- */
      .vista-switch {
        display: inline-flex;
        gap: 4px;
        padding: 4px;
        border-radius: 999px;
        background: var(--surface-1);
        border: 1px solid var(--border);
        align-self: flex-start;
      }
      .vista-op {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        border-radius: 999px;
        border: none;
        background: transparent;
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
      }
      .vista-op i { font-size: 15px; }
      .vista-op:hover { color: var(--text-primary); }
      .vista-op--activa {
        background: linear-gradient(135deg,
          var(--accent-fill),
          color-mix(in srgb, var(--accent-fill) 68%, #7c4dff));
        color: #fff;
        box-shadow: 0 3px 12px -4px color-mix(in srgb, var(--accent-fill) 80%, transparent);
      }

      /* ============================================================
         VISTA ÁRBOL
         El cuadro se despliega en columnas (una por ronda) más la
         columna del campeón. Cada nodo dibuja conectores hacia la
         ronda siguiente con pseudo-elementos, dando forma de llaves.
         ============================================================ */
      .arbol-scroll {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        padding: 4px 2px 10px;
        scrollbar-width: thin;
      }
      .arbol {
        display: flex;
        gap: 0;
        min-width: min-content;
        align-items: stretch;
      }
      .columna {
        display: flex;
        flex-direction: column;
        min-width: 190px;
        flex-shrink: 0;
      }
      .col-cabecera {
        text-align: center;
        padding: 0 10px 12px;
      }
      .col-titulo {
        display: inline-block;
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: var(--text-muted);
        padding: 4px 12px;
        border-radius: 999px;
        background: var(--surface-1);
        border: 1px solid var(--border);
      }
      .columna--final .col-titulo,
      .columna--trofeo .col-titulo {
        color: #fff;
        background: linear-gradient(135deg,
          var(--accent-fill),
          color-mix(in srgb, var(--accent-fill) 60%, #7c4dff));
        border-color: transparent;
      }
      /* Las llaves se reparten a lo alto para alinearse con el árbol. */
      .col-llaves {
        display: flex;
        flex-direction: column;
        justify-content: space-around;
        flex: 1;
        gap: 0;
        padding: 0 10px;
      }

      .nodo {
        position: relative;
        margin: 8px 0;
        border-radius: 12px;
        overflow: visible;
        background: linear-gradient(180deg,
          color-mix(in srgb, var(--surface-2) 92%, var(--accent-fill)) 0%,
          var(--surface-2) 45%);
        border: 1px solid var(--border);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
        transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
        animation: entra-nodo 0.3s cubic-bezier(0.22, 1, 0.36, 1) both;
      }
      .nodo:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 24px -14px rgba(0, 0, 0, 0.55);
        z-index: 2;
      }
      .nodo--resuelta {
        border-color: color-mix(in srgb, var(--accent-fill) 45%, var(--border));
      }
      @keyframes entra-nodo {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* Conectores: una línea horizontal saliendo de cada nodo y una
         vertical que une el par de nodos hacia la ronda siguiente. */
      .nodo--conector::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 100%;
        width: 10px;
        height: 2px;
        background: var(--border-strong, var(--border));
      }
      .nodo--conector.nodo--resuelta::after {
        background: color-mix(in srgb, var(--accent-fill) 60%, var(--border));
      }

      .fila {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 9px 10px;
        font-size: 13px;
      }
      .fila + .fila { border-top: 1px solid var(--border); }
      .fila--gana {
        background: linear-gradient(90deg,
          color-mix(in srgb, var(--accent-fill) 16%, transparent),
          transparent 90%);
      }
      .fila--gana .equipo { font-weight: 800; color: var(--text-primary); }
      .nodo--resuelta .fila:not(.fila--gana) .equipo { opacity: 0.5; }
      .nodo--resuelta .fila:not(.fila--gana) .siembra { opacity: 0.5; }
      .fila--acierto { box-shadow: inset 3px 0 0 0 var(--success-text); }
      .fila--fallo { box-shadow: inset 3px 0 0 0 var(--danger-text); }

      /* Columna del campeón: card grande, coronado y con brillo. */
      .columna--trofeo { min-width: 170px; }
      .campeon {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 20px 16px 18px;
        margin: 8px 0;
        border-radius: 16px;
        text-align: center;
        background: var(--surface-2);
        border: 1px dashed var(--border);
        color: var(--text-muted);
      }
      .campeon--listo {
        background: linear-gradient(160deg,
          color-mix(in srgb, #f1c40f 18%, var(--surface-2)),
          var(--surface-2) 70%);
        border: 1px solid color-mix(in srgb, #f1c40f 55%, var(--border));
        box-shadow: 0 12px 30px -16px color-mix(in srgb, #f1c40f 80%, transparent);
        color: var(--text-primary);
        animation: brilla-campeon 0.4s ease both;
      }
      @keyframes brilla-campeon {
        from { opacity: 0; transform: scale(0.94); }
        to { opacity: 1; transform: scale(1); }
      }
      .corona {
        font-size: 26px;
        color: var(--text-muted);
        line-height: 1;
      }
      .campeon--listo .corona {
        color: #f1c40f;
        filter: drop-shadow(0 2px 6px color-mix(in srgb, #f1c40f 60%, transparent));
      }
      .campeon-nombre {
        font-size: 14px;
        font-weight: 800;
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .arbol-pista {
        display: flex;
        align-items: center;
        gap: 6px;
        justify-content: center;
        margin: 0;
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
      }
      @media (min-width: 900px) {
        .arbol-pista { display: none; }
      }

      /* ============================================================
         VISTA POR RONDA (tabs) — se conserva tal cual estaba.
         ============================================================ */
      .rondas-tabs {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        padding: 2px;
        scrollbar-width: none;
      }
      .rondas-tabs::-webkit-scrollbar { display: none; }
      .tab {
        flex-shrink: 0;
        padding: 8px 16px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--surface-1);
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
        cursor: pointer;
        transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease,
          color 0.15s ease, border-color 0.15s ease;
      }
      .tab:hover { color: var(--text-primary); border-color: var(--border-strong); }
      .tab--activa {
        background: linear-gradient(135deg,
          var(--accent-fill),
          color-mix(in srgb, var(--accent-fill) 70%, #7c4dff));
        color: #fff;
        border-color: transparent;
        box-shadow: 0 4px 14px -4px color-mix(in srgb, var(--accent-fill) 80%, transparent);
        transform: translateY(-1px);
      }

      .ronda-cabecera {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        margin: 2px 2px -4px;
      }
      .ronda-titulo {
        font-size: 15px;
        font-weight: 800;
        letter-spacing: 0.01em;
        color: var(--text-primary);
      }
      .ronda-conteo {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-muted);
      }

      .llaves {
        display: flex;
        flex-direction: column;
        gap: 14px;
        animation: entra-ronda 0.26s cubic-bezier(0.22, 1, 0.36, 1);
      }
      @keyframes entra-ronda {
        from { opacity: 0; transform: translateX(14px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .llaves, .nodo, .campeon--listo { animation: none; }
      }

      .llave {
        position: relative;
        background:
          linear-gradient(180deg,
            color-mix(in srgb, var(--surface-2) 92%, var(--accent-fill)) 0%,
            var(--surface-2) 42%);
        border: 1px solid var(--border);
        border-radius: 14px;
        overflow: hidden;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
        transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
      }
      .llave:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 24px -14px rgba(0, 0, 0, 0.5);
      }
      .llave--resuelta {
        border-color: color-mix(in srgb, var(--accent-fill) 45%, var(--border));
      }
      .llave--resuelta::before {
        content: '';
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 3px;
        background: linear-gradient(180deg, var(--accent-fill),
          color-mix(in srgb, var(--accent-fill) 60%, #7c4dff));
      }

      .lado {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 12px;
        font-size: 14px;
      }
      .lado--gana {
        background: linear-gradient(90deg,
          color-mix(in srgb, var(--accent-fill) 16%, transparent),
          transparent 85%);
      }
      .lado--gana .equipo {
        font-weight: 800;
        color: var(--text-primary);
      }
      .llave--resuelta .lado:not(.lado--gana) .equipo { opacity: 0.55; }
      .llave--resuelta .lado:not(.lado--gana) .siembra { opacity: 0.55; }

      .lado--acierto { box-shadow: inset 3px 0 0 0 var(--success-text); }
      .lado--fallo { box-shadow: inset 3px 0 0 0 var(--danger-text); }

      .mi-pick, .trofeo {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        font-size: 13px;
        color: var(--text-muted);
      }
      .trofeo { color: #f1c40f; }
      .lado--acierto .mi-pick { color: var(--success-text); }
      .lado--fallo .mi-pick { color: var(--danger-text); }

      .siembra {
        flex-shrink: 0;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 800;
        background: color-mix(in srgb, var(--accent-fill) 14%, var(--surface-1));
        color: var(--accent-text);
        border: 1px solid color-mix(in srgb, var(--accent-fill) 25%, transparent);
      }
      .lado--gana .siembra,
      .fila--gana .siembra {
        background: var(--accent-fill);
        color: #fff;
        border-color: transparent;
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
        min-width: 26px;
        height: 26px;
        padding: 0 7px;
        border-radius: 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        color: var(--text-primary);
        background: var(--surface-1);
      }
      .lado--gana .goles,
      .fila--gana .goles {
        background: color-mix(in srgb, var(--accent-fill) 22%, var(--surface-1));
        color: var(--accent-text);
      }

      .vs {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 12px;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.08em;
        color: var(--text-muted);
      }
      .vs::before, .vs::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--border);
      }

      .por {
        display: block;
        font-size: 10px;
        font-weight: 600;
        color: var(--warning-text);
        padding: 4px 12px 7px;
        background: color-mix(in srgb, var(--warning-text) 8%, transparent);
      }

      .detalle-btn {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 3px 9px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--surface-1);
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
        transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
      }
      .detalle-btn .chev { font-size: 12px; }
      .detalle-btn:hover {
        color: var(--accent-text);
        border-color: color-mix(in srgb, var(--accent-fill) 35%, var(--border));
      }

      .detalle {
        position: relative;
        z-index: 1;
        border-top: 1px dashed var(--border);
        background: color-mix(in srgb, var(--accent-fill) 5%, var(--surface-1));
        animation: entra-detalle 0.2s ease;
      }
      @keyframes entra-detalle {
        from { opacity: 0; max-height: 0; }
        to { opacity: 1; max-height: 80px; }
      }
      .detalle-fila {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        padding: 9px 12px;
        scrollbar-width: thin;
      }
      .chip-nom {
        flex-shrink: 0;
        padding: 4px 11px;
        border-radius: 999px;
        background: var(--surface-2);
        border: 1px solid var(--border);
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 600;
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

  /** Vista activa: 'arbol' (cuadro completo) o 'ronda' (tabs). */
  readonly vista = signal<'arbol' | 'ronda'>('arbol');

  readonly totalRondas = computed(() => rondasDe(this.bracket().config.equipos));
  readonly rondas = computed(() => Array.from({ length: this.totalRondas() }, (_, i) => i));

  /** Ronda que se está viendo en la vista por-ronda. Arranca en la última con ganador. */
  readonly rondaActiva = signal(0);

  /** El campeón: el ganador de la última ronda (la final), si ya se resolvió. */
  readonly campeon = computed<EquipoBracket | undefined>(() => {
    const ult = this.totalRondas() - 1;
    const final = this.bracket().llaves.find((l) => l.ronda === ult);
    return final?.ganador;
  });

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

  /** ¿Es la última ronda (la final)? Sus nodos no dibujan conector. */
  esRondaFinal(ronda: number): boolean {
    return ronda === this.totalRondas() - 1;
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
