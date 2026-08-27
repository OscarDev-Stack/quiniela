import { Component, NgZone, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AccesoService } from '../../core/services/acceso.service';

/**
 * Portón de acceso al sitio. Muestra el widget de Cloudflare Turnstile;
 * cuando el usuario lo resuelve, validamos el token en el servidor y, si es
 * correcto, entramos a la app. Solo aparece la primera vez por dispositivo.
 *
 * IMPORTANTE: reemplaza SITE_KEY_DE_TURNSTILE por tu Site Key pública de
 * Cloudflare Turnstile.
 */
declare const turnstile: {
  render: (el: HTMLElement, opciones: Record<string, unknown>) => string;
  reset: (id?: string) => void;
} | undefined;

const SITE_KEY = 'SITE_KEY_DE_TURNSTILE';

@Component({
  selector: 'app-acceso',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="acceso">
      <div class="fondo-glow"></div>

      <div class="contenido">
        <div class="logo-wrap">
          <div class="logo-glow"></div>
          <div class="logo">
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
        </div>

        <div class="marca">
          <span class="marca-nombre">Fut</span>
          <span class="marca-by">by AutomatePower</span>
        </div>

        <h1 class="titulo">Verificando tu conexión</h1>
        <p class="sub">Un momento, confirmamos que eres una persona.</p>

        <div class="tarjeta">
          <div id="turnstile-widget" class="widget"></div>

          @if (verificando()) {
            <p class="estado"><i class="ti ti-loader"></i> Validando…</p>
          }
          @if (error()) {
            <p class="estado estado--error"><i class="ti ti-alert-circle"></i> {{ error() }}</p>
            <button class="reintentar" (click)="reintentar()">
              <i class="ti ti-refresh"></i> Reintentar
            </button>
          }
        </div>

        <p class="pie">Protegido por Cloudflare</p>
      </div>
    </div>
  `,
  styles: [
    `
      .acceso {
        position: relative; min-height: 100vh; overflow: hidden;
        background: var(--surface-0); color: var(--text-primary);
        display: flex; align-items: center; justify-content: center; padding: 24px;
      }
      /* Halo azul difuso arriba, como en las pantallas de referencia. */
      .fondo-glow {
        position: absolute; top: -120px; left: 50%; transform: translateX(-50%);
        width: 360px; height: 360px; border-radius: 50%;
        background: radial-gradient(circle, rgba(55, 138, 221, 0.28), transparent 70%);
        filter: blur(20px); pointer-events: none;
      }
      .contenido {
        position: relative; z-index: 1; width: 100%; max-width: 360px;
        display: flex; flex-direction: column; align-items: center; text-align: center;
      }

      /* Logo con halo azul */
      .logo-wrap { position: relative; margin-bottom: 20px; }
      .logo-glow {
        position: absolute; inset: -18px; border-radius: 50%;
        background: radial-gradient(circle, rgba(55, 138, 221, 0.45), transparent 70%);
        filter: blur(14px);
      }
      .logo {
        position: relative; width: 84px; height: 84px; border-radius: 22px;
        display: flex; align-items: center; justify-content: center;
        background: var(--surface-2); border: 1px solid rgba(55, 138, 221, 0.4);
        box-shadow: 0 0 30px rgba(55, 138, 221, 0.25);
      }
      .logo svg { width: 58px; height: 58px; }

      /* Marca: Fut grande + by AutomatePower pequeño */
      .marca { display: flex; flex-direction: column; align-items: center; margin-bottom: 28px; }
      .marca-nombre { font-size: 40px; font-weight: 800; letter-spacing: -0.5px; line-height: 1; }
      .marca-by {
        font-size: 13px; font-weight: 500; color: var(--accent-text);
        margin-top: 4px; letter-spacing: 0.3px;
      }

      .titulo { font-size: 20px; font-weight: 700; margin: 0 0 6px; }
      .sub { font-size: 14px; color: var(--text-secondary); margin: 0 0 26px; line-height: 1.4; }

      /* Tarjeta que contiene el widget */
      .tarjeta {
        width: 100%; background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 18px; padding: 22px 18px;
        display: flex; flex-direction: column; align-items: center; gap: 14px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
      }
      .widget { min-height: 65px; display: flex; align-items: center; justify-content: center; }

      .estado {
        font-size: 13px; color: var(--text-secondary); margin: 0;
        display: flex; align-items: center; gap: 6px;
      }
      .estado--error { color: var(--danger-text, #e0533d); }
      .reintentar {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 10px 20px; border-radius: 999px; border: none; cursor: pointer;
        background: var(--accent-fill); color: #fff; font-size: 14px; font-weight: 600;
      }
      .reintentar:hover { filter: brightness(1.08); }

      .pie {
        font-size: 12px; color: var(--text-muted, #7a7a7a); margin: 22px 0 0;
        letter-spacing: 0.3px;
      }

      @keyframes girar { to { transform: rotate(360deg); } }
      .ti-loader { display: inline-block; animation: girar 1s linear infinite; }
    `,
  ],
})
export class AccesoComponent implements OnDestroy {
  private readonly acceso = inject(AccesoService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);

  readonly verificando = signal(false);
  readonly error = signal('');

  private scriptEl: HTMLScriptElement | null = null;
  private widgetId: string | null = null;

  constructor() {
    // Si ya pasó el portón antes, no lo mostramos: directo a la app.
    if (this.acceso.yaValidado()) {
      this.router.navigate(['/inicio']);
      return;
    }
    this.cargarTurnstile();
  }

  /** Carga el script de Turnstile y monta el widget cuando esté listo. */
  private cargarTurnstile(): void {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.defer = true;
    s.onload = () => this.montarWidget();
    document.head.appendChild(s);
    this.scriptEl = s;
  }

  private montarWidget(): void {
    const el = document.getElementById('turnstile-widget');
    if (!el || typeof turnstile === 'undefined') return;
    this.widgetId = turnstile.render(el, {
      sitekey: SITE_KEY,
      // Callbacks como funciones directas (más fiable que nombres globales).
      callback: (token: string) => {
        this.zone.run(() => this.onToken(token));
      },
      'error-callback': () => {
        this.zone.run(() => this.error.set('No se pudo verificar. Reintenta.'));
      },
      theme: 'auto',
    });
  }

  private async onToken(token: string): Promise<void> {
    console.log('[Turnstile] token recibido, validando en servidor…');
    this.verificando.set(true);
    this.error.set('');
    try {
      const ok = await this.acceso.validar(token);
      console.log('[Turnstile] respuesta del servidor:', ok);
      if (ok) {
        this.router.navigate(['/inicio']);
      } else {
        this.error.set('Verificación fallida. Reintenta.');
        this.reintentar();
      }
    } catch (e: unknown) {
      console.error('[Turnstile] error al validar:', e);
      this.error.set('No se pudo verificar. Revisa tu conexión y reintenta.');
    } finally {
      this.verificando.set(false);
    }
  }

  reintentar(): void {
    this.error.set('');
    if (typeof turnstile !== 'undefined' && this.widgetId) {
      turnstile.reset(this.widgetId);
    }
  }

  ngOnDestroy(): void {
    if (this.scriptEl) this.scriptEl.remove();
  }
}