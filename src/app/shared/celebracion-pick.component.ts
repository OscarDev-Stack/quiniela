import { Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EscudoComponent } from './escudo.component';

/**
 * Animación breve al elegir equipo en survivor: el escudo aparece grande en el
 * centro de la pantalla, hace un "pop" (crece grande y se asienta) y se
 * desvanece. Da la sensación de que la elección "aterriza" en el hero-pick de
 * abajo, sin la fragilidad de animar entre dos componentes distintos.
 *
 * Uso:
 *   @if (celebrando(); as eq) {
 *     <app-celebracion-pick [equipo]="eq" (fin)="celebrando.set(null)" />
 *   }
 *
 * Respeta `prefers-reduced-motion`: si el usuario lo prefiere, no anima y se
 * cierra de inmediato.
 */
@Component({
  selector: 'app-celebracion-pick',
  standalone: true,
  imports: [CommonModule, EscudoComponent],
  template: `
    <div class="capa" (animationend)="alTerminar($event)">
      <div class="destello" aria-hidden="true"></div>
      <div class="escudo-pop">
        <app-escudo [equipo]="equipo()" [size]="160" />
      </div>
    </div>
  `,
  styles: [
    `
      .capa {
        position: fixed; inset: 0; z-index: 1000;
        display: flex; align-items: center; justify-content: center;
        pointer-events: none;
        background: radial-gradient(circle at center,
          color-mix(in srgb, var(--surface-1) 55%, transparent), transparent 65%);
        animation: capa-fade 1.25s ease forwards;
      }

      /* Destello radial detrás del escudo. */
      .destello {
        position: absolute; width: 260px; height: 260px; border-radius: 50%;
        background: radial-gradient(circle, var(--accent-bg), transparent 70%);
        animation: destello-pulso 1.25s ease forwards;
      }

      /* El escudo: crece grande de golpe y se asienta, luego se va hacia
         abajo desvaneciéndose (como aterrizando en el hero). */
      .escudo-pop {
        position: relative;
        filter: drop-shadow(0 12px 28px rgba(0, 0, 0, 0.45));
        animation: pop 1.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }

      @keyframes pop {
        0% { transform: scale(0.2); opacity: 0; }
        30% { transform: scale(1.35); opacity: 1; }
        55% { transform: scale(1); opacity: 1; }
        100% { transform: scale(0.55) translateY(40vh); opacity: 0; }
      }
      @keyframes destello-pulso {
        0% { transform: scale(0.4); opacity: 0; }
        30% { transform: scale(1.1); opacity: 1; }
        100% { transform: scale(1.3); opacity: 0; }
      }
      @keyframes capa-fade {
        0% { opacity: 0; }
        15% { opacity: 1; }
        80% { opacity: 1; }
        100% { opacity: 0; }
      }

      /* Accesibilidad: sin animación para quien lo prefiere. */
      @media (prefers-reduced-motion: reduce) {
        .capa, .destello, .escudo-pop { animation: none; opacity: 0; }
      }
    `,
  ],
})
export class CelebracionPickComponent {
  /** Nombre del equipo elegido, para mostrar su escudo. */
  readonly equipo = input.required<string>();

  /** Se emite cuando la animación termina, para que el padre la descarte. */
  readonly fin = output<void>();

  /** Evita emitir el fin más de una vez (varias animaciones terminan juntas). */
  private readonly terminado = signal(false);

  alTerminar(e: AnimationEvent): void {
    // Solo reaccionamos a la animación de la capa (la más larga), no a las
    // internas, para cerrar una sola vez cuando todo acaba.
    if (e.animationName.startsWith('capa-fade') && !this.terminado()) {
      this.terminado.set(true);
      this.fin.emit();
    }
  }
}
