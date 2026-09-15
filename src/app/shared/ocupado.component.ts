import { Component, inject } from '@angular/core';
import { OcupadoService } from './ocupado.service';

/**
 * Overlay bloqueante para ACCIONES en curso (guardar, abrir jornada, etc.).
 * Se monta una sola vez en la raíz de la app y aparece solo cuando el
 * OcupadoService tiene una acción activa. Cubre toda la pantalla e impide
 * tocar nada mientras la acción termina, con un spinner y el texto de la
 * acción ("Guardando pronósticos…").
 *
 * Se distingue a propósito del <app-cargando> (carga inicial de datos): aquí
 * la acción la disparó el usuario, así que mostramos un spinner sobre una
 * tarjeta en lugar del balón latiendo, y el z-index va por encima de los
 * toasts para que nunca queden solapados.
 */
@Component({
    selector: 'app-ocupado',
    standalone: true,
    template: `
    @if (ocupado.activo()) {
      <div
        class="capa"
        role="status"
        aria-live="assertive"
        aria-busy="true"
        (click)="ocupado.ocultar()"
      >
        <div class="tarjeta" (click)="$event.stopPropagation()">
          <span class="spinner" aria-hidden="true"></span>
          <p>{{ ocupado.texto() }}…</p>
        </div>
      </div>
    }
  `,
    styles: [
        `
      .capa {
        position: fixed;
        inset: 0;
        /* Por encima del overlay de carga (300) y de los toasts (200). */
        z-index: 400;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: color-mix(in srgb, var(--surface-0) 68%, transparent);
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
      }
      .tarjeta {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        padding: 26px 34px;
        border-radius: var(--radius);
        background: var(--surface-2, #1c1f26);
        border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.12));
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
      }
      .spinner {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 4px solid color-mix(in srgb, var(--accent-fill, #3b82f6) 25%, transparent);
        border-top-color: var(--accent-fill, #3b82f6);
        animation: girar 0.8s linear infinite;
      }
      .tarjeta p {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary, #fff);
        text-align: center;
      }
      @keyframes girar {
        to {
          transform: rotate(360deg);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .spinner {
          animation: girar 1.6s linear infinite;
        }
      }
    `,
    ],
})
export class OcupadoComponent {
    readonly ocupado = inject(OcupadoService);
}
