import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InstalarService } from '../../shared/instalar.service';
import { ToastService } from '../../shared/toast.service';
import { StatsService } from '../../shared/stats.service';

/**
 * Botón "Instalar app" para el perfil. Se adapta a la plataforma:
 *  - Android: un toque lanza el diálogo nativo de instalación.
 *  - iPhone: abre un modal con los pasos (Compartir → Agregar a inicio),
 *    porque Safari no tiene diálogo automático.
 * No se muestra si la app ya está instalada.
 */
@Component({
  selector: 'app-instalar-boton',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (mostrar()) {
      <button class="instalar" (click)="alTocar()">
        <i class="ti ti-download"></i>
        <span>Instalar app</span>
      </button>
    }

    @if (verPasos()) {
      <div class="fondo" (click)="verPasos.set(false)">
        <div class="hoja" (click)="$event.stopPropagation()">
          <div class="hoja-cab">
            <h3>Agregar a tu inicio</h3>
            <button class="cerrar" (click)="verPasos.set(false)" aria-label="Cerrar">
              <i class="ti ti-x"></i>
            </button>
          </div>

          @if (esIOS && esSafari) {
            <ol class="pasos">
              <li>
                Toca el botón <strong>Compartir</strong>
                <i class="ti ti-share-2 en-linea"></i> abajo en Safari.
              </li>
              <li>Baja y elige <strong>Agregar a inicio</strong>.</li>
              <li>Confirma tocando <strong>Agregar</strong> arriba a la derecha.</li>
            </ol>
            <p class="nota">El ícono de Quiniela aparecerá en tu pantalla de inicio.</p>
          } @else if (esIOS) {
            <p class="nota nota--warn">
              Para instalarla en iPhone, primero abre esta página en
              <strong>Safari</strong>. Desde otros navegadores no se puede.
            </p>
          } @else {
            <p class="nota">
              Busca la opción <strong>Instalar</strong> en el menú de tu navegador,
              o abre Quiniela desde tu teléfono para agregarla al inicio.
            </p>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      .instalar {
        display: flex; align-items: center; justify-content: center; gap: 8px;
        width: 100%; padding: 13px; cursor: pointer;
        border: 1px solid var(--accent-fill); border-radius: var(--radius);
        background: var(--accent-bg); color: var(--accent-text);
        font-size: 14px; font-weight: 700;
      }
      .instalar i { font-size: 18px; }

      .fondo {
        position: fixed; inset: 0; z-index: 250;
        background: rgba(0, 0, 0, 0.5);
        display: flex; align-items: center; justify-content: center;
        padding: calc(20px + env(safe-area-inset-top)) 20px calc(20px + env(safe-area-inset-bottom));
      }
      .hoja {
        width: 100%; max-width: 420px;
        background: var(--surface-2);
        border-radius: 18px;
        padding: 20px;
        animation: aparecer 0.22s ease;
      }
      @keyframes aparecer {
        from { opacity: 0; transform: scale(0.96); }
        to { opacity: 1; transform: scale(1); }
      }
      @media (prefers-reduced-motion: reduce) {
        .hoja { animation: none; }
      }
      .hoja-cab {
        display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;
      }
      .hoja-cab h3 { margin: 0; font-size: 17px; }
      .cerrar {
        background: transparent; border: none; cursor: pointer;
        color: var(--text-muted); font-size: 22px; line-height: 1;
      }
      .pasos { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 12px; }
      .pasos li { font-size: 14px; line-height: 1.5; color: var(--text-primary); }
      .en-linea { vertical-align: middle; color: var(--accent-text); }
      .nota { font-size: 13px; color: var(--text-secondary); margin: 14px 0 0; line-height: 1.5; }
      .nota--warn { color: var(--warning-text); }
    `,
  ],
})
export class InstalarBotonComponent {
  private readonly instalar = inject(InstalarService);
  private readonly toast = inject(ToastService);
  private readonly stats = inject(StatsService);

  readonly verPasos = signal(false);
  readonly esSafari = this.instalar.esSafari();

  /** El botón se muestra solo donde tiene sentido instalar (móvil, o
   *  escritorio con soporte real). En una PC normal, no aparece. */
  mostrar(): boolean {
    return this.instalar.sePuedeOfrecer();
  }

  /** True en un iPhone/iPad, para mostrar los pasos de Safari. */
  readonly esIOS = this.instalar.esIOS();

  async alTocar(): Promise<void> {
    // Android: diálogo nativo de un toque.
    if (this.instalar.puedeInstalarAndroid()) {
      const ok = await this.instalar.instalarAndroid();
      if (ok) {
        this.stats.evento('app_instalada', { plataforma: 'android' });
        this.toast.exito('¡Listo! Quiniela se está instalando.');
      }
      return;
    }
    // iPhone (o Android sin evento aún): mostramos los pasos.
    this.stats.evento('instalar_pasos_vistos', { plataforma: 'ios' });
    this.verPasos.set(true);
  }
}