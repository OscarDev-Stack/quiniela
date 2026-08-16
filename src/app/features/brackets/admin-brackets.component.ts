import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { BracketsService } from '../../core/services/brackets.service';
import { CuadroBracketComponent } from './cuadro-bracket.component';
import {
  Bracket,
  Llave,
  EquipoBracket,
  nombreRonda,
  rondasDe,
} from '../../core/models/bracket.model';

/**
 * Administración de brackets: crear el cuadro y capturar resultados.
 * Fase 2 — sin pronósticos todavía; eso llega en la 3.
 */
@Component({
  selector: 'app-admin-brackets',
  standalone: true,
  imports: [CommonModule, FormsModule, CuadroBracketComponent],
  template: `
    <div class="wrap">
      <h1>Eliminatorias</h1>

      <!-- Crear -->
      <section class="panel">
        <button class="cab" (click)="verCrear.set(!verCrear())">
          <i class="ti" [class.ti-chevron-down]="!verCrear()" [class.ti-chevron-up]="verCrear()"></i>
          Nueva eliminatoria
        </button>

        @if (verCrear()) {
          <div class="form">
            <label class="field">
              <span>Nombre</span>
              <input [(ngModel)]="nuevo.nombre" placeholder="Liguilla Apertura 2026" />
            </label>

            <label class="field">
              <span>Equipos</span>
              <select [(ngModel)]="nuevo.equipos">
                <option [ngValue]="4">4 equipos</option>
                <option [ngValue]="8">8 equipos</option>
                <option [ngValue]="16">16 equipos</option>
              </select>
            </label>

            <label class="field">
              <span>Cómo se arma</span>
              <select [(ngModel)]="nuevo.armado">
                <option value="siembra">Por posición (1°vs8°)</option>
                <option value="manual">Cruces a mano</option>
              </select>
            </label>

            <label class="field">
              <span>Cruces en cada ronda</span>
              <select [(ngModel)]="nuevo.avance">
                <option value="reordena">Reordena: mejor vs peor (liguilla)</option>
                <option value="fijo">Cruces fijos del cuadro (Champions)</option>
              </select>
            </label>

            <label class="field">
              <span>Rondas</span>
              <select [(ngModel)]="nuevo.formatoRondas">
                <option value="ida-vuelta">Ida y vuelta</option>
                <option value="unico">Partido único</option>
              </select>
            </label>

            <label class="field">
              <span>Final</span>
              <select [(ngModel)]="nuevo.formatoFinal">
                <option value="ida-vuelta">Ida y vuelta</option>
                <option value="unico">Partido único</option>
              </select>
            </label>

            <label class="field">
              <span>Desempate en rondas</span>
              <select [(ngModel)]="nuevo.desempateRondas">
                <option value="mejor-sembrado">Mejor posicionado avanza</option>
                <option value="penales">Prórroga y penales</option>
              </select>
            </label>

            <label class="field">
              <span>Desempate en la final</span>
              <select [(ngModel)]="nuevo.desempateFinal">
                <option value="penales">Prórroga y penales</option>
                <option value="mejor-sembrado">Mejor posicionado avanza</option>
              </select>
            </label>

            <label class="field field--ancho">
              <span>Cierre de pronósticos</span>
              <input type="datetime-local" [(ngModel)]="nuevo.cierre" />
              <small class="pista">
                A esa hora se congela el cuadro. Ponla antes del primer partido.
              </small>
            </label>

            <label class="switch">
              <span class="switch-texto">
                Eliminatoria pública
                <small class="pista">
                  Aparece en el inicio y cualquiera puede unirse sin invitación.
                  Si la dejas privada, solo entra quien tenga el enlace.
                </small>
              </span>
              <input type="checkbox" class="switch-input" [(ngModel)]="nuevo.publico" />
              <span class="switch-pista" aria-hidden="true"></span>
            </label>

            <label class="field">
              <span>Costo de entrada (puntos)</span>
              <select [(ngModel)]="nuevo.costoEntrada">
                <option [ngValue]="0">Gratis</option>
                <option [ngValue]="50">50 pts</option>
                <option [ngValue]="100">100 pts</option>
                <option [ngValue]="200">200 pts</option>
                <option [ngValue]="500">500 pts</option>
              </select>
            </label>

            <label class="field">
              <span>Reparto de la bolsa</span>
              <select [(ngModel)]="nuevo.reparto">
                <option value="100">Todo al campeón</option>
                <option value="80,20">80% / 20% (1° y 2°)</option>
                <option value="70,20,10">70% / 20% / 10%</option>
              </select>
            </label>

            <label class="field">
              <span>Escala de puntos</span>
              <select [(ngModel)]="nuevo.escala">
                <option value="normal">Normal (10 · 20 · 40, campeón +30)</option>
                <option value="final">Más peso a la final (10 · 25 · 60, campeón +50)</option>
                <option value="pareja">Pareja (15 · 20 · 30, campeón +20)</option>
              </select>
              <small class="pista">Los puntos suben por ronda; el campeón da el bono mayor.</small>
            </label>



            <label class="field field--ancho">
              <span>Equipos (uno por línea, del 1° al último por posición)</span>
              <textarea
                rows="8"
                [(ngModel)]="nuevo.listaEquipos"
                placeholder="América&#10;Tigres&#10;Rayados&#10;Chivas&#10;…"
              ></textarea>
            </label>

            <div class="acciones-crear">
              <button class="btn btn--primary" [disabled]="creando()" (click)="crear()">
                {{ creando() ? 'Creando…' : 'Crear eliminatoria' }}
              </button>
              @if (mensaje()) {
                <p class="aviso" [class.aviso--error]="error()">{{ mensaje() }}</p>
              }
            </div>
          </div>
        }
      </section>

      <!-- Lista y captura -->
      @for (b of brackets(); track b.id) {
        <section class="panel">
          <button class="cab" (click)="abrir(b.id)">
            <i class="ti" [class.ti-chevron-down]="abierto() !== b.id" [class.ti-chevron-up]="abierto() === b.id"></i>
            {{ b.nombre }}
            <span class="badge">{{ etiqueta(b.estado) }}</span>
          </button>

          @if (abierto() === b.id) {
            <div class="invitar">
              <p class="codigo">
                Código: <strong>{{ b.codigo }}</strong>
              </p>
              <button class="btn sm" (click)="copiar(b)">
                {{ copiado() === b.id ? '¡Copiado!' : 'Copiar enlace' }}
              </button>
            </div>

            <app-cuadro-bracket [bracket]="b" />

            @if (b.estado === 'finalizado' && !b.premioPagado) {
              <button class="btn btn--primary calif" [disabled]="calificando()" (click)="calificar(b)">
                {{ calificando() ? 'Calificando…' : 'Calificar y repartir la bolsa' }}
              </button>
            }
            @if (b.premioPagado) {
              <p class="aviso">Ya calificada. Ganó {{ b.ganadorAlias }}.</p>
            }

            @if (b.estado !== 'finalizado') {
              <h3 class="sub">Capturar resultados</h3>
            }
            @for (l of jugables(b); track l.id) {
              <div class="captura">
                <div class="captura-cab">
                  {{ nombre(l, b) }} ·
                  <strong>{{ l.local?.nombre }}</strong> vs <strong>{{ l.visitante?.nombre }}</strong>
                </div>

                @for (p of l.partidos; track $index) {
                  <div class="partido">
                    <div class="partido-cab">
                      <span class="tipo">{{ etiquetaPartido(p.tipo) }}</span>
                      @if (estaCapturado(p)) {
                        <span class="check-ok"><i class="ti ti-check"></i> Guardado</span>
                      }
                    </div>

                    <!-- En la vuelta se invierte la localía: el visitante juega en casa. -->
                    <div class="marcador">
                      <span class="eq-nom">{{ localDe(l, p.tipo) }}</span>
                      <input type="number" min="0" [(ngModel)]="marc[l.id + '-' + $index + '-L']" placeholder="0" />
                      <span class="sep">-</span>
                      <input type="number" min="0" [(ngModel)]="marc[l.id + '-' + $index + '-V']" placeholder="0" />
                      <span class="eq-nom eq-nom--der">{{ visitanteDe(l, p.tipo) }}</span>
                    </div>

                    <button class="btn sm partido-btn" (click)="guardar(b, l, $index)">
                      {{ estaCapturado(p) ? 'Actualizar' : 'Guardar' }}
                    </button>
                  </div>
                }
              </div>
            } @empty {
              <p class="aviso">No hay llaves listas para capturar. Se van abriendo conforme avanzan las rondas.</p>
            }
          }
        </section>
      }
    </div>
  `,
  styles: [
    `
      .wrap { padding: 18px 16px 40px; }
      h1 { font-size: 20px; font-weight: 700; margin: 0 0 16px; }
      .panel {
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 12px; padding: 14px 16px; margin-bottom: 14px;
      }
      .cab {
        display: flex; align-items: center; gap: 8px; width: 100%;
        cursor: pointer; text-align: left; background: transparent; border: none;
        padding: 0; color: inherit; font-size: 15px; font-weight: 600;
      }
      .cab i { color: var(--text-muted); font-size: 17px; }
      .badge {
        margin-left: auto; font-size: 11px; font-weight: 600; padding: 2px 9px;
        border-radius: 999px; background: var(--surface-1); color: var(--text-secondary);
      }
      .form { margin-top: 14px; display: grid; gap: 12px; }
      .field { display: block; }
      .field--ancho { grid-column: 1 / -1; }
      .acciones-crear { grid-column: 1 / -1; }
      .acciones-crear .btn--primary { width: 100%; }
      .field span { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 5px; }
      .field input, .field select, .field textarea {
        width: 100%; min-height: 42px; padding: 9px 11px; font-size: 14px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-1); color: var(--text-primary);
      }
      .field textarea { min-height: auto; font-family: inherit; resize: vertical; }
      .btn {
        padding: 10px 16px; border-radius: var(--radius); cursor: pointer;
        font-size: 14px; font-weight: 600;
        border: 1px solid var(--border); background: var(--surface-1); color: var(--text-primary);
      }
      .btn--primary { background: var(--accent-fill); color: #fff; border-color: transparent; }
      .btn.sm { padding: 7px 12px; font-size: 13px; }
      .btn:disabled { opacity: 0.5; }
      .aviso { font-size: 13px; color: var(--text-secondary); margin: 8px 0 0; }
      .aviso--error { color: var(--danger-text); }
      .invitar { display: flex; align-items: center; gap: 10px; margin: 10px 0 14px; }
      .codigo { font-size: 13px; color: var(--text-secondary); margin: 0; }
      .sub { font-size: 14px; font-weight: 600; margin: 18px 0 10px; }
      .captura { border-top: 1px solid var(--border); padding: 12px 0; }
      .captura-cab { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
      .pista { display: block; font-size: 11px; color: var(--text-muted); margin-top: 4px; }
      .partido {
        border: 1px solid var(--border); border-radius: var(--radius);
        padding: 10px; margin-bottom: 8px; background: var(--surface-1);
      }
      .partido-cab { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      .tipo { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; }
      /* Rejilla fija: nombre | casilla | guion | casilla | nombre.
         Las casillas quedan siempre centradas, sin importar el largo
         de los nombres, que se recortan con puntos suspensivos. */
      .marcador {
        display: grid;
        grid-template-columns: 1fr 48px 12px 48px 1fr;
        align-items: center; gap: 8px;
      }
      .partido input {
        width: 48px; text-align: center; padding: 8px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-primary); font-size: 15px;
      }
      .sep { color: var(--text-muted); text-align: center; }
      .eq-nom {
        font-size: 13px; color: var(--text-secondary);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .eq-nom--der { text-align: left; }
      .partido-btn { width: 100%; margin-top: 10px; }
      .check-ok { color: var(--success-text); font-size: 12px; font-weight: 600; }
      .calif { width: 100%; margin: 6px 0 12px; }
      .switch {
        display: flex; align-items: flex-start; justify-content: space-between; gap: 14px;
        cursor: pointer; margin-top: 4px;
      }
      .switch-texto { flex: 1; font-size: 14px; }
      .switch-input { position: absolute; opacity: 0; width: 0; height: 0; }
      .switch-pista {
        position: relative; flex-shrink: 0; margin-top: 2px;
        width: 46px; height: 26px; border-radius: 999px;
        background: var(--surface-1); border: 1px solid var(--border);
        transition: background 0.18s ease, border-color 0.18s ease;
      }
      .switch-pista::after {
        content: ''; position: absolute; top: 2px; left: 2px;
        width: 20px; height: 20px; border-radius: 50%;
        background: var(--text-muted); transition: transform 0.18s ease, background 0.18s ease;
      }
      .switch-input:checked + .switch-pista { background: var(--accent-fill); border-color: transparent; }
      .switch-input:checked + .switch-pista::after { transform: translateX(20px); background: #fff; }
      @media (prefers-reduced-motion: reduce) { .switch-pista, .switch-pista::after { transition: none; } }
    `,
  ],
})
export class AdminBracketsComponent {
  private readonly service = inject(BracketsService);
  readonly brackets = toSignal(this.service.brackets(), { initialValue: [] as Bracket[] });

  readonly verCrear = signal(false);
  readonly abierto = signal<string | null>(null);
  readonly copiado = signal<string | null>(null);
  readonly creando = signal(false);
  readonly calificando = signal(false);
  readonly mensaje = signal('');
  readonly error = signal(false);

  /** Marcadores en captura, indexados por llave-partido-lado. */
  marc: Record<string, number | null> = {};

  nuevo = {
    nombre: '',
    equipos: 8,
    armado: 'siembra' as 'siembra' | 'manual',
    avance: 'reordena' as 'reordena' | 'fijo',
    formatoRondas: 'ida-vuelta' as 'ida-vuelta' | 'unico',
    formatoFinal: 'unico' as 'ida-vuelta' | 'unico',
    desempateRondas: 'mejor-sembrado' as 'mejor-sembrado' | 'penales',
    desempateFinal: 'penales' as 'mejor-sembrado' | 'penales',
    reparto: '80,20',
    escala: 'normal' as 'normal' | 'final' | 'pareja',
    publico: false,
    costoEntrada: 100,
    cierre: '',
    listaEquipos: '',
  };

  abrir(id: string): void {
    const nuevo = this.abierto() === id ? null : id;
    this.abierto.set(nuevo);
    // Precargar las casillas con lo ya capturado, para no verlas vacías.
    if (nuevo) {
      const b = this.brackets().find((x) => x.id === id);
      b?.llaves.forEach((l) =>
        l.partidos.forEach((p, i) => {
          if (typeof p.golesLocal === 'number') this.marc[`${l.id}-${i}-L`] = p.golesLocal;
          if (typeof p.golesVisitante === 'number') this.marc[`${l.id}-${i}-V`] = p.golesVisitante;
        }),
      );
    }
  }

  /** Copia el enlace para que el jugador entre directo a pronosticar. */
  copiar(b: Bracket): void {
    const url = `${location.origin}/eliminatorias/${b.id}`;
    navigator.clipboard?.writeText(url);
    this.copiado.set(b.id);
    setTimeout(() => this.copiado.set(null), 1500);
  }

  etiqueta(estado: string): string {
    const m: Record<string, string> = {
      armando: 'Armando',
      inscripcion: 'Inscripción',
      'en-curso': 'En curso',
      finalizado: 'Finalizado',
    };
    return m[estado] ?? estado;
  }

  etiquetaPartido(tipo: string): string {
    return tipo === 'ida' ? 'Ida' : tipo === 'vuelta' ? 'Vuelta' : 'Único';
  }

  /** Quién juega de local en este partido (en la vuelta se invierte). */
  localDe(l: Llave, tipo: string): string {
    return tipo === 'vuelta' ? (l.visitante?.nombre ?? '') : (l.local?.nombre ?? '');
  }
  visitanteDe(l: Llave, tipo: string): string {
    return tipo === 'vuelta' ? (l.local?.nombre ?? '') : (l.visitante?.nombre ?? '');
  }

  /** ¿Ya se capturó este partido? */
  estaCapturado(p: { golesLocal?: number | null; golesVisitante?: number | null }): boolean {
    return typeof p.golesLocal === 'number' && typeof p.golesVisitante === 'number';
  }

  nombre(l: Llave, b: Bracket): string {
    return nombreRonda(l.ronda, rondasDe(b.config.equipos));
  }

  /** Llaves con ambos equipos y aún sin ganador: las que se pueden capturar. */
  jugables(b: Bracket): Llave[] {
    return b.llaves
      .filter((l) => l.local && l.visitante && !l.ganador)
      .sort((a, c) => a.ronda - c.ronda || a.posicion - c.posicion);
  }

  async crear(): Promise<void> {
    const equipos: EquipoBracket[] = this.nuevo.listaEquipos
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((nombre, i) => ({ nombre, siembra: i + 1 }));

    if (this.nuevo.armado === 'siembra' && equipos.length !== this.nuevo.equipos) {
      this.error.set(true);
      this.mensaje.set(`Con el orden por posición necesitas exactamente ${this.nuevo.equipos} equipos.`);
      return;
    }

    this.creando.set(true);
    this.mensaje.set('');
    this.error.set(false);
    try {
      await this.service.crear({
        nombre: this.nuevo.nombre.trim(),
        config: {
          equipos: this.nuevo.equipos,
          armado: this.nuevo.armado,
          avance: this.nuevo.avance,
          formatoRondas: this.nuevo.formatoRondas,
          formatoFinal: this.nuevo.formatoFinal,
          desempateRondas: this.nuevo.desempateRondas,
          desempateFinal: this.nuevo.desempateFinal,
          reparto: this.nuevo.reparto.split(',').map(Number),
        },
        puntaje: this.puntajeDeEscala(),
        equipos,
        costoEntrada: Number(this.nuevo.costoEntrada),
        cierraAt: this.nuevo.cierre ? new Date(this.nuevo.cierre) : null,
        publico: this.nuevo.publico,
      });
      this.mensaje.set('Eliminatoria creada.');
      this.nuevo.nombre = '';
      this.nuevo.listaEquipos = '';
      this.nuevo.cierre = '';
    } catch (e: unknown) {
      this.error.set(true);
      this.mensaje.set((e as Error)?.message ?? 'No se pudo crear.');
    } finally {
      this.creando.set(false);
    }
  }

  /** Traduce la escala elegida a los valores de puntos. */
  private puntajeDeEscala() {
    const escalas = {
      normal: { avanzaPorRonda: [10, 20, 40, 60], campeon: 30, finalista: 15 },
      final: { avanzaPorRonda: [10, 25, 60, 120], campeon: 50, finalista: 20 },
      pareja: { avanzaPorRonda: [15, 20, 30, 45], campeon: 20, finalista: 12 },
    };
    const e = escalas[this.nuevo.escala];
    return {
      ...e,
      // El pronóstico de marcador está fuera por ahora: sin bonos.
      marcadorExacto: 0,
      marcadorResultado: 0,
    };
  }

  async calificar(b: Bracket): Promise<void> {
    this.calificando.set(true);
    this.mensaje.set('');
    this.error.set(false);
    try {
      const r = await this.service.calificar(b.id);
      this.mensaje.set(`Calificados ${r.calificados} pronósticos. Bolsa repartida.`);
    } catch (e: unknown) {
      this.error.set(true);
      this.mensaje.set((e as Error)?.message ?? 'No se pudo calificar.');
    } finally {
      this.calificando.set(false);
    }
  }

  async guardar(b: Bracket, l: Llave, indice: number): Promise<void> {
    const gl = Number(this.marc[`${l.id}-${indice}-L`] ?? Number.NaN);
    const gv = Number(this.marc[`${l.id}-${indice}-V`] ?? Number.NaN);
    if (!Number.isInteger(gl) || !Number.isInteger(gv)) {
      this.error.set(true);
      this.mensaje.set('Pon ambos marcadores antes de guardar.');
      return;
    }

    // ¿Empate que necesita penales? Solo si es el último partido de la llave.
    let penales: 'local' | 'visitante' | null = null;
    const esFinal = l.ronda === rondasDe(b.config.equipos) - 1;
    const desempate = esFinal ? b.config.desempateFinal : b.config.desempateRondas;
    const esUltimo = indice === l.partidos.length - 1;
    if (gl === gv && esUltimo && desempate === 'penales') {
      const q = prompt('Empataron. ¿Quién ganó en penales? Escribe "local" o "visitante":');
      if (q === 'local' || q === 'visitante') penales = q;
    }

    try {
      await this.service.capturar(b.id, l.id, indice, gl, gv, penales);
    } catch (e: unknown) {
      this.error.set(true);
      this.mensaje.set((e as Error)?.message ?? 'No se pudo guardar.');
    }
  }
}