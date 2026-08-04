import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModoTorneo } from '../../core/models/torneo.model';

/**
 * Reglas del modo supervivencia. Se muestra antes de aceptar la
 * invitación y también dentro del torneo, para consultarlas después.
 */
@Component({
  selector: 'app-reglas-torneo',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (modo() === 'quiniela') {
      <ul class="reglas">
        <li>
          <span class="icono icono--ok"><i class="ti ti-target-arrow"></i></span>
          <div>
            <strong>Marcador exacto: 5 puntos</strong>
            <p>Si atinas los goles de ambos equipos, te llevas la puntuación completa.</p>
          </div>
        </li>
        <li>
          <span class="icono"><i class="ti ti-check"></i></span>
          <div>
            <strong>Solo el ganador: 3 puntos</strong>
            <p>Si fallas el marcador pero acertaste quién gana o que empatan, sumas igual.</p>
          </div>
        </li>
        <li>
          <span class="icono"><i class="ti ti-list-numbers"></i></span>
          <div>
            <strong>Pronosticas toda la jornada</strong>
            <p>Hay que capturar el marcador de todos los partidos antes de que cierre.</p>
          </div>
        </li>
        <li>
          <span class="icono icono--warn"><i class="ti ti-clock-exclamation"></i></span>
          <div>
            <strong>Si no envías, no sumas</strong>
            <p>No te elimina, pero esa jornada te quedas en ceros. El plazo cierra al iniciar el primer partido.</p>
          </div>
        </li>
        <li>
          <span class="icono"><i class="ti ti-calendar-off"></i></span>
          <div>
            <strong>Los partidos aplazados quedan fuera</strong>
            <p>
              No suman ni restan para nadie, aunque se jueguen después.
              La jornada se califica una sola vez.
            </p>
          </div>
        </li>
        <li>
          <span class="icono icono--gold"><i class="ti ti-trophy"></i></span>
          <div>
            <strong>Gana quien más puntos acumule</strong>
            @if (costo() > 0) {
              <p>La bolsa se la lleva el líder al terminar. Entrar cuesta {{ costo() }} puntos.</p>
            } @else {
              <p>Si hay empate, desempata quien haya acertado más marcadores exactos.</p>
            }
          </div>
        </li>
      </ul>
    } @else {
    <ul class="reglas">
      <li>
        <span class="icono icono--ok"><i class="ti ti-check"></i></span>
        <div>
          <strong>Si tu equipo gana, sigues</strong>
          <p>Cada jornada eliges un equipo. Si gana, avanzas intacto.</p>
        </div>
      </li>

      @if (vidas() > 0) {
        <li>
          <span class="icono icono--warn"><i class="ti ti-heart"></i></span>
          <div>
            <strong>Tienes {{ vidas() === 1 ? 'una vida' : vidas() + ' vidas' }}</strong>
            @if (vidaCubre() === 'tropiezo') {
              <p>Cada empate o derrota gasta una vida. Cuando se acaben, el siguiente tropiezo te elimina.</p>
            } @else {
              <p>El empate gasta una vida y sigues jugando. La derrota siempre elimina, tengas vidas o no.</p>
            }
          </div>
        </li>

        <li>
          <span class="icono icono--danger"><i class="ti ti-x"></i></span>
          <div>
            @if (vidaCubre() === 'tropiezo') {
              <strong>Sin vidas, quedas fuera</strong>
              <p>Una vez agotadas las vidas, cualquier empate o derrota te saca del torneo.</p>
            } @else {
              <strong>Si pierde, quedas eliminado</strong>
              <p>La derrota te saca de inmediato, aunque conserves tu vida.</p>
            }
          </div>
        </li>
      } @else {
        <li>
          <span class="icono icono--danger"><i class="ti ti-x"></i></span>
          <div>
            <strong>Sin margen: un tropiezo y fuera</strong>
            <p>No hay vidas. Empate o derrota te elimina de inmediato. Solo la victoria te mantiene.</p>
          </div>
        </li>
      }

      <li>
        <span class="icono"><i class="ti ti-repeat-off"></i></span>
        <div>
          <strong>No puedes repetir equipo</strong>
          <p>Cada equipo se usa una sola vez en todo el torneo. Elige con cabeza.</p>
        </div>
      </li>

      <li>
        <span class="icono"><i class="ti ti-clock-exclamation"></i></span>
        <div>
          <strong>Si no eliges, quedas fuera</strong>
          <p>No elegir cuenta como derrota. El plazo cierra al iniciar el primer partido.</p>
        </div>
      </li>

      <li>
        <span class="icono"><i class="ti ti-calendar-off"></i></span>
        <div>
          <strong>Si el partido se aplaza, tu elección espera</strong>
          <p>
            No avanzas ni sales: cuando se juegue, ahí se define tu suerte.
            Mientras tanto sigues eligiendo en las jornadas siguientes.
          </p>
        </div>
      </li>

      @if (permiteRevivir()) {
        <li>
          <span class="icono icono--gold"><i class="ti ti-heart-plus"></i></span>
          <div>
            <strong>Puedes revivir una vez</strong>
            <p>
              Si caes, puedes volver pagando una cuota — solo en la jornada
              siguiente, y regresas con las mismas vidas que tenías al caer.
            </p>
          </div>
        </li>
      }

      <li>
        <span class="icono icono--gold"><i class="ti ti-trophy"></i></span>
        <div>
          <strong>El último en pie gana</strong>
          @if (costo() > 0) {
            <p>La bolsa se reparte entre quienes sobrevivan. Entrar cuesta {{ costo() }} puntos.</p>
          } @else {
            <p>Si varios llegan juntos al final, comparten el triunfo.</p>
          }
        </div>
      </li>
    </ul>
    }
  `,
  styles: [
    `
      .reglas { list-style: none; margin: 0; padding: 0; text-align: left; }
      .reglas li { display: flex; gap: 12px; padding: 11px 0; }
      .reglas li + li { border-top: 1px solid var(--border); }
      .icono {
        width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center; font-size: 16px;
        background: var(--surface-1); color: var(--text-secondary);
      }
      .icono--ok { background: var(--success-bg); color: var(--success-text); }
      .icono--warn { background: var(--warning-bg); color: var(--warning-text); }
      .icono--danger { background: var(--danger-bg); color: var(--danger-text); }
      .icono--gold { background: var(--warning-bg); color: var(--warning-text); }
      strong { display: block; font-size: 14px; font-weight: 600; }
      p { font-size: 12px; color: var(--text-secondary); margin: 2px 0 0; line-height: 1.45; }
    `,
  ],
})
export class ReglasTorneoComponent {
  /** Costo de entrada, para mencionarlo en la última regla. */
  readonly costo = input<number>(0);
  /** Qué reglas mostrar. */
  readonly modo = input<ModoTorneo>('supervivencia');
  readonly vidas = input<number>(1);
  readonly vidaCubre = input<'empate' | 'tropiezo'>('empate');
  readonly permiteRevivir = input<boolean>(false);
}