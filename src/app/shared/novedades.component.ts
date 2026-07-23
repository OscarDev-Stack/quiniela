import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NovedadesService } from './novedades.service';

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
        >
          <header class="cab">
            <div>
              <h2>{{ titulo() }}</h2>
              @if (subtitulo(); as texto) {
                <p class="resumen">{{ texto }}</p>
              }
            </div>
            <button class="cerrar" (click)="novedades.cerrar()" aria-label="Cerrar">
              <i class="ti ti-x"></i>
            </button>
          </header>

          <div class="cuerpo">
            @for (n of lista; track n.version) {
              @if (novedades.modo() !== 'novedades' || lista.length > 1) {
                <div class="version-cab">
                  <span class="etiqueta-version">v{{ n.version }}</span>
                  <span class="fecha">{{ n.fecha }}</span>
                </div>
              }

              @for (p of n.puntos; track p.titulo) {
                <div class="punto">
                  <span class="icono"><i class="ti" [class]="'ti ' + p.icono"></i></span>
                  <div>
                    <strong>{{ p.titulo }}</strong>
                    <p>{{ p.detalle }}</p>
                  </div>
                </div>
              }
            }
          </div>

          <footer class="pie">
            <button class="btn" (click)="novedades.cerrar()">{{ textoBoton() }}</button>
          </footer>
        </div>
      </div>
    }
  `,
    styles: [
        `
      .fondo {
        position: fixed; inset: 0; z-index: 190;
        display: flex; align-items: flex-end; justify-content: center;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(2px);
        animation: aparecer 0.15s ease-out;
      }
      @media (min-width: 620px) {
        .fondo { align-items: center; padding: 24px; }
        .hoja { border-radius: 16px; max-height: 80vh; }
      }

      .hoja {
        width: 100%; max-width: 460px;
        display: flex; flex-direction: column;
        max-height: 86vh;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: 18px 18px 0 0;
        animation: subir 0.22s ease-out;
      }

      .cab {
        display: flex; align-items: flex-start; gap: 12px;
        padding: 20px 20px 14px;
        border-bottom: 1px solid var(--border);
      }
      .cab h2 { font-size: 18px; font-weight: 600; margin: 0; }
      .resumen { font-size: 13px; color: var(--text-secondary); margin: 5px 0 0; line-height: 1.45; }
      .cerrar {
        flex-shrink: 0; width: 32px; height: 32px; cursor: pointer;
        border: none; border-radius: 50%; font-size: 18px;
        background: var(--surface-1); color: var(--text-muted);
      }

      .cuerpo {
        flex: 1; overflow-y: auto; padding: 16px 20px;
        -webkit-overflow-scrolling: touch;
      }

      .version-cab {
        display: flex; align-items: center; gap: 8px;
        margin: 14px 0 12px;
      }
      .version-cab:first-child { margin-top: 0; }
      .etiqueta-version {
        font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px;
        background: var(--accent-bg); color: var(--accent-text);
      }
      .fecha { font-size: 11px; color: var(--text-muted); }

      .punto { display: flex; gap: 12px; margin-bottom: 16px; }
      .punto:last-child { margin-bottom: 4px; }
      .icono {
        flex-shrink: 0; width: 34px; height: 34px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center; font-size: 17px;
        background: var(--surface-1); color: var(--accent-text);
      }
      .punto strong { display: block; font-size: 14px; margin-bottom: 3px; }
      .punto p { font-size: 13px; color: var(--text-secondary); margin: 0; line-height: 1.5; }

      .pie {
        padding: 14px 20px calc(18px + env(safe-area-inset-bottom));
        border-top: 1px solid var(--border);
      }
      .btn {
        width: 100%; padding: 13px; cursor: pointer;
        font-size: 15px; font-weight: 600;
        border: none; border-radius: var(--radius);
        background: var(--accent-fill); color: #fff;
      }

      @keyframes aparecer {
        from { opacity: 0; }
      }
      @keyframes subir {
        from { transform: translateY(24px); opacity: 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .fondo, .hoja { animation: none; }
      }
    `,
    ],
})
export class NovedadesComponent {
    readonly novedades = inject(NovedadesService);

    readonly titulo = computed(() => {
        switch (this.novedades.modo()) {
            case 'bienvenida':
                return 'Te damos la bienvenida';
            case 'novedades':
                return '¿Qué hay de nuevo?';
            default:
                return 'Novedades';
        }
    });

    readonly subtitulo = computed(() => {
        if (this.novedades.modo() === 'bienvenida') {
            return 'Esto es lo que puedes hacer por aquí.';
        }
        if (this.novedades.modo() === 'novedades') {
            return this.novedades.mostrando()?.[0]?.resumen ?? '';
        }
        return '';
    });

    readonly textoBoton = computed(() =>
        this.novedades.modo() === 'bienvenida' ? 'Empezar' : 'Entendido',
    );
}