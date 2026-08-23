import { Component, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PushService } from '../../shared/push.service';
import { ToastService } from '../../shared/toast.service';
import { StatsService } from '../../shared/stats.service';
import { InstalarService } from '../../shared/instalar.service';

/**
 * Interruptor de notificaciones push para el perfil. Refleja el estado
 * guardado (campo pushActivo del usuario) y al cambiar pide permiso y
 * registra/borra el token del dispositivo vía PushService.
 *
 * Usa el mismo patrón de switch propio (.switch) que el resto de la app,
 * no un checkbox nativo.
 */
@Component({
  selector: 'app-notificaciones-boton',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (push.soportado()) {
      @if (!instalar.yaInstalada() && instalar.esMovil()) {
        <!-- En el navegador móvil las notificaciones no son confiables:
             sugerimos agregar la app al inicio primero. -->
        <div class="fila">
          <div class="txt">
            <span class="tit"><i class="ti ti-bell"></i> Notificaciones</span>
            <small class="pista">
              Para recibir avisos en tu teléfono, primero agrega Quiniela a tu
              pantalla de inicio (arriba). Ya instalada, aquí podrás activarlas.
            </small>
          </div>
        </div>
      } @else {
      <div class="fila">
        <div class="txt">
          <span class="tit"><i class="ti ti-bell"></i> Notificaciones en este dispositivo</span>
          <small class="pista">
            Avisos de jornadas, resultados y torneos directo a tu teléfono.
          </small>
        </div>

        <label class="switch">
          <input
            type="checkbox"
            class="switch-input"
            [checked]="activo()"
            [disabled]="trabajando()"
            (change)="alternar($event)"
          />
          <span class="switch-pista" aria-hidden="true"></span>
        </label>
      </div>

      @if (denegado()) {
        <p class="aviso-perm">
          Bloqueaste las notificaciones. Actívalas desde los ajustes del
          navegador o del sistema para poder recibirlas.
        </p>
      }
      }
    }
  `,
  styles: [
    `
      .fila {
        display: flex; align-items: center; justify-content: space-between; gap: 14px;
      }
      .txt { min-width: 0; }
      .tit { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 600; }
      .pista { display: block; font-size: 12px; color: var(--text-secondary); margin-top: 3px; line-height: 1.4; }
      .aviso-perm {
        font-size: 12px; color: var(--warning-text); background: var(--warning-bg);
        padding: 9px 11px; border-radius: var(--radius); margin: 10px 0 0; line-height: 1.4;
      }

      /* Interruptor propio (los checkbox nativos se deforman en iOS). */
      .switch { position: relative; flex-shrink: 0; cursor: pointer; display: inline-flex; }
      .switch-input {
        position: absolute; opacity: 0; width: 0; height: 0; margin: 0;
        appearance: none; -webkit-appearance: none; pointer-events: none;
      }
      .switch-pista {
        position: relative; flex-shrink: 0;
        width: 48px; height: 28px; border-radius: 999px;
        background: var(--surface-1); border: 1px solid var(--border);
        transition: background 0.18s ease, border-color 0.18s ease;
      }
      .switch-pista::after {
        content: ''; position: absolute; top: 3px; left: 3px;
        width: 20px; height: 20px; border-radius: 50%;
        background: var(--text-muted);
        transition: transform 0.18s ease, background 0.18s ease;
      }
      .switch-input:checked + .switch-pista {
        background: var(--accent-fill); border-color: transparent;
      }
      .switch-input:checked + .switch-pista::after {
        transform: translateX(20px); background: #fff;
      }
      .switch-input:disabled + .switch-pista { opacity: 0.5; }
    `,
  ],
})
export class NotificacionesBotonComponent {
  readonly push = inject(PushService);
  private readonly toast = inject(ToastService);
  private readonly stats = inject(StatsService);
  readonly instalar = inject(InstalarService);

  /** Estado guardado en el usuario (pushActivo), que llega desde el perfil. */
  readonly pushActivo = input(false);

  readonly trabajando = signal(false);
  // Estado local que refleja lo guardado y los cambios en vivo.
  private readonly localActivo = signal<boolean | null>(null);

  activo(): boolean {
    const l = this.localActivo();
    return l === null ? this.pushActivo() : l;
  }

  denegado(): boolean {
    return this.push.permiso() === 'denied';
  }

  async alternar(ev: Event): Promise<void> {
    const quiere = (ev.target as HTMLInputElement).checked;
    this.trabajando.set(true);
    try {
      if (quiere) {
        await this.push.activar();
        this.localActivo.set(true);
        this.stats.evento('push_activado');
        this.toast.exito('Notificaciones activadas en este dispositivo.');
      } else {
        await this.push.desactivar();
        this.localActivo.set(false);
        this.toast.exito('Notificaciones desactivadas.');
      }
    } catch (e: unknown) {
      // Revertir el switch visualmente.
      this.localActivo.set(!quiere);
      this.toast.error((e as Error)?.message ?? 'No se pudo cambiar la configuración.');
    } finally {
      this.trabajando.set(false);
    }
  }
}