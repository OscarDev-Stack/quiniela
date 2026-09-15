import {
  Component,
  DestroyRef,
  OnInit,
  inject,
  input,
  output,
} from '@angular/core';
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
 * El cierre se maneja con un temporizador de duración fija (no con
 * `animationend`, que en producción puede traer nombres de animación
 * minificados y no coincidir). Respeta `prefers-reduced-motion`.
 */
@Component({
  selector: 'app-celebracion-pick',
  standalone: true,
  imports: [CommonModule, EscudoComponent],
  template: `
    <div class="capa">
      <div class="destello" aria-hidden="true"></div>
      <div class="escudo-pop">
        <app-escudo [equipo]="equipo()" [size]="220" />
      </div>
    </div>
  `,
  styles: [
    `
      .capa {
        position: fixed; inset: 0; z-index: 1000;
        display: flex; align-items: center; justify-content: center;
        pointer-events: none;
        /* Fondo más oscuro: velo negro que atenúa la pantalla y resalta el
           escudo, con un tinte de acento hacia el centro. */
        background: radial-gradient(circle at center,
          color-mix(in srgb, var(--accent-bg) 45%, rgba(0, 0, 0, 0.72)),
          rgba(0, 0, 0, 0.72));
        animation: capa-fade 2s ease forwards;
      }

      /* Destello radial detrás del escudo. */
      .destello {
        position: absolute; width: 360px; height: 360px; border-radius: 50%;
        background: radial-gradient(circle, var(--accent-bg), transparent 70%);
        animation: destello-pulso 2s ease forwards;
      }

      /* El escudo: crece grande de golpe y se asienta, luego se va hacia
         abajo desvaneciéndose (como aterrizando en el hero). */
      .escudo-pop {
        position: relative;
        filter: drop-shadow(0 16px 36px rgba(0, 0, 0, 0.6));
        animation: pop 2s cubic-bezier(0.22, 1, 0.36, 1) forwards;
      }

      @keyframes pop {
        0% { transform: scale(0.2); opacity: 0; }
        28% { transform: scale(1.4); opacity: 1; }
        52% { transform: scale(1.05); opacity: 1; }
        70% { transform: scale(1.1); opacity: 1; }
        100% { transform: scale(0.6) translateY(42vh); opacity: 0; }
      }
      @keyframes destello-pulso {
        0% { transform: scale(0.4); opacity: 0; }
        28% { transform: scale(1.1); opacity: 1; }
        100% { transform: scale(1.35); opacity: 0; }
      }
      @keyframes capa-fade {
        0% { opacity: 0; }
        12% { opacity: 1; }
        82% { opacity: 1; }
        100% { opacity: 0; }
      }

      /* Accesibilidad: sin animación para quien lo prefiere. */
      @media (prefers-reduced-motion: reduce) {
        .capa, .destello, .escudo-pop { animation: none; opacity: 0; }
      }
    `,
  ],
})
export class CelebracionPickComponent implements OnInit {
  /** Nombre del equipo elegido, para mostrar su escudo. */
  readonly equipo = input.required<string>();

  /** Se emite cuando la animación termina, para que el padre la descarte. */
  readonly fin = output<void>();

  private readonly destroyRef = inject(DestroyRef);

  /** Duración total de la animación (debe coincidir con los keyframes). */
  private static readonly DURACION_MS = 2050;

  ngOnInit(): void {
    // Cierre por temporizador: robusto ante nombres de animación minificados
    // en producción. Se limpia si el componente se destruye antes.
    const t = setTimeout(() => this.fin.emit(), CelebracionPickComponent.DURACION_MS);
    this.destroyRef.onDestroy(() => clearTimeout(t));
  }
}
