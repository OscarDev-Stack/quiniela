import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from './toast.service';
import QRCode from 'qrcode';

/**
 * Bloque para compartir por código: muestra el código grande y tres botones de
 * icono del mismo tamaño: copiar el código, copiar el enlace completo y ver el
 * QR de la URL de invitación. El QR se genera en el propio dispositivo (librería
 * local), sin mandar el código a terceros.
 *
 * Inputs:
 *  - codigo: el código de invitación (lo que se copia).
 *  - url: la URL completa a la que lleva el QR al escanearlo.
 *  - etiqueta: título del bloque (por defecto "Código de invitación").
 */
@Component({
  selector: 'app-codigo-invitar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="invitar">
      <div class="etq">{{ etiqueta() }}</div>
      <div class="codigo">{{ codigo() }}</div>

      <div class="acciones">
        <button
          class="ico ico--primary"
          (click)="copiar()"
          [attr.title]="copiado() ? '¡Código copiado!' : 'Copiar código'"
          [attr.aria-label]="copiado() ? '¡Código copiado!' : 'Copiar código'"
        >
          <i class="ti" [class.ti-copy]="!copiado()" [class.ti-check]="copiado()"></i>
        </button>
        @if (soportaQr()) {
          <button
            class="ico"
            (click)="copiarEnlace()"
            [attr.title]="enlaceCopiado() ? '¡Enlace copiado!' : 'Copiar enlace'"
            [attr.aria-label]="enlaceCopiado() ? '¡Enlace copiado!' : 'Copiar enlace'"
          >
            <i class="ti" [class.ti-link]="!enlaceCopiado()" [class.ti-check]="enlaceCopiado()"></i>
          </button>
          <button
            class="ico"
            [class.ico--on]="verQr()"
            (click)="verQr.set(!verQr())"
            [attr.title]="verQr() ? 'Ocultar QR' : 'Ver QR'"
            [attr.aria-label]="verQr() ? 'Ocultar QR' : 'Ver QR'"
          >
            <i class="ti ti-qrcode"></i>
          </button>
        }
      </div>

      @if (verQr() && qrDataUrl(); as src) {
        <div class="qr-wrap">
          <img [src]="src" alt="Código QR de invitación" width="180" height="180" />
          <p class="qr-pista">Escanea para unirte al instante.</p>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .invitar {
        background: var(--surface-2); border: 1px dashed var(--accent-fill);
        border-radius: 14px; padding: 14px; text-align: center;
      }
      .etq { font-size: 11px; color: var(--text-secondary); letter-spacing: 1px; text-transform: uppercase; }
      .codigo {
        font-size: 26px; font-weight: 800; letter-spacing: 4px;
        color: var(--accent-text); margin: 6px 0 18px;
      }
      .acciones { display: flex; gap: 14px; justify-content: center; align-items: center; }
      .ico {
        display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
        width: 48px; height: 48px; padding: 0; border-radius: 14px; font-size: 20px;
        border: 1px solid var(--border); background: var(--surface-1); color: var(--text-primary);
        transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease, filter 0.15s ease;
      }
      .ico:hover { border-color: var(--accent-fill); color: var(--accent-text); }
      .ico--primary {
        background: var(--accent-fill); color: #fff; border-color: var(--accent-fill);
      }
      .ico--primary:hover { filter: brightness(1.06); color: #fff; }
      .ico--on { border-color: var(--accent-fill); color: var(--accent-text); background: var(--accent-bg); }
      .ico:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
      @media (prefers-reduced-motion: reduce) { .ico { transition: none; } }
      .qr-wrap { margin-top: 16px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
      .qr-wrap img {
        border-radius: 12px; background: #fff; padding: 10px;
        box-shadow: 0 4px 16px -6px rgba(0, 0, 0, 0.4);
      }
      .qr-pista { font-size: 12px; color: var(--text-muted); margin: 0; }
    `,
  ],
})
export class CodigoInvitarComponent {
  private readonly toast = inject(ToastService);

  readonly codigo = input.required<string>();
  readonly url = input.required<string>();
  readonly etiqueta = input('Código de invitación');

  readonly verQr = signal(false);
  readonly copiado = signal(false);
  readonly enlaceCopiado = signal(false);
  readonly qrDataUrl = signal<string | null>(null);

  /** El QR se puede generar si tenemos una URL válida. */
  readonly soportaQr = computed(() => !!this.url());

  constructor() {
    // Genera (o regenera) el QR cuando cambia la URL. Es una imagen data-URL
    // local, no depende de red ni de terceros.
    effect(() => {
      const u = this.url();
      if (!u) {
        this.qrDataUrl.set(null);
        return;
      }
      QRCode.toDataURL(u, { width: 220, margin: 1 })
        .then((data) => this.qrDataUrl.set(data))
        .catch(() => this.qrDataUrl.set(null));
    });
  }

  copiar(): void {
    // Copiamos SOLO el código, no la URL.
    navigator.clipboard?.writeText(this.codigo()).then(
      () => {
        this.copiado.set(true);
        this.toast.exito('Código copiado.');
        setTimeout(() => this.copiado.set(false), 1500);
      },
      () => this.toast.error('No se pudo copiar.'),
    );
  }

  copiarEnlace(): void {
    // Copiamos la URL completa de invitación (para compartir por chat, etc.).
    const enlace = this.url();
    if (!enlace) return;
    navigator.clipboard?.writeText(enlace).then(
      () => {
        this.enlaceCopiado.set(true);
        this.toast.exito('Enlace copiado.');
        setTimeout(() => this.enlaceCopiado.set(false), 1500);
      },
      () => this.toast.error('No se pudo copiar el enlace.'),
    );
  }
}
