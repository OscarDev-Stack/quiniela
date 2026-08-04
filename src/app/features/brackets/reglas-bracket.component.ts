import { Component, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Bracket, nombreRonda, rondasDe } from '../../core/models/bracket.model';
import { EjemploBracketComponent } from './ejemplo-bracket.component';

/**
 * Explica cómo se juega una eliminatoria, adaptándose a su
 * configuración: formato de rondas y final, desempate, y cómo
 * se forman los cruces. Es el equivalente a las reglas de torneo.
 */
@Component({
  selector: 'app-reglas-bracket',
  standalone: true,
  imports: [CommonModule, EjemploBracketComponent],
  template: `
    <div class="reglas">
      <h3 class="titulo"><i class="ti ti-book"></i> Cómo se juega</h3>

      <button class="ver-ejemplo" (click)="verEjemplo.set(true)">
        <i class="ti ti-eye"></i> Ver un ejemplo con el Clausura 2026
      </button>

      <ul>
        <li>
          <span class="icono icono--ok"><i class="ti ti-target"></i></span>
          <div>
            <strong>Llena el cuadro completo</strong>
            <p>
              Antes de que empiece, eliges quién avanza en cada llave hasta
              coronar a tu campeón. Se congela con un solo cierre.
            </p>
          </div>
        </li>

        <li>
          <span class="icono icono--gold"><i class="ti ti-stairs-up"></i></span>
          <div>
            <strong>Cuánto suma cada acierto</strong>

            <div class="puntos-grupo">
              <span class="puntos-tit">Por acertar quién avanza</span>
              @for (r of rondasConPuntos(); track r.nombre) {
                <div class="punto-fila">
                  <span>{{ r.nombre }}</span>
                  <span class="pts">+{{ r.puntos }}</span>
                </div>
              }
            </div>

            <div class="puntos-grupo">
              <span class="puntos-tit">Bonos que se suman aparte</span>
              <div class="punto-fila punto-fila--bono">
                <span>Cada finalista que aciertes</span>
                <span class="pts">+{{ b().puntaje.finalista }}</span>
              </div>
              <div class="punto-fila punto-fila--bono">
                <span>Acertar al campeón</span>
                <span class="pts">+{{ b().puntaje.campeon }}</span>
              </div>
            </div>

            <div class="puntos-grupo puntos-grupo--total">
              <span class="puntos-tit">Ejemplos: cómo se suman</span>
              <div class="ejemplo">
                <div class="ejemplo-desc">Aciertas al campeón</div>
                <div class="ejemplo-calc">
                  <span>Llega a la final +{{ puntoFinal() }}</span>
                  <span class="mas">+</span>
                  <span>bono campeón +{{ b().puntaje.campeon }}</span>
                  <span class="igual">=</span>
                  <span class="pts pts--gordo">{{ totalCampeon() }}</span>
                </div>
              </div>
              <div class="ejemplo">
                <div class="ejemplo-desc">Aciertas a un finalista</div>
                <div class="ejemplo-calc">
                  <span>Llega a semis +{{ puntoSemis() }}</span>
                  <span class="mas">+</span>
                  <span>bono finalista +{{ b().puntaje.finalista }}</span>
                  <span class="igual">=</span>
                  <span class="pts">{{ totalFinalista() }}</span>
                </div>
              </div>
              <div class="ejemplo">
                <div class="ejemplo-desc">Aciertas un {{ nombrePrimera() }}</div>
                <div class="ejemplo-calc">
                  <span>Solo el avance</span>
                  <span class="igual">=</span>
                  <span class="pts">{{ totalPrimera() }}</span>
                </div>
              </div>
            </div>
          </div>
        </li>

        <li>
          <span class="icono icono--info"><i class="ti ti-swords"></i></span>
          <div>
            <strong>{{ formatoTexto() }}</strong>
            <p>{{ finalTexto() }}</p>
          </div>
        </li>

        <li>
          <span class="icono icono--warn"><i class="ti ti-scale"></i></span>
          <div>
            <strong>Si empatan en el global</strong>
            <p>{{ desempateTexto() }}</p>
          </div>
        </li>

        <li>
          <span class="icono icono--info"><i class="ti ti-arrows-shuffle"></i></span>
          <div>
            <strong>{{ avanceTexto() }}</strong>
          </div>
        </li>

        @if (b().costoEntrada > 0) {
          <li>
            <span class="icono icono--gold"><i class="ti ti-coin"></i></span>
            <div>
              <strong>Entrar cuesta {{ b().costoEntrada }} pts</strong>
              <p>{{ repartoTexto() }}</p>
            </div>
          </li>
        }
      </ul>

      @if (verEjemplo()) {
        <app-ejemplo-bracket (cerrar)="verEjemplo.set(false)" />
      }
    </div>
  `,
  styles: [
    `
      .reglas { padding: 2px 0; }
      .titulo {
        display: flex; align-items: center; gap: 8px;
        font-size: 14px; font-weight: 600; margin: 0 0 12px;
      }
      .ver-ejemplo {
        display: flex; align-items: center; gap: 6px; width: 100%;
        padding: 10px 12px; margin-bottom: 14px; cursor: pointer;
        border: 1px solid var(--accent-fill); border-radius: var(--radius);
        background: var(--accent-bg); color: var(--accent-text);
        font-size: 13px; font-weight: 600;
      }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
      li { display: flex; gap: 11px; align-items: flex-start; }
      .icono {
        flex-shrink: 0; width: 30px; height: 30px; border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        background: var(--surface-1); color: var(--text-secondary); font-size: 16px;
      }
      .icono--gold { background: var(--warning-bg); color: var(--warning-text); }
      .icono--ok { background: var(--success-bg); color: var(--success-text); }
      .icono--warn { background: var(--warning-bg); color: var(--warning-text); }
      .icono--danger { background: var(--danger-bg); color: var(--danger-text); }
      .icono--info { background: var(--accent-bg); color: var(--accent-text); }
      strong { display: block; font-size: 13px; color: var(--text-primary); }
      p { margin: 3px 0 0; font-size: 12px; color: var(--text-secondary); line-height: 1.45; }
      .puntos-grupo { margin-top: 10px; display: grid; gap: 4px; }
      .puntos-tit {
        font-size: 11px; font-weight: 700; letter-spacing: 0.03em;
        text-transform: uppercase; color: var(--text-muted); margin-bottom: 2px;
      }
      .punto-fila {
        display: flex; justify-content: space-between; gap: 12px;
        font-size: 12px; color: var(--text-secondary);
      }
      .punto-fila--bono { color: var(--accent-text); }
      .puntos-grupo--total {
        margin-top: 12px; padding: 12px; border-radius: var(--radius);
        background: var(--surface-1);
      }
      .ejemplo { margin-top: 8px; }
      .ejemplo:first-of-type { margin-top: 4px; }
      .ejemplo-desc { font-size: 12px; font-weight: 600; color: var(--text-primary); margin-bottom: 2px; }
      .ejemplo-calc {
        display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
        font-size: 11px; color: var(--text-muted);
      }
      .ejemplo-calc .mas, .ejemplo-calc .igual { color: var(--text-muted); font-weight: 700; }
      .pts { font-weight: 700; font-variant-numeric: tabular-nums; flex-shrink: 0; color: var(--accent-text); }
      .pts--gordo { font-size: 14px; }
    `,
  ],
})
export class ReglasBracketComponent {
  readonly b = input.required<Bracket>();
  readonly verEjemplo = signal(false);

  /** Nombre de la primera ronda (cuartos, octavos…). */
  nombrePrimera(): string {
    return nombreRonda(0, rondasDe(this.b().config.equipos));
  }
  /** Puntos por acertar la llave de la final (el avance, sin el bono). */
  puntoFinal(): number {
    const total = rondasDe(this.b().config.equipos);
    return this.b().puntaje.avanzaPorRonda[total - 1] ?? 0;
  }
  /** Puntos por acertar una llave de semis (el avance, sin el bono). */
  puntoSemis(): number {
    const total = rondasDe(this.b().config.equipos);
    return this.b().puntaje.avanzaPorRonda[total - 2] ?? 0;
  }
  totalPrimera(): string {
    return `+${this.b().puntaje.avanzaPorRonda[0] ?? 0}`;
  }
  totalFinalista(): string {
    return `+${this.puntoSemis() + this.b().puntaje.finalista}`;
  }
  totalCampeon(): string {
    return `+${this.puntoFinal() + this.b().puntaje.campeon}`;
  }

  /** Cada ronda con su nombre y los puntos que da acertarla. */
  rondasConPuntos(): Array<{ nombre: string; puntos: number }> {
    const total = rondasDe(this.b().config.equipos);
    const escala = this.b().puntaje.avanzaPorRonda;
    const filas: Array<{ nombre: string; puntos: number }> = [];
    for (let r = 0; r < total; r++) {
      filas.push({ nombre: nombreRonda(r, total), puntos: escala[r] ?? 0 });
    }
    return filas;
  }

  private formato(f: 'ida-vuelta' | 'unico'): string {
    return f === 'ida-vuelta' ? 'ida y vuelta' : 'partido único';
  }

  formatoTexto(): string {
    const c = this.b().config;
    // Si rondas y final se juegan igual, una sola frase; si difieren, se distinguen.
    if (c.formatoRondas === c.formatoFinal) {
      return `Todo se juega a ${this.formato(c.formatoRondas)}`;
    }
    return `Rondas a ${this.formato(c.formatoRondas)}, final a ${this.formato(c.formatoFinal)}`;
  }

  finalTexto(): string {
    const c = this.b().config;
    if (c.formatoRondas === c.formatoFinal) {
      return c.formatoRondas === 'ida-vuelta'
        ? 'Cada llave se decide por el marcador global de los dos partidos.'
        : 'Cada llave se decide en un solo partido.';
    }
    return `Las rondas se deciden por el global; la final, en cambio, se juega a ${this.formato(c.formatoFinal)}.`;
  }

  desempateTexto(): string {
    const c = this.b().config;
    const r =
      c.desempateRondas === 'mejor-sembrado'
        ? 'avanza el mejor posicionado'
        : 'se define en penales';
    const f =
      c.desempateFinal === 'mejor-sembrado'
        ? 'gana el mejor posicionado'
        : 'se va a penales';
    return `En las rondas ${r}; en la final ${f}.`;
  }

  avanceTexto(): string {
    return this.b().config.avance === 'reordena'
      ? 'Cada ronda reordena: el mejor posicionado enfrenta al peor'
      : 'Los cruces quedan fijos desde el cuadro inicial';
  }

  repartoTexto(): string {
    const r = this.b().config.reparto ?? [100];
    if (r.length === 1) return 'La bolsa completa es para el campeón.';
    const partes = r.map((p, i) => `${i + 1}°: ${p}%`).join(' · ');
    return `La bolsa se reparte así: ${partes}.`;
  }
}