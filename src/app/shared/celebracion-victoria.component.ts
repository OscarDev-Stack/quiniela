import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Celebración de victoria reutilizable para torneos y eliminatorias.
 * Muestra un trofeo con destellos, un título grande y (opcional) el premio
 * ganado. Respeta los colores del tema y `prefers-reduced-motion`.
 *
 * Uso:
 *   <app-celebracion-victoria
 *     titulo="¡Felicidades, ganaste!"
 *     subtitulo="Fuiste el último en pie de 12 participantes."
 *     [premio]="240" />
 */
@Component({
    selector: 'app-celebracion-victoria',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="celebra">
            <!-- Confeti: piezas generadas por CSS, cada una con su animación. -->
            <div class="confeti" aria-hidden="true">
                @for (c of piezas; track c.i) {
                    <span class="pieza" [ngStyle]="c.estilo"></span>
                }
            </div>

            <div class="halo"></div>
            <div class="trofeo"><i class="ti ti-trophy"></i></div>

            <h2 class="titulo">{{ titulo() }}</h2>
            @if (subtitulo()) {
                <p class="sub">{{ subtitulo() }}</p>
            }

            @if ((premio() ?? 0) > 0) {
                <div class="premio">+{{ premio() | number }} pts</div>
                <p class="detalle">Ya están en tu saldo.</p>
            }
        </div>
    `,
    styles: [
        `
        .celebra {
            position: relative; overflow: hidden;
            text-align: center; padding: 34px 20px 28px; margin-bottom: 16px;
            border-radius: var(--radius-lg);
            border: 1px solid var(--success-text);
            background: linear-gradient(160deg, var(--success-bg), var(--surface-2));
        }

        /* Halo suave detrás del trofeo. */
        .halo {
            position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
            width: 160px; height: 160px; border-radius: 50%;
            background: radial-gradient(circle, var(--warning-bg), transparent 70%);
            opacity: 0.9; pointer-events: none;
            animation: latido 2.2s ease-in-out infinite;
        }

        .trofeo {
            position: relative; z-index: 2; font-size: 52px; line-height: 1; margin-bottom: 12px;
            color: var(--warning-text);
            animation: brinca 1.5s ease-in-out infinite;
        }

        .titulo { position: relative; z-index: 2; font-size: 22px; font-weight: 800; margin: 0 0 6px; color: var(--success-text); }
        .sub { font-size: 13px; color: var(--text-secondary); margin: 0; position: relative; z-index: 2; }

        .premio {
            position: relative; z-index: 2;
            font-size: 34px; font-weight: 800; color: var(--success-text); margin: 16px 0 2px;
            animation: aparece 0.5s ease 0.2s both;
        }
        .detalle { font-size: 12px; color: var(--text-muted); margin: 0; position: relative; z-index: 2; }

        /* ===== Confeti ===== */
        .confeti { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 1; }
        .pieza {
            position: absolute; top: -16px;
            width: 9px; height: 14px; border-radius: 2px;
            animation: caer linear infinite;
        }

        /* Cae a lo alto del contenedor (que mide ~260-320px). */
        @keyframes caer {
            0% { transform: translateY(0) rotate(0deg); opacity: 0; }
            10% { opacity: 1; }
            85% { opacity: 1; }
            100% { transform: translateY(320px) rotate(540deg); opacity: 0; }
        }
        @keyframes brinca {
            0%, 100% { transform: translateY(0) scale(1); }
            50% { transform: translateY(-6px) scale(1.06); }
        }
        @keyframes latido {
            0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.9; }
            50% { transform: translateX(-50%) scale(1.12); opacity: 0.6; }
        }
        @keyframes aparece {
            from { opacity: 0; transform: scale(0.8); }
            to { opacity: 1; transform: scale(1); }
        }

        /* Accesibilidad: sin animación para quien lo prefiere. */
        @media (prefers-reduced-motion: reduce) {
            .trofeo, .halo, .premio { animation: none; }
            .confeti { display: none; }
        }
        `,
    ],
})
export class CelebracionVictoriaComponent {
    readonly titulo = input.required<string>();
    readonly subtitulo = input<string>('');
    readonly premio = input<number | null>(null);

    /**
     * Piezas de confeti pregeneradas. Cada una lleva su posición, color y
     * tiempos en un string de estilo inline. Se usan colores hex sólidos (no
     * variables CSS) para que se pinten sin depender del tema, y la animación
     * `caer` viene del CSS del componente.
     */
    readonly piezas = Array.from({ length: 30 }, (_, i) => {
        const colores = ['#f1c40f', '#2f9e6b', '#378add', '#e0533d', '#a259e6', '#ff8c42'];
        return {
            i,
            estilo: {
                left: `${Math.round(Math.random() * 100)}%`,
                background: colores[i % colores.length],
                'animation-delay': `${Math.round(Math.random() * 3000)}ms`,
                'animation-duration': `${2400 + Math.round(Math.random() * 1800)}ms`,
            } as Record<string, string>,
        };
    });
}
