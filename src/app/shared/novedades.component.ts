import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NovedadesService } from './novedades.service';

interface Diapositiva {
  icono: string;
  titulo: string;
  detalle: string;
  version: string;
}

/**
 * Presentación de novedades como carrusel: una diapositiva por
 * característica, con icono grande, título y detalle. Se navega con botones
 * o deslizando con el dedo. La bienvenida de primera vez abre con el logo.
 * Si solo hay una novedad, se muestra como pantalla única sin navegación.
 */
@Component({
  selector: 'app-novedades',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (novedades.mostrando(); as lista) {
      <div class="fondo" (click)="novedades.cerrar()">
        <div
          class="hoja"
          role="dialog"
          aria-modal="true"
          aria-label="Novedades"
          (click)="$event.stopPropagation()"
          (touchstart)="alTocar($event)"
          (touchend)="alSoltar($event)"
        >
          <button class="saltar" (click)="novedades.cerrar()" aria-label="Cerrar">
            @if (varias()) { Saltar } @else { <i class="ti ti-x"></i> }
          </button>

          @if (actual(); as d) {
            <div class="slide">
              @if (indice() === 0 && esBienvenida()) {
                <div class="hero-logo">
                  <div class="hero-logo-glow"></div>
                  <div class="hero-logo-caja">
                    <svg viewBox="118 110 276 280" xmlns="http://www.w3.org/2000/svg" aria-label="Fut">
                      <g stroke="#4a94e2" stroke-width="8" fill="none" opacity="0.6" stroke-linecap="round">
                        <rect x="138" y="130" width="236" height="180" rx="8"/>
                        <line x1="195" y1="130" x2="195" y2="310"/>
                        <line x1="256" y1="130" x2="256" y2="310"/>
                        <line x1="317" y1="130" x2="317" y2="310"/>
                        <line x1="138" y1="191" x2="374" y2="191"/>
                        <line x1="138" y1="252" x2="374" y2="252"/>
                      </g>
                      <path d="M 195 146 L 350 146 L 334 195 L 236 195 L 228 232 L 310 232 L 294 281 L 212 281 L 191 367 L 138 367 Z" fill="#ffffff"/>
                      <circle cx="334" cy="322" r="16" fill="#8cc0f0"/>
                      <path d="M 334 306 L 342 322 L 334 338 L 326 322 Z" fill="#cde3f7"/>
                    </svg>
                  </div>
                  <span class="hero-marca">Fut</span>
                </div>
              } @else {
                <div class="icono-grande">
                  <div class="icono-glow"></div>
                  <div class="icono-caja"><i class="ti" [class]="'ti ' + d.icono"></i></div>
                </div>
              }

              <h2 class="slide-titulo">{{ d.titulo }}</h2>
              <p class="slide-detalle">{{ d.detalle }}</p>
            </div>

            @if (varias()) {
              <div class="puntos">
                @for (s of slides(); track $index) {
                  <span class="punto-ind" [class.punto-ind--activo]="$index === indice()"></span>
                }
              </div>
            }

            <div class="acciones">
              @if (varias() && indice() > 0) {
                <button class="btn btn--sec" (click)="anterior()">Atrás</button>
              }
              @if (esUltima()) {
                <button class="btn btn--pri" (click)="novedades.cerrar()">
                  {{ esBienvenida() ? 'Empezar' : 'Entendido' }}
                </button>
              } @else {
                <button class="btn btn--pri" (click)="siguiente()">Siguiente</button>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      .fondo {
        position: fixed; inset: 0; z-index: 190;
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        animation: aparecer 0.15s ease-out;
      }

      .hoja {
        position: relative; width: 100%; max-width: 400px;
        min-height: 440px;
        display: flex; flex-direction: column;
        background: var(--surface-0);
        border: 1px solid var(--border);
        border-radius: 24px;
        padding: 20px;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        animation: aparecer-modal 0.24s ease-out;
      }
      .hoja::before {
        content: ''; position: absolute; top: -60px; left: 50%;
        transform: translateX(-50%);
        width: 320px; height: 280px; border-radius: 50%;
        background: radial-gradient(circle, rgba(55, 138, 221, 0.22), transparent 70%);
        pointer-events: none;
      }

      .saltar {
        position: absolute; top: 14px; right: 14px; z-index: 2;
        border: none; cursor: pointer;
        background: var(--surface-2); color: var(--text-secondary);
        font-size: 13px; font-weight: 600;
        padding: 7px 13px; border-radius: 999px;
        min-width: 36px; min-height: 36px;
      }

      .slide {
        position: relative; z-index: 1; flex: 1;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        text-align: center; padding: 24px 12px 8px;
      }

      .hero-logo { position: relative; display: flex; flex-direction: column; align-items: center; margin-bottom: 22px; }
      .hero-logo-glow {
        position: absolute; top: -14px; width: 120px; height: 120px; border-radius: 50%;
        background: radial-gradient(circle, rgba(55, 138, 221, 0.5), transparent 70%);
      }
      .hero-logo-caja {
        position: relative; width: 92px; height: 92px; border-radius: 26px;
        background: var(--surface-2); border: 1px solid rgba(55, 138, 221, 0.4);
        display: flex; align-items: center; justify-content: center;
      }
      .hero-logo-caja svg { width: 62px; height: 62px; }
      .hero-marca { position: relative; font-size: 28px; font-weight: 800; margin-top: 12px; letter-spacing: -0.5px; }

      .icono-grande { position: relative; margin-bottom: 24px; }
      .icono-glow {
        position: absolute; inset: -18px; border-radius: 50%;
        background: radial-gradient(circle, rgba(55, 138, 221, 0.42), transparent 70%);
      }
      .icono-caja {
        position: relative; width: 96px; height: 96px; border-radius: 28px;
        background: var(--surface-2); border: 1px solid rgba(55, 138, 221, 0.4);
        display: flex; align-items: center; justify-content: center;
        font-size: 46px; color: var(--accent-text);
      }

      .slide-titulo { font-size: 22px; font-weight: 800; margin: 0 0 12px; letter-spacing: -0.3px; }
      .slide-detalle {
        font-size: 14px; color: var(--text-secondary); margin: 0;
        line-height: 1.55; max-width: 300px;
      }

      .puntos { position: relative; z-index: 1; display: flex; justify-content: center; gap: 7px; padding: 18px 0; }
      .punto-ind {
        width: 7px; height: 7px; border-radius: 999px;
        background: var(--border-strong); transition: all 0.2s ease;
      }
      .punto-ind--activo { width: 22px; background: var(--accent-fill); }

      .acciones { position: relative; z-index: 1; display: flex; gap: 10px; padding-top: 4px; padding-bottom: env(safe-area-inset-bottom); }
      .btn {
        flex: 1; padding: 14px; cursor: pointer;
        font-size: 15px; font-weight: 600; border-radius: 14px;
      }
      .btn--pri { flex: 2; border: none; background: var(--accent-fill); color: #fff; }
      .btn--sec { border: 1px solid var(--border); background: var(--surface-2); color: var(--text-primary); }

      @keyframes aparecer { from { opacity: 0; } }
      @keyframes aparecer-modal { from { transform: scale(0.94); opacity: 0; } }
      @media (prefers-reduced-motion: reduce) {
        .fondo, .hoja { animation: none; }
      }
    `,
  ],
})
export class NovedadesComponent {
  readonly novedades = inject(NovedadesService);

  readonly indice = signal(0);

  constructor() {
    // Cada vez que se abre el carrusel, arranca en la primera diapositiva.
    effect(() => {
      if (this.novedades.mostrando()) this.indice.set(0);
    });
  }

  readonly slides = computed<Diapositiva[]>(() => {
    const lista = this.novedades.mostrando() ?? [];
    return lista.flatMap((n) =>
      n.puntos.map((p) => ({
        icono: p.icono,
        titulo: p.titulo,
        detalle: p.detalle,
        version: n.version,
      })),
    );
  });

  readonly actual = computed(() => this.slides()[this.indice()] ?? null);
  readonly varias = computed(() => this.slides().length > 1);
  readonly esUltima = computed(() => this.indice() >= this.slides().length - 1);
  readonly esBienvenida = computed(() => this.novedades.modo() === 'bienvenida');

  private touchX = 0;

  siguiente(): void {
    if (!this.esUltima()) this.indice.update((i) => i + 1);
  }

  anterior(): void {
    if (this.indice() > 0) this.indice.update((i) => i - 1);
  }

  alTocar(e: TouchEvent): void {
    this.touchX = e.changedTouches[0].clientX;
  }

  alSoltar(e: TouchEvent): void {
    const dx = e.changedTouches[0].clientX - this.touchX;
    if (dx < -45) this.siguiente();
    else if (dx > 45) this.anterior();
  }
}