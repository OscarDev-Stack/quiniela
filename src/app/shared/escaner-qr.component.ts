import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { ToastService } from './toast.service';
import {
  InvitacionPendiente,
  TipoInvitacion,
  guardarInvitacion,
  interpretarQr,
  rutaDeInvitacion,
} from './invitacion.util';

/**
 * Escáner de QR de invitación. Abre la cámara (previo gesto del usuario, que es
 * obligatorio en iOS), lee el QR y del texto extrae la invitación (torneo,
 * grupo o eliminatoria). Todo ocurre en el dispositivo: no se manda la imagen
 * ni el código a terceros.
 *
 * Requisitos del navegador:
 *  - getUserMedia solo funciona en HTTPS o localhost (ya cubierto por Firebase
 *    Hosting y el dev server).
 *  - En iOS Safari la cámara solo arranca tras un toque, por eso el escaneo se
 *    inicia con un botón, nunca automáticamente.
 *
 * Comportamiento al leer:
 *  - Si hay sesión, navega directo a la pantalla de "unirse".
 *  - Si NO hay sesión, guarda la invitación pendiente para retomarla tras el
 *    login y también navega (la pantalla de unirse maneja el sin-sesión).
 *  - Emite (leido) por si el contenedor quiere reaccionar (p. ej. cerrar modal).
 */
@Component({
  selector: 'app-escaner-qr',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="escaner">
      @if (!activo() && !error()) {
        <div class="intro">
          <div class="icono"><i class="ti ti-qrcode"></i></div>
          <p class="txt">Apunta la cámara al código QR de la invitación.</p>
          <button class="btn btn--primary" (click)="iniciar()">
            <i class="ti ti-camera"></i> Escanear QR
          </button>
        </div>
      }

      @if (activo()) {
        <div class="video-wrap">
          <div class="video-caja">
            <video #video class="video" playsinline muted></video>
            <div class="mira" aria-hidden="true"></div>
          </div>
          <p class="pista">Buscando código…</p>
          <button class="btn btn--fantasma" (click)="detener()">Cancelar</button>
        </div>
      }

      @if (error(); as e) {
        <div class="error">
          <i class="ti ti-camera-off"></i>
          <p>{{ e }}</p>
          <button class="btn" (click)="reintentar()">Reintentar</button>
        </div>
      }

      <!-- Alternativa siempre disponible: escribir el código a mano. -->
      <div class="manual">
        <span>¿No puedes escanear?</span>
        <div class="fila">
          <input
            class="entrada"
            type="text"
            inputmode="text"
            autocapitalize="characters"
            placeholder="Escribe el código"
            [value]="codigoManual()"
            (input)="codigoManual.set($any($event.target).value)"
            (keyup.enter)="usarManual()"
          />
          <button class="btn" [disabled]="!codigoManual().trim()" (click)="usarManual()">
            Usar
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .escaner {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .intro {
        text-align: center;
        padding: 8px 0;
      }
      .icono {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        margin: 0 auto 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        background: var(--accent-bg);
        color: var(--accent-text);
      }
      .txt {
        font-size: 14px;
        color: var(--text-secondary);
        margin: 0 0 14px;
      }
      .video-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
      }
      .video-caja {
        position: relative;
        width: 100%;
        max-width: 300px;
        aspect-ratio: 1;
        border-radius: 16px;
        overflow: hidden;
        background: #000;
      }
      .video {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .mira {
        position: absolute;
        inset: 18%;
        border: 3px solid rgba(255, 255, 255, 0.9);
        border-radius: 14px;
        pointer-events: none;
      }
      .pista {
        font-size: 12px;
        color: var(--text-muted);
        margin: 0;
      }
      .error {
        text-align: center;
        background: var(--danger-bg);
        color: var(--danger-text);
        border-radius: 14px;
        padding: 18px;
      }
      .error i {
        font-size: 30px;
      }
      .error p {
        font-size: 13px;
        margin: 8px 0 12px;
        line-height: 1.5;
      }
      .manual {
        text-align: center;
        border-top: 1px dashed var(--border);
        padding-top: 14px;
      }
      .manual > span {
        font-size: 12px;
        color: var(--text-muted);
        display: block;
        margin-bottom: 8px;
      }
      .fila {
        display: flex;
        gap: 8px;
        max-width: 320px;
        margin: 0 auto;
      }
      .entrada {
        flex: 1;
        padding: 10px 12px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius);
        background: var(--surface-1);
        color: var(--text-primary);
        font-size: 15px;
        letter-spacing: 2px;
        text-transform: uppercase;
      }
      .btn {
        cursor: pointer;
        padding: 10px 16px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius);
        background: transparent;
        color: var(--text-primary);
        font-size: 14px;
        font-weight: 600;
      }
      .btn--primary {
        background: var(--accent-fill);
        color: #fff;
        border-color: transparent;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .btn--fantasma {
        background: var(--surface-1);
      }
      .btn:disabled {
        opacity: 0.5;
        cursor: default;
      }
    `,
  ],
})
export class EscanerQrComponent implements OnDestroy {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  /** Tipo asumido cuando el QR/código no trae ruta (código pelado). */
  readonly tipoPorDefecto = input<TipoInvitacion>('torneo');

  /**
   * Si es true (por defecto), al reconocer una invitación el escáner navega
   * solo a la pantalla de "unirse". Ponlo en false cuando el contenedor quiere
   * manejar el resultado él mismo (p. ej. un modal que decide torneo vs
   * eliminatoria); en ese caso solo emite (leido) y no navega.
   */
  readonly autoNavegar = input(true);

  /** Se emite con la invitación reconocida (por si el padre quiere cerrar un modal). */
  readonly leido = output<InvitacionPendiente>();

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');

  readonly activo = signal(false);
  readonly error = signal('');
  readonly codigoManual = signal('');

  /** true si la cámara y la API de captura existen en este navegador. */
  readonly soportado = computed(
    () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
  );

  private lector: BrowserMultiFormatReader | null = null;
  private controles: IScannerControls | null = null;
  private procesado = false;

  async iniciar(): Promise<void> {
    this.error.set('');
    this.procesado = false;

    if (!this.soportado()) {
      this.error.set('Este navegador no permite usar la cámara. Escribe el código a mano.');
      return;
    }

    this.activo.set(true);

    // Esperamos a que Angular pinte el <video> antes de engancharlo. Un solo
    // microtask no siempre basta (depende del ciclo de detección de cambios),
    // así que sondeamos el elemento un breve lapso hasta que exista.
    const video = await this.esperarVideo();
    if (!video) {
      this.activo.set(false);
      this.error.set('No se pudo preparar la cámara.');
      return;
    }

    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
      this.lector = new BrowserMultiFormatReader(hints);

      // Preferimos la cámara trasera en móviles.
      this.controles = await this.lector.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        video,
        (result) => {
          if (result && !this.procesado) {
            this.procesado = true;
            this.onTexto(result.getText());
          }
        },
      );
    } catch (e: unknown) {
      this.activo.set(false);
      this.error.set(this.mensajeError(e));
    }
  }

  /**
   * Devuelve el <video> en cuanto Angular lo monta, sondeando cada frame hasta
   * un máximo (~1s). Evita depender de un solo microtask, que a veces corre
   * antes de que la vista se pinte y dejaba el elemento en undefined.
   */
  private esperarVideo(intentos = 60): Promise<HTMLVideoElement | null> {
    return new Promise((resolve) => {
      const buscar = (restantes: number) => {
        const el = this.videoRef()?.nativeElement;
        if (el) {
          resolve(el);
          return;
        }
        if (restantes <= 0) {
          resolve(null);
          return;
        }
        requestAnimationFrame(() => buscar(restantes - 1));
      };
      buscar(intentos);
    });
  }

  detener(): void {
    this.controles?.stop();
    this.controles = null;
    this.lector = null;
    this.activo.set(false);
  }

  reintentar(): void {
    this.error.set('');
    this.iniciar();
  }

  usarManual(): void {
    const texto = this.codigoManual().trim();
    if (!texto) return;
    this.onTexto(texto);
  }

  /** Interpreta el texto leído/escrito y actúa en consecuencia. */
  private onTexto(texto: string): void {
    const inv = interpretarQr(texto, this.tipoPorDefecto());
    if (!inv) {
      // No paramos el escaneo: puede ser un QR ajeno. Solo avisamos una vez.
      this.procesado = false;
      this.toast.error('Ese código no es una invitación válida.');
      return;
    }

    this.detener();
    this.leido.emit(inv);

    // Si el contenedor maneja el resultado, no navegamos: él decide.
    if (!this.autoNavegar()) return;

    // Sin sesión: la pantalla de "unirse" pedirá login, pero guardamos la
    // invitación por si el usuario navega a login/registro desde ahí.
    guardarInvitacion(inv.tipo, inv.valor);
    this.router.navigate(rutaDeInvitacion(inv));
  }

  private mensajeError(e: unknown): string {
    const nombre = (e as { name?: string })?.name ?? '';
    if (nombre === 'NotAllowedError' || nombre === 'SecurityError') {
      return 'No diste permiso para usar la cámara. Habilítalo en los ajustes del navegador o escribe el código a mano.';
    }
    if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') {
      return 'No encontramos una cámara disponible. Escribe el código a mano.';
    }
    if (nombre === 'NotReadableError') {
      return 'Otra app está usando la cámara. Ciérrala e inténtalo de nuevo.';
    }
    return 'No se pudo abrir la cámara. Escribe el código a mano.';
  }

  ngOnDestroy(): void {
    this.detener();
  }
}
