import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from './toast.service';

/**
 * Dibuja los toasts apilados abajo, centrados y por encima de la barra
 * de navegación. Color de fondo e ícono según el tipo. Se monta una
 * sola vez en la raíz de la app.
 */
@Component({
    selector: 'app-toasts',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div class="pila" aria-live="polite">
      @for (t of toast.toasts(); track t.id) {
        <button
          class="toast"
          [class.toast--exito]="t.tipo === 'exito'"
          [class.toast--error]="t.tipo === 'error'"
          (click)="toast.cerrar(t.id)"
        >
          <i
            class="ti"
            [class.ti-circle-check]="t.tipo === 'exito'"
            [class.ti-alert-triangle]="t.tipo === 'error'"
          ></i>
          <span>{{ t.texto }}</span>
        </button>
      }
    </div>
  `,
    styles: [
        `
      .pila {
        position: fixed;
        left: 0;
        right: 0;
        /* Por encima de la barra de navegación inferior. */
        bottom: calc(84px + env(safe-area-inset-bottom));
        z-index: 200;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 0 16px;
        pointer-events: none;
      }
      .toast {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        max-width: 460px;
        padding: 13px 15px;
        border-radius: var(--radius);
        border: 1px solid transparent;
        font-size: 14px;
        font-weight: 600;
        text-align: left;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
        animation: entrar 0.24s ease;
      }
      .toast i {
        flex-shrink: 0;
        font-size: 19px;
      }
      .toast span {
        flex: 1;
        line-height: 1.35;
      }
      .toast--exito {
        background: var(--success-bg);
        color: var(--success-text);
        border-color: var(--success-text);
      }
      .toast--error {
        background: var(--danger-bg);
        color: var(--danger-text);
        border-color: var(--danger-text);
      }
      @keyframes entrar {
        from {
          opacity: 0;
          transform: translateY(12px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .toast {
          animation: none;
        }
      }
    `,
    ],
})
export class ToastsComponent {
    readonly toast = inject(ToastService);
}