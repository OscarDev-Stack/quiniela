import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmarService } from './confirmar.service';

@Component({
    selector: 'app-confirmar-dialog',
    standalone: true,
    imports: [CommonModule],
    template: `
    @if (confirmar.pendiente(); as p) {
      <div class="fondo" (click)="confirmar.responder(false)">
        <div
          class="caja"
          role="alertdialog"
          aria-modal="true"
          [attr.aria-label]="p.titulo"
          (click)="$event.stopPropagation()"
        >
          <div class="icono" [class.icono--peligro]="p.peligro">
            <i class="ti" [class.ti-alert-triangle]="p.peligro" [class.ti-help]="!p.peligro"></i>
          </div>

          <h2>{{ p.titulo }}</h2>
          <p>{{ p.mensaje }}</p>

          <div class="acciones">
            <button class="btn" (click)="confirmar.responder(false)">
              {{ p.cancelar }}
            </button>
            <button
              #aceptar
              class="btn btn--principal"
              [class.btn--peligro]="p.peligro"
              (click)="confirmar.responder(true)"
            >
              {{ p.aceptar }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
    styles: [
        `
      .fondo {
        position: fixed; inset: 0; z-index: 200;
        display: flex; align-items: center; justify-content: center;
        padding: calc(20px + env(safe-area-inset-top)) 20px calc(20px + env(safe-area-inset-bottom));
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(2px);
        animation: aparecer 0.15s ease-out;
      }
      .caja {
        width: 100%; max-width: 360px; text-align: center;
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 16px; padding: 24px 22px;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
        animation: subir 0.18s ease-out;
      }
      .icono {
        width: 48px; height: 48px; border-radius: 50%; margin: 0 auto 14px;
        display: flex; align-items: center; justify-content: center; font-size: 24px;
        background: var(--accent-bg); color: var(--accent-text);
      }
      .icono--peligro { background: var(--danger-bg); color: var(--danger-text); }

      h2 { font-size: 17px; font-weight: 600; margin: 0 0 8px; }
      p { font-size: 14px; color: var(--text-secondary); margin: 0 0 20px; line-height: 1.5; }

      .acciones { display: flex; gap: 10px; }
      .btn {
        flex: 1; padding: 12px; cursor: pointer; font-size: 15px;
        border: 1px solid var(--border-strong); border-radius: var(--radius);
        background: transparent; color: var(--text-primary);
      }
      .btn--principal {
        background: var(--accent-fill); color: #fff; border-color: transparent; font-weight: 600;
      }
      .btn--peligro { background: var(--danger-text); }

      @keyframes aparecer {
        from { opacity: 0; }
      }
      @keyframes subir {
        from { opacity: 0; transform: translateY(10px) scale(0.98); }
      }
      @media (prefers-reduced-motion: reduce) {
        .fondo, .caja { animation: none; }
      }
      @media (max-width: 380px) {
        .acciones { flex-direction: column-reverse; }
      }
    `,
    ],
})
export class ConfirmarDialogComponent {
    readonly confirmar = inject(ConfirmarService);
    private readonly aceptar = viewChild<ElementRef<HTMLButtonElement>>('aceptar');

    constructor() {
        // Al abrirse, el foco va al botón principal para poder responder con teclado.
        effect(() => {
            if (this.confirmar.pendiente()) {
                setTimeout(() => this.aceptar()?.nativeElement.focus(), 0);
            }
        });

        // Escape cancela, como en cualquier diálogo.
        const escape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') this.confirmar.responder(false);
        };
        document.addEventListener('keydown', escape);
    }
}