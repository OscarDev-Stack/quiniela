import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EscudoComponent } from '../../shared/escudo.component';
import { Jornada, PartidoJornada, horaPartido } from '../../core/models/competicion.model';
import { Pick } from '../../core/models/torneo.model';
import { minutoVivoTexto } from '../../core/models/partido.model';

/** Un partido con los participantes que eligieron a alguno de sus equipos. */
interface TarjetaPartido {
  partido: PartidoJornada;
  /** Índice original en la jornada, para desempatar el orden. */
  orden: number;
  vivo: boolean;
  /** Elecciones sobre este partido (local o visitante). */
  elecciones: Array<{ pick: Pick; lado: 'local' | 'visitante' }>;
}

/**
 * Tarjetas de juego del survivor, homologadas con las de la quiniela: una
 * tarjeta por partido con su marcador (final, en vivo o "vs"), y debajo la
 * lista de participantes que eligieron a alguno de esos dos equipos, con el
 * color de cómo les va (ganando / empate / perdiendo).
 *
 * Los partidos con marcador EN VIVO (traídos de la API) se muestran primero y
 * resaltados con los colores de la app, para que salten a la vista.
 */
@Component({
  selector: 'app-picks-jornada',
  standalone: true,
  imports: [CommonModule, EscudoComponent],
  template: `
    <section class="panel">
      <div class="panel-head">
        <h3>Tarjetas de la jornada {{ jornada().numero }}</h3>
      </div>

      <div class="leyenda">
        <span class="leyenda-item"><span class="muestra muestra--gana"></span> Va ganando</span>
        <span class="leyenda-item"><span class="muestra muestra--empate"></span> Empate</span>
        <span class="leyenda-item"><span class="muestra muestra--pierde"></span> Va perdiendo</span>
      </div>

      <p class="ayuda">Ya cerró el plazo, así que se ven las elecciones de todos.</p>

      <div class="partidos">
        @for (t of tarjetas(); track t.orden) {
          <div class="match" [class.match--vivo]="t.vivo">
            <div class="match-head" [class.match-head--vivo]="t.vivo">
              <span class="lado">
                <app-escudo [equipo]="t.partido.local" [size]="22" />
                <span class="eq">{{ t.partido.local }}</span>
              </span>
              <span class="centro">
                @if (t.partido.resultado && t.partido.resultado !== 'pospuesto') {
                  <span class="marcador">{{ t.partido.golesLocal }} - {{ t.partido.golesVisitante }}</span>
                } @else if (t.partido.resultado === 'pospuesto') {
                  <span class="estado apl">Aplazado</span>
                } @else if (t.vivo) {
                  <span class="marcador marcador--vivo">{{ t.partido.vivoLocal }} - {{ t.partido.vivoVisitante }}</span>
                  <span class="minuto-vivo">
                    <span class="live-dot" aria-hidden="true"></span>
                    {{ t.partido.vivoMinuto ? minutoTexto(t.partido.vivoMinuto) : 'En vivo' }}
                  </span>
                } @else {
                  <span class="estado">vs</span>
                }
              </span>
              <span class="lado lado--der">
                <span class="eq">{{ t.partido.visitante }}</span>
                <app-escudo [equipo]="t.partido.visitante" [size]="22" />
              </span>
            </div>

            @if (hora(t.partido); as h) {
              <div class="match-hora"><i class="ti ti-clock"></i> {{ h }}</div>
            }

            @if (t.elecciones.length > 0) {
              <div class="picks">
                @for (e of t.elecciones; track e.pick.id) {
                  <div class="pick" [class.pick--yo]="e.pick.uid === miUid()">
                    <span class="pick-alias">
                      {{ e.pick.uid === miUid() ? 'Tú' : e.pick.alias }}
                      <span class="pick-equipo">· {{ e.pick.equipo }}</span>
                    </span>
                    <span class="pick-estado" [class]="'pick-estado--' + comoVa(t.partido, e.lado)">
                      {{ etiquetaComoVa(t.partido, e.lado) }}
                    </span>
                  </div>
                }
              </div>
            } @else {
              <p class="sin-picks">Nadie eligió a estos equipos.</p>
            }
          </div>
        }
      </div>
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
      .muestra--gana { background: var(--success-bg); border: 1px solid var(--success-text); }
      .muestra--empate { background: var(--warning-bg); border: 1px solid var(--warning-text); }
      .muestra--pierde { background: var(--danger-bg); border: 1px solid var(--danger-text); }
      .ayuda { font-size: 12px; color: var(--text-secondary); margin: 0 0 12px; }

      .partidos { display: flex; flex-direction: column; gap: 12px; }
      .match {
        border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
        background: var(--surface-1);
      }
      /* Partido en vivo: resaltado con el acento de la app para que destaque. */
      .match--vivo {
        border-color: var(--accent-fill);
        box-shadow: 0 0 0 1px var(--accent-fill);
      }
      .match-head {
        display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
        gap: 8px; padding: 10px 12px; background: var(--surface-2);
        border-bottom: 1px solid var(--border);
      }
      .match-head--vivo { background: var(--accent-bg); }
      .match-hora {
        display: flex; align-items: center; justify-content: center; gap: 4px;
        padding: 5px 12px; background: var(--surface-2);
        border-bottom: 1px solid var(--border);
        font-size: 11px; color: var(--text-muted); text-transform: capitalize;
      }
      .lado { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .lado--der { justify-content: flex-end; }
      .eq {
        font-size: 13px; font-weight: 600; color: var(--text-primary);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .centro { text-align: center; white-space: nowrap; display: flex; flex-direction: column; align-items: center; gap: 1px; }
      .marcador { font-size: 17px; font-weight: 800; color: var(--text-primary); font-variant-numeric: tabular-nums; }
      .marcador--vivo { color: var(--accent-text); }
      .minuto-vivo {
        display: inline-flex; align-items: center; gap: 4px;
        font-size: 10px; font-weight: 700; color: var(--accent-text);
      }
      .minuto-vivo .live-dot {
        width: 6px; height: 6px; border-radius: 50%; background: var(--accent-text);
        box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-text) 60%, transparent);
        animation: latido-pick 1.4s ease-out infinite;
      }
      @keyframes latido-pick {
        0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent-text) 60%, transparent); }
        70% { box-shadow: 0 0 0 5px transparent; }
        100% { box-shadow: 0 0 0 0 transparent; }
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
      .pick-alias .pick-equipo { color: var(--text-muted); font-weight: 500; }
      .pick--yo .pick-alias { color: var(--accent-text); font-weight: 600; }
      .pick-estado {
        flex-shrink: 0; padding: 2px 9px; border-radius: 6px; font-weight: 600;
        background: var(--surface-2); color: var(--text-secondary); font-size: 12px;
      }
      .pick-estado--gana { background: var(--success-bg); color: var(--success-text); font-weight: 700; }
      .pick-estado--empate { background: var(--warning-bg); color: var(--warning-text); }
      .pick-estado--pierde { background: var(--danger-bg); color: var(--danger-text); }
      .pick-estado--sin { opacity: 0.6; }
      .sin-picks { font-size: 12px; color: var(--text-muted); margin: 8px 12px; }
    `,
  ],
})
export class PicksJornadaComponent {
  readonly jornada = input.required<Jornada>();
  readonly picks = input.required<Pick[]>();
  readonly miUid = input<string | null>(null);

  /** ¿El partido tiene marcador en vivo (de la API) para mostrar? */
  private esVivo(p: PartidoJornada): boolean {
    if (p.resultado && p.resultado !== 'pospuesto') return false; // ya tiene final
    return typeof p.vivoLocal === 'number' && typeof p.vivoVisitante === 'number';
  }

  /**
   * Una tarjeta por partido, con las elecciones que le corresponden. Los
   * partidos EN VIVO se ordenan primero para que destaquen; el resto conserva
   * el orden de la jornada.
   */
  readonly tarjetas = computed<TarjetaPartido[]>(() => {
    const picks = this.picks();
    return this.jornada()
      .partidos.map((partido, orden) => {
        const elecciones = picks
          .map((pick) => {
            if (pick.equipo === partido.local) return { pick, lado: 'local' as const };
            if (pick.equipo === partido.visitante) return { pick, lado: 'visitante' as const };
            return null;
          })
          .filter((e): e is { pick: Pick; lado: 'local' | 'visitante' } => e !== null)
          .sort((a, b) => a.pick.alias.localeCompare(b.pick.alias, 'es'));
        return { partido, orden, vivo: this.esVivo(partido), elecciones };
      })
      .sort((a, b) => Number(b.vivo) - Number(a.vivo) || a.orden - b.orden);
  });

  /** Texto del minuto/estado en vivo, traducido al español. */
  minutoTexto(min: string): string {
    return minutoVivoTexto(min);
  }

  /** Hora de inicio legible del partido, o '' si no hay. */
  hora(p: PartidoJornada): string {
    return horaPartido(p.fechaInicio);
  }

  /** ¿Cómo le va al equipo elegido? gana / empate / pierde / sin (sin dato). */
  comoVa(p: PartidoJornada, lado: 'local' | 'visitante'): 'gana' | 'empate' | 'pierde' | 'sin' {
    if (p.resultado === 'pospuesto') return 'sin';

    // Marcador a evaluar: el final si existe, si no el marcador en vivo.
    const tieneFinal = typeof p.golesLocal === 'number' && typeof p.golesVisitante === 'number';
    const local = tieneFinal ? p.golesLocal! : p.vivoLocal;
    const visitante = tieneFinal ? p.golesVisitante! : p.vivoVisitante;
    if (typeof local !== 'number' || typeof visitante !== 'number') return 'sin';

    if (local === visitante) return 'empate';
    const ganaLocal = local > visitante;
    const soyLocal = lado === 'local';
    return ganaLocal === soyLocal ? 'gana' : 'pierde';
  }

  etiquetaComoVa(p: PartidoJornada, lado: 'local' | 'visitante'): string {
    switch (this.comoVa(p, lado)) {
      case 'gana':
        return 'Va ganando';
      case 'empate':
        return 'Empate';
      case 'pierde':
        return 'Va perdiendo';
      default:
        return 'Sin marcador';
    }
  }
}
