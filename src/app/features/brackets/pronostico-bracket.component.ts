import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EscudoComponent } from '../../shared/escudo.component';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Auth, user } from '@angular/fire/auth';
import { map } from 'rxjs/operators';
import { BracketsService } from '../../core/services/brackets.service';
import {
  Bracket,
  Llave,
  nombreRonda,
  rondasDe,
} from '../../core/models/bracket.model';
import {
  cuadroDelPronostico,
  pronosticoCompleto,
} from '../../core/services/bracket-cuadro';

/**
 * El jugador llena su pronóstico eligiendo un ganador por llave.
 * Cada elección alimenta la ronda siguiente de SU cuadro, así que va
 * armando el camino completo hasta el campeón. Se congela al cerrar.
 */
@Component({
  selector: 'app-pronostico-bracket',
  standalone: true,
  imports: [CommonModule, FormsModule, EscudoComponent],
  template: `
    @if (bracket(); as b) {
      <div class="wrap">
        @if (yaCerro(b)) {
          <div class="aviso aviso--cerrado">
            <i class="ti ti-lock"></i>
            El pronóstico ya cerró. Aquí está el tuyo tal como quedó.
          </div>
        } @else {
          <p class="intro">
            Elige quién avanza en cada llave. Tus elecciones arman el camino
            hasta el campeón. Puedes cambiarlas hasta el cierre.
          </p>
        }

        @for (r of rondas(b); track r) {
          <section class="ronda">
            <h3>{{ nombre(r, b) }}</h3>

            @for (l of llavesDe(r); track l.id) {
              @if (l.local && l.visitante) {
                <div class="llave">
                  <button
                    class="opcion"
                    [class.opcion--elegida]="elegido(l.id) === l.local!.nombre"
                    [disabled]="yaCerro(b)"
                    (click)="elegir(l, l.local!.nombre)"
                  >
                    <span class="siembra">{{ l.local!.siembra }}</span>
                    <app-escudo [equipo]="l.local!.nombre" [size]="20" />
                    {{ l.local!.nombre }}
                  </button>

                  <span class="vs">vs</span>

                  <button
                    class="opcion"
                    [class.opcion--elegida]="elegido(l.id) === l.visitante!.nombre"
                    [disabled]="yaCerro(b)"
                    (click)="elegir(l, l.visitante!.nombre)"
                  >
                    <span class="siembra">{{ l.visitante!.siembra }}</span>
                    <app-escudo [equipo]="l.visitante!.nombre" [size]="20" />
                    {{ l.visitante!.nombre }}
                  </button>
                </div>
              } @else {
                <div class="llave llave--espera">
                  Elige primero los ganadores de la ronda anterior.
                </div>
              }
            }
          </section>
        }

        @if (campeon(); as c) {
          <div class="campeon">
            <span class="campeon-corona">🏆 Tu campeón</span>
            <app-escudo [equipo]="c" [size]="72" />
            <strong class="campeon-nom">{{ c }}</strong>
          </div>
        }

        @if (!yaCerro(b)) {
          <button
            class="btn btn--primary"
            [disabled]="!completo() || guardando()"
            (click)="guardar()"
          >
            {{ guardando() ? 'Guardando…' : completo() ? 'Guardar mi pronóstico' : 'Completa el cuadro' }}
          </button>
          @if (mensaje()) {
            <p class="aviso" [class.aviso--error]="error()">{{ mensaje() }}</p>
          }
        }
      </div>
    }
  `,
  styles: [
    `
      .wrap { padding: 4px 0 20px; }
      .intro { font-size: 13px; color: var(--text-secondary); margin: 0 0 16px; line-height: 1.5; }
      .aviso--cerrado {
        display: flex; align-items: center; gap: 8px; margin-bottom: 16px;
        padding: 11px 13px; border-radius: var(--radius);
        background: var(--surface-1); color: var(--text-secondary); font-size: 13px;
      }
      .ronda { margin-bottom: 20px; }
      .ronda h3 {
        font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
        color: var(--text-muted); margin: 0 0 10px;
      }
      .llave {
        display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
      }
      .llave--espera {
        font-size: 12px; color: var(--text-muted); font-style: italic;
        padding: 10px; border: 1px dashed var(--border); border-radius: var(--radius);
      }
      .opcion {
        flex: 1; display: flex; align-items: center; gap: 8px;
        padding: 11px 12px; cursor: pointer; text-align: left;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-1); color: var(--text-secondary); font-size: 13px;
      }
      .opcion:disabled { cursor: default; }
      .opcion--elegida {
        border-color: var(--accent-fill);
        background: var(--accent-bg); color: var(--accent-text); font-weight: 700;
      }
      .siembra {
        flex-shrink: 0; width: 18px; height: 18px; border-radius: 4px;
        display: flex; align-items: center; justify-content: center;
        font-size: 10px; font-weight: 700;
        background: var(--surface-2); color: var(--text-muted);
      }
      .opcion--elegida .siembra { background: rgba(255, 255, 255, 0.25); color: inherit; }
      .vs { font-size: 11px; color: var(--text-muted); flex-shrink: 0; }
      .campeon {
        margin: 4px 0 18px; padding: 18px 13px; border-radius: var(--radius);
        background: var(--accent-bg); color: var(--accent-text); text-align: center;
        display: flex; flex-direction: column; align-items: center; gap: 8px;
      }
      .campeon-corona { font-size: 13px; font-weight: 600; opacity: 0.85; }
      .campeon-nom { font-size: 18px; }
      .btn--primary {
        width: 100%; padding: 13px; cursor: pointer; font-size: 15px; font-weight: 600;
        border: none; border-radius: var(--radius); background: var(--accent-fill); color: #fff;
      }
      .btn--primary:disabled { opacity: 0.5; cursor: default; }
      .aviso { font-size: 13px; color: var(--success-text); margin: 10px 0 0; }
      .aviso--error { color: var(--danger-text); }
    `,
  ],
})
export class PronosticoBracketComponent {
  readonly bracket = input.required<Bracket>();

  private readonly service = inject(BracketsService);
  private readonly auth = inject(Auth);
  private readonly uid = toSignal(user(this.auth).pipe(map((u) => u?.uid ?? null)), {
    initialValue: null,
  });

  /** Mis elecciones: idLlave → nombre del equipo que puse a avanzar. */
  private readonly avances = signal<Record<string, string>>({});

  readonly guardando = signal(false);
  readonly mensaje = signal('');
  readonly error = signal(false);

  constructor() {
    // Precarga mi pronóstico previo si existe. Va en un effect porque
    // el input 'bracket' aún no tiene valor al construir el componente;
    // el effect corre cuando Angular ya lo pobló.
    let cargado = false;
    effect(() => {
      const b = this.bracket();
      const uid = this.uid();
      if (!uid || cargado) return;
      cargado = true;
      this.service.miPronostico(b.id, uid).subscribe((p) => {
        if (p?.avances) this.avances.set({ ...p.avances });
      });
    });
  }

  /** El cuadro con MIS elecciones propagadas ronda por ronda. */
  private readonly miCuadro = computed(() =>
    cuadroDelPronostico(this.bracket().llaves, this.avances(), this.bracket().config.avance),
  );

  readonly completo = computed(() =>
    pronosticoCompleto(this.bracket().llaves, this.avances(), this.bracket().config.avance),
  );

  readonly campeon = computed(() => {
    const total = rondasDe(this.bracket().config.equipos);
    const final = this.miCuadro().find((l) => l.ronda === total - 1);
    return final ? this.avances()[final.id] ?? null : null;
  });

  yaCerro(b: Bracket): boolean {
    return b.estado !== 'inscripcion';
  }

  rondas(b: Bracket): number[] {
    return Array.from({ length: rondasDe(b.config.equipos) }, (_, i) => i);
  }

  nombre(r: number, b: Bracket): string {
    return nombreRonda(r, rondasDe(b.config.equipos));
  }

  llavesDe(r: number): Llave[] {
    return this.miCuadro()
      .filter((l) => l.ronda === r)
      .sort((a, b) => a.posicion - b.posicion);
  }

  elegido(idLlave: string): string | undefined {
    return this.avances()[idLlave];
  }

  /** Elige un ganador. Si cambia respecto a antes, limpia lo que dependía de él. */
  elegir(llave: Llave, equipo: string): void {
    const actual = { ...this.avances() };
    if (actual[llave.id] === equipo) return;

    actual[llave.id] = equipo;

    // Al cambiar una llave, las rondas siguientes pueden quedar
    // inconsistentes: se borran para que el jugador las rehaga.
    const total = rondasDe(this.bracket().config.equipos);
    for (let r = llave.ronda + 1; r < total; r++) {
      this.miCuadro()
        .filter((l) => l.ronda === r)
        .forEach((l) => delete actual[l.id]);
    }

    this.avances.set(actual);
  }

  async guardar(): Promise<void> {
    this.guardando.set(true);
    this.mensaje.set('');
    this.error.set(false);
    try {
      // Fase 3: solo avances. Los marcadores llegan después.
      await this.service.guardarPronostico(this.bracket().id, this.avances(), null);
      this.mensaje.set('¡Listo! Tu pronóstico quedó guardado.');
    } catch (e: unknown) {
      this.error.set(true);
      this.mensaje.set((e as Error)?.message ?? 'No se pudo guardar.');
    } finally {
      this.guardando.set(false);
    }
  }
}