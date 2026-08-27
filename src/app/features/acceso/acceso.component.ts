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

const SITE_KEY = '0x4AAAAAAEdUWtaENzy8lzBw';

@Component({
    selector: 'app-acceso',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div class="acceso">
      <div class="marca">⚽ Quiniela</div>
      <h1 class="titulo">Verificando tu conexión</h1>
      <p class="sub">Un momento, confirmamos que eres una persona.</p>

      <div id="turnstile-widget" class="widget"></div>

      @if (verificando()) {
        <p class="estado"><i class="ti ti-loader"></i> Validando…</p>
      }
      @if (error()) {
        <p class="estado estado--error">{{ error() }}</p>
        <button class="reintentar" (click)="reintentar()">Reintentar</button>
      }
    </div>
  `,
    styles: [
        `
      .acceso {
        min-height: 100vh; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 14px;
        padding: 24px; text-align: center;
      }
      .marca { font-size: 26px; font-weight: 800; color: var(--accent-text); }
      .titulo { font-size: 20px; font-weight: 700; margin: 8px 0 0; }
      .sub { font-size: 14px; color: var(--text-secondary); margin: 0 0 8px; }
      .widget { min-height: 65px; }
      .estado { font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }
      .estado--error { color: var(--danger-text); }
      .reintentar {
        padding: 9px 18px; border-radius: var(--radius); border: 1px solid var(--border);
        background: var(--surface-1); color: var(--text-primary); cursor: pointer; font-size: 14px;
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