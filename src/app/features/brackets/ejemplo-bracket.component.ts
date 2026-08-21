import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EscudoComponent } from '../../shared/escudo.component';

/**
 * Ejemplo concreto con el Clausura 2026 de la Liga MX: muestra el
 * cuadro real y cuánto habría ganado alguien que acertó a los
 * campeones. Aclara las reglas con un caso que la gente reconoce.
 *
 * Los puntos se calculan con la escala normal (10/20/40, campeón +30,
 * finalista +15) para ilustrar; el bracket real usa su propia escala.
 */
@Component({
  selector: 'app-ejemplo-bracket',
  standalone: true,
  imports: [CommonModule, EscudoComponent],
  template: `
    <div class="fondo" (click)="cerrar.emit()">
      <div class="hoja" (click)="$event.stopPropagation()">
        <div class="cab">
          <h2>Ejemplo: Clausura 2026</h2>
          <button class="x" (click)="cerrar.emit()" aria-label="Cerrar"><i class="ti ti-x"></i></button>
        </div>

        <p class="intro">
          Así se vería un cuadro completo. Imagina que antes de empezar
          pronosticaste a <strong>Cruz Azul</strong> como campeón. Esto es
          lo que habrías ganado, ronda por ronda.
        </p>

        <!-- Cuartos -->
        <div class="ronda">
          <span class="ronda-tit">Cuartos de final</span>
          <div class="llave"><app-escudo [equipo]="'Pumas'" [size]="18" /><span>Pumas</span><b>6</b><span class="vs">–</span><b>6</b><span>América</span><app-escudo [equipo]="'América'" [size]="18" /></div>
          <div class="nota">Pumas avanza (mejor posicionado)</div>
          <div class="llave"><app-escudo [equipo]="'Guadalajara'" [size]="18" /><span>Guadalajara</span><b>3</b><span class="vs">–</span><b>3</b><span>Tigres</span><app-escudo [equipo]="'Tigres'" [size]="18" /></div>
          <div class="nota">Guadalajara avanza (mejor posicionado)</div>
          <div class="llave llave--acierto"><app-escudo [equipo]="'Cruz Azul'" [size]="18" /><span>Cruz Azul</span><b>4</b><span class="vs">–</span><b>2</b><span>Atlas</span><app-escudo [equipo]="'Atlas'" [size]="18" /></div>
          <div class="nota nota--ok">Acertaste: Cruz Azul avanza · +10</div>
          <div class="llave"><app-escudo [equipo]="'Pachuca'" [size]="18" /><span>Pachuca</span><b>3</b><span class="vs">–</span><b>0</b><span>Toluca</span><app-escudo [equipo]="'Toluca'" [size]="18" /></div>
          <div class="nota">Pachuca avanza</div>
        </div>

        <!-- Semifinal -->
        <div class="ronda">
          <span class="ronda-tit">Semifinal</span>
          <div class="llave"><app-escudo [equipo]="'Pumas'" [size]="18" /><span>Pumas</span><b>1</b><span class="vs">–</span><b>1</b><span>Pachuca</span><app-escudo [equipo]="'Pachuca'" [size]="18" /></div>
          <div class="nota">Pumas avanza (mejor posicionado) — a la final</div>
          <div class="llave llave--acierto"><app-escudo [equipo]="'Guadalajara'" [size]="18" /><span>Guadalajara</span><b>3</b><span class="vs">–</span><b>4</b><span>Cruz Azul</span><app-escudo [equipo]="'Cruz Azul'" [size]="18" /></div>
          <div class="nota nota--ok">Acertaste: Cruz Azul a la final · +20 y +15 de finalista</div>
        </div>

        <!-- Final -->
        <div class="ronda">
          <span class="ronda-tit">Final</span>
          <div class="llave llave--acierto"><app-escudo [equipo]="'Pumas'" [size]="18" /><span>Pumas</span><b>1</b><span class="vs">–</span><b>2</b><span>Cruz Azul</span><app-escudo [equipo]="'Cruz Azul'" [size]="18" /></div>
          <div class="nota nota--ok">¡Acertaste al campeón! · +40 y +30 de campeón</div>
        </div>

        <!-- Total -->
        <div class="total">
          <div class="total-fila"><span>Cruz Azul pasa cuartos</span><b>+10</b></div>
          <div class="total-fila"><span>Cruz Azul a la final (avance +20, finalista +15)</span><b>+35</b></div>
          <div class="total-fila"><span>Cruz Azul campeón (final +40, campeón +30)</span><b>+70</b></div>
          <div class="total-fila total-fila--gordo"><span>Total ganado</span><b>+115</b></div>
        </div>

        <p class="pie">
          Los que también acertaron a Pumas como finalista sumarían sus puntos aparte.
          Quien no le atinó a Cruz Azul en cuartos, no gana nada de esa rama.
        </p>

        <button class="btn-ok" (click)="cerrar.emit()">Entendido</button>
      </div>
    </div>
  `,
  styles: [
    `
      .fondo {
        position: fixed; inset: 0; z-index: 110;
        background: rgba(0, 0, 0, 0.6);
        display: flex; align-items: flex-end; justify-content: center;
      }
      .hoja {
        width: 100%; max-width: 520px; max-height: 88vh; overflow-y: auto;
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 18px 18px 0 0;
        padding: 20px 18px calc(20px + env(safe-area-inset-bottom));
        animation: subir 0.25s ease;
      }
      @keyframes subir { from { transform: translateY(100%); } to { transform: translateY(0); } }
      @media (min-width: 560px) {
        .fondo { align-items: center; padding: 20px; }
        .hoja { border-radius: 18px; }
      }
      .cab { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .cab h2 { font-size: 18px; font-weight: 700; margin: 0; }
      .x {
        flex-shrink: 0; width: 32px; height: 32px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        background: var(--surface-1); border: none; cursor: pointer;
        color: var(--text-secondary); font-size: 18px;
      }
      .intro { font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin: 12px 0 18px; }
      .ronda { margin-bottom: 18px; }
      .ronda-tit {
        display: block; font-size: 11px; font-weight: 700; letter-spacing: 0.05em;
        text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px;
      }
      .llave {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px;
        font-size: 13px; color: var(--text-secondary);
      }
      .llave span:first-child { flex: 1; text-align: right; }
      .llave span:last-child { flex: 1; }
      .llave b { font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; }
      .llave .vs { flex: none; color: var(--text-muted); }
      .llave--acierto { border-color: var(--accent-fill); background: var(--accent-bg); }
      .nota { font-size: 11px; color: var(--text-muted); margin: 3px 0 8px 10px; }
      .nota--ok { color: var(--success-text); font-weight: 600; }
      .total {
        margin-top: 6px; padding: 12px; border-radius: var(--radius); background: var(--surface-1);
      }
      .total-fila {
        display: flex; justify-content: space-between; gap: 12px;
        font-size: 12px; color: var(--text-secondary); padding: 3px 0;
      }
      .total-fila b { color: var(--accent-text); font-variant-numeric: tabular-nums; }
      .total-fila--gordo {
        margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--border);
        font-size: 14px; font-weight: 700; color: var(--text-primary);
      }
      .total-fila--gordo b { font-size: 16px; }
      .pie { font-size: 11px; color: var(--text-muted); line-height: 1.5; margin: 14px 0 0; }
      .btn-ok {
        width: 100%; margin-top: 16px; padding: 13px; cursor: pointer;
        font-size: 15px; font-weight: 600; border: none; border-radius: var(--radius);
        background: var(--accent-fill); color: #fff;
      }
    `,
  ],
})
export class EjemploBracketComponent {
  readonly cerrar = output<void>();
}