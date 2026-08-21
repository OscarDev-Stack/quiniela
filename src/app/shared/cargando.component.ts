import { Component, input } from '@angular/core';

/**
 * Indicador de carga a pantalla completa: un overlay con fondo opaco que
 * cubre toda la vista, con un balón latiendo al centro y un texto que
 * describe qué se está cargando ("Cargando partidos...", etc.).
 *
 * Cubre la pantalla mientras llegan los primeros datos, para que no se
 * vea el contenido a medio cargar.
 *
 * Uso: <app-cargando texto="Cargando partidos" />
 */
@Component({
  selector: 'app-cargando',
  standalone: true,
  template: `
    <div class="overlay" role="status" aria-live="polite">
      <div class="centro">
        <i class="ti ti-ball-football pelota"></i>
        <p>{{ texto() }}…</p>
      </div>
    </div>
  `,
  styles: [
    `
      .overlay {
        position: fixed;
        inset: 0;
        z-index: 300;
        display: flex;
        align-items: center;
        justify-content: center;
        /* Fondo opaco que atenúa lo que hay detrás. */
        background: var(--surface-0);
        background: color-mix(in srgb, var(--surface-0) 82%, transparent);
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
      }
      .centro {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
      }
      .pelota {
        font-size: 54px;
        color: var(--accent-fill, #3b82f6);
        animation: latir 1.1s ease-in-out infinite;
      }
      .centro p {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary, #fff);
      }
      @keyframes latir {
        0%,
        100% {
          transform: scale(1);
          opacity: 0.6;
        }
        50% {
          transform: scale(1.28);
          opacity: 1;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pelota {
          animation: none;
          opacity: 0.85;
        }
      }
    `,
  ],
})
export class CargandoComponent {
  /** Qué se está cargando. Se le agrega "…" automáticamente. */
  readonly texto = input('Cargando');
}