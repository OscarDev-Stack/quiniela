import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { BracketsService } from '../../core/services/brackets.service';
import { ToastService } from '../../shared/toast.service';
import { ContextoService } from '../../shared/contexto.service';
import { CuadroBracketComponent } from './cuadro-bracket.component';
import { ArmarBracketComponent } from './armar-bracket.component';
import { AsignarDuenosComponent } from './asignar-duenos.component';
import {
  Bracket,
  Llave,
  nombreRonda,
  rondasDe,
} from '../../core/models/bracket.model';

/**
 * Administración de brackets: crear el cuadro y capturar resultados.
 * Fase 2 — sin pronósticos todavía; eso llega en la 3.
 */
@Component({
  selector: 'app-gestionar-brackets',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CuadroBracketComponent,
    ArmarBracketComponent,
    AsignarDuenosComponent,
  ],
  template: `
    <div class="wrap">
      <h1>Eliminatorias</h1>

      <a class="btn btn--primary ancho-crear" routerLink="/admin/brackets/crear">
        <i class="ti ti-plus"></i> Crear eliminatoria
      </a>

      <!-- Lista y captura -->
      @for (b of brackets(); track b.id) {
        <section class="panel">
          <button class="cab" (click)="abrir(b.id)">
            <i class="ti" [class.ti-chevron-down]="abierto() !== b.id" [class.ti-chevron-up]="abierto() === b.id"></i>
            <span class="cab-txt">
              <span class="cab-nom">
                {{ b.nombre }}
                <span class="badge">{{ etiqueta(b.estado) }}</span>
              </span>
              <span class="cab-sub">
                {{ b.modo === 'duenos' ? 'Dueños' : 'Pronóstico' }}
                · {{ b.config.equipos }} equipos
                · {{ b.costoEntrada | number }} pts
                @if (b.publico) { · Pública }
              </span>
            </span>
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

            <!-- Resumen de configuración -->
            <div class="resumen-cfg">
              <span class="dato"><i class="ti ti-dice"></i> {{ b.modo === 'duenos' ? 'Dueños' : 'Pronóstico' }}</span>
              <span class="dato"><i class="ti ti-users"></i> {{ b.config.equipos }} equipos</span>
              <span class="dato"><i class="ti ti-coins"></i> Entrada: {{ b.costoEntrada | number }} pts</span>
              <span class="dato"><i class="ti ti-trophy"></i> Bolsa: {{ b.bolsa | number }} pts</span>
              @if (fechaCierre(b); as fc) {
                <span class="dato"><i class="ti ti-clock"></i> {{ b.modo === 'duenos' ? 'Cierre/inicio' : 'Cierra' }}: {{ fc }}</span>
              }
              @if (b.publico) { <span class="dato"><i class="ti ti-world"></i> Pública</span> }
              @if (b.ganadorAlias) { <span class="dato dato--gana"><i class="ti ti-crown"></i> {{ b.ganadorAlias }}</span> }
            </div>

            <!-- Participantes / dueños -->
            @if (b.modo === 'duenos') {
              <button class="part-cab" (click)="alternarParts(b.id)">
                <i class="ti" [class.ti-chevron-down]="!partsVisibles(b.id)" [class.ti-chevron-up]="partsVisibles(b.id)"></i>
                <strong>Participantes</strong>
                <span class="sub">{{ aceptadosDe(b) }} aceptaron de {{ (b.duenos ?? []).length }} asignados</span>
              </button>
              @if (partsVisibles(b.id)) {
                @if ((b.duenos ?? []).length === 0) {
                  <p class="sub">Aún no asignas equipos.</p>
                }
                @for (d of b.duenos ?? []; track d.equipo) {
                  <div class="part">
                    <span class="part-alias">{{ d.equipo }} → {{ d.nombre }}</span>
                    <span class="part-datos">
                      @if (d.estado === 'aceptado') { <span class="part-estado ok">aceptó</span> }
                      @else if (d.estado === 'invitado') { <span class="part-estado pend">pendiente</span> }
                      @else { <span class="part-estado">invitado</span> }
                    </span>
                  </div>
                }
              }
            }

            @if (b.estado === 'armando') {
              <h3 class="sub">Arma los cruces de la primera ronda</h3>
              <app-armar-bracket [bracket]="b" />
            } @else {
              <app-cuadro-bracket [bracket]="b" />
            }

            @if (b.modo === 'duenos' && (b.estado === 'inscripcion' || b.estado === 'armando')) {
              <h3 class="sub">Asigna los equipos a los participantes</h3>
              <app-asignar-duenos [bracket]="b" />
            }

            @if (b.estado === 'finalizado' && !b.premioPagado) {
              <button class="btn btn--primary calif" [disabled]="calificando()" (click)="calificar(b)">
                {{ calificando() ? 'Calificando…' : 'Calificar y repartir la bolsa' }}
              </button>
            }
            @if (b.premioPagado) {
              <p class="aviso">Ya calificada. Ganó {{ b.ganadorAlias }}.</p>
            }

            @if (b.estado === 'en-curso') {
              <h3 class="sub">Capturar resultados</h3>
            }
            @if (b.estado === 'en-curso') {
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
          }
        </section>
      }

      <!-- Modal: elegir ganador de penales en un empate -->
      @if (penalesPend(); as p) {
        <div class="pen-fondo" (click)="penalesPend.set(null)"></div>
        <div class="pen-modal">
          <h3 class="pen-tit">Empate en penales</h3>
          <p class="pen-sub">Terminaron {{ p.gl }} – {{ p.gv }}. ¿Quién ganó en la tanda?</p>
          <div class="pen-botones">
            <button class="pen-btn" (click)="resolverPenales('local')">
              {{ localDe(p.l, p.l.partidos[p.indice].tipo) }}
            </button>
            <button class="pen-btn" (click)="resolverPenales('visitante')">
              {{ visitanteDe(p.l, p.l.partidos[p.indice].tipo) }}
            </button>
          </div>
          <button class="pen-cancelar" (click)="penalesPend.set(null)">Cancelar</button>
        </div>
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
        display: flex; align-items: center; gap: 10px; width: 100%;
        cursor: pointer; text-align: left; background: transparent; border: none;
        padding: 0; color: inherit;
      }
      .cab i { color: var(--text-muted); font-size: 17px; flex-shrink: 0; }
      .cab-txt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .cab-nom { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; }
      .cab-sub { font-size: 12px; font-weight: 400; color: var(--text-muted); }
      .badge {
        font-size: 11px; font-weight: 600; padding: 2px 9px;
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
      .ancho-crear {
        display: flex; align-items: center; justify-content: center; gap: 6px;
        width: 100%; text-decoration: none; margin-bottom: 18px;
      }

      .pen-fondo {
        position: fixed; inset: 0; z-index: 2000;
        background: rgba(0, 0, 0, 0.6);
      }
      .pen-modal {
        position: fixed; z-index: 2001; left: 50%; top: 50%;
        transform: translate(-50%, -50%);
        width: calc(100vw - 40px); max-width: 360px;
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 16px; padding: 22px 20px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
      }
      .pen-tit { font-size: 18px; font-weight: 700; margin: 0 0 6px; }
      .pen-sub { font-size: 14px; color: var(--text-secondary); margin: 0 0 18px; }
      .pen-botones { display: flex; flex-direction: column; gap: 10px; }
      .pen-btn {
        width: 100%; padding: 14px; border-radius: var(--radius);
        border: 1px solid var(--accent-fill); background: var(--accent-bg);
        color: var(--accent-text); font-size: 15px; font-weight: 600; cursor: pointer;
      }
      .pen-btn:hover { background: var(--accent-fill); color: #fff; }
      .pen-cancelar {
        width: 100%; margin-top: 12px; padding: 10px; border: none; background: none;
        color: var(--text-muted); font-size: 14px; cursor: pointer;
      }
      .btn.sm { padding: 7px 12px; font-size: 13px; }
      .btn:disabled { opacity: 0.5; }
      .aviso { font-size: 13px; color: var(--text-secondary); margin: 8px 0 0; }
      .aviso--error { color: var(--danger-text); }
      .invitar { display: flex; align-items: center; gap: 10px; margin: 10px 0 14px; }

      /* Resumen de configuración */
      .resumen-cfg { display: flex; flex-wrap: wrap; gap: 7px; margin: 0 0 14px; }
      .resumen-cfg .dato {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 12px; padding: 5px 10px; border-radius: 999px;
        background: var(--surface-1); color: var(--text-secondary);
      }
      .resumen-cfg .dato i { font-size: 14px; }
      .resumen-cfg .dato--gana { background: var(--accent-bg); color: var(--accent-text); font-weight: 600; }

      /* Participantes / dueños */
      .part-cab {
        display: flex; align-items: center; gap: 8px; width: 100%;
        background: transparent; border: none; cursor: pointer; padding: 8px 0;
        color: var(--text-primary); font-size: 14px; text-align: left;
      }
      .part-cab .sub { font-size: 12px; font-weight: 400; color: var(--text-muted); margin: 0 0 0 auto; }
      .part {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 8px 10px; border-radius: var(--radius); background: var(--surface-1); margin-bottom: 5px;
      }
      .part-alias { font-size: 13px; font-weight: 600; color: var(--text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .part-datos { flex-shrink: 0; }
      .part-estado { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: var(--surface-2); color: var(--text-muted); }
      .part-estado.ok { background: var(--success-bg); color: var(--success-text); }
      .part-estado.pend { background: var(--warning-bg); color: var(--warning-text); }
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
export class GestionarBracketsComponent {
  private readonly service = inject(BracketsService);
  private readonly toast = inject(ToastService);
  private readonly contexto = inject(ContextoService);

  private readonly todos = toSignal(this.service.brackets(), { initialValue: [] as Bracket[] });

  /** Eliminatorias del contexto activo (Global o el grupo elegido). */
  readonly brackets = computed(() => {
    const ctx = this.contexto.grupoId();
    return this.todos().filter((b) => (b.grupoId ?? null) === ctx);
  });
  readonly abierto = signal<string | null>(null);
  readonly copiado = signal<string | null>(null);
  /** Qué paneles de participantes están desplegados (por id de bracket). */
  private readonly partsAbiertos = signal<Set<string>>(new Set());
  readonly creando = signal(false);
  readonly calificando = signal(false);

  /** Marcadores en captura, indexados por llave-partido-lado. */
  marc: Record<string, number | null> = {};

  /** ¿Está desplegado el panel de participantes de este bracket? */
  partsVisibles(id: string): boolean {
    return this.partsAbiertos().has(id);
  }

  alternarParts(id: string): void {
    this.partsAbiertos.update((set) => {
      const nuevo = new Set(set);
      nuevo.has(id) ? nuevo.delete(id) : nuevo.add(id);
      return nuevo;
    });
  }

  /** Cuántos dueños ya aceptaron (modo dueños). */
  aceptadosDe(b: Bracket): number {
    return (b.duenos ?? []).filter((d) => d.estado === 'aceptado').length;
  }

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

  /** Fecha de cierre/inicio del bracket, formateada. Null si no tiene. */
  fechaCierre(b: Bracket): string | null {
    const v = b.cierraAt as { seconds?: number } | Date | null | undefined;
    if (!v) return null;
    const d = v instanceof Date ? v : new Date((v.seconds ?? 0) * 1000);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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

  /** Traduce la escala elegida a los valores de puntos. */
  async calificar(b: Bracket): Promise<void> {
    this.calificando.set(true);
    try {
      const r = await this.service.calificar(b.id);
      this.toast.exito(`Calificados ${r.calificados} pronósticos. Bolsa repartida.`);
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo calificar.');
    } finally {
      this.calificando.set(false);
    }
  }

  async guardar(b: Bracket, l: Llave, indice: number): Promise<void> {
    const gl = Number(this.marc[`${l.id}-${indice}-L`] ?? NaN);
    const gv = Number(this.marc[`${l.id}-${indice}-V`] ?? NaN);
    if (!Number.isInteger(gl) || !Number.isInteger(gv)) {
      this.toast.error('Pon ambos marcadores antes de guardar.');
      return;
    }

    // ¿Empate que necesita penales? Al capturar el ÚLTIMO partido de la llave
    // se calcula el GLOBAL (ida + vuelta). Si el global empata y el desempate
    // es penales, hay que preguntar quién ganó la tanda. Antes solo se miraba
    // el marcador de ese partido, así que un global empatado con la vuelta no
    // empatada (ej: 1-2 y 2-1) no disparaba el modal y la llave no resolvía.
    const esFinal = l.ronda === rondasDe(b.config.equipos) - 1;
    const desempate = esFinal ? b.config.desempateFinal : b.config.desempateRondas;
    const esUltimo = indice === l.partidos.length - 1;
    if (esUltimo && desempate === 'penales' && this.globalEmpata(l, indice, gl, gv)) {
      // En vez de un prompt(), abrimos un modal para elegir quién ganó en
      // penales, mostrando los nombres reales de los equipos.
      this.penalesPend.set({ b, l, indice, gl, gv });
      return;
    }

    await this.guardarCaptura(b, l, indice, gl, gv, null);
  }

  /**
   * Suma el marcador global de la llave (ida + vuelta), usando el marcador
   * recién capturado para el partido `indice`, y dice si quedó empatado.
   * En la vuelta, local y visitante se invierten (el de casa es el visitante
   * de la ida). Un partido único simplemente compara ese marcador.
   */
  private globalEmpata(l: Llave, indice: number, gl: number, gv: number): boolean {
    let local = 0;
    let visitante = 0;
    for (let i = 0; i < l.partidos.length; i++) {
      const p = l.partidos[i];
      // Para el partido que se está capturando ahora, usa los goles nuevos.
      const golesL = i === indice ? gl : p.golesLocal;
      const golesV = i === indice ? gv : p.golesVisitante;
      if (typeof golesL !== 'number' || typeof golesV !== 'number') return false;
      if (p.tipo === 'vuelta') {
        local += golesV;
        visitante += golesL;
      } else {
        local += golesL;
        visitante += golesV;
      }
    }
    return local === visitante;
  }

  /** Estado del modal de penales (empate en el último partido de una llave). */
  readonly penalesPend = signal<{
    b: Bracket;
    l: Llave;
    indice: number;
    gl: number;
    gv: number;
  } | null>(null);

  /** El usuario eligió al ganador de penales en el modal. */
  async resolverPenales(quien: 'local' | 'visitante'): Promise<void> {
    const p = this.penalesPend();
    if (!p) return;
    this.penalesPend.set(null);
    await this.guardarCaptura(p.b, p.l, p.indice, p.gl, p.gv, quien);
  }

  /** Guarda la captura del marcador (con o sin ganador de penales). */
  private async guardarCaptura(
    b: Bracket,
    l: Llave,
    indice: number,
    gl: number,
    gv: number,
    penales: 'local' | 'visitante' | null,
  ): Promise<void> {
    try {
      await this.service.capturar(b.id, l.id, indice, gl, gv, penales);
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo guardar.');
    }
  }
}