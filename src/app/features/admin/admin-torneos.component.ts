import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { TorneosService } from '../../core/services/torneos.service';
import { Torneo, Participante, ModoTorneo } from '../../core/models/torneo.model';
import { Competicion } from '../../core/models/competicion.model';
import { CompeticionesService } from '../../core/services/competiciones.service';
import { ConfirmarService } from '../../shared/confirmar.service';

@Component({
  selector: 'app-admin-torneos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (mensaje()) {
      <div class="msg" (click)="mensaje.set('')">
        <i class="ti ti-info-circle"></i> {{ mensaje() }}
      </div>
    }

    <div class="stats">
      <div class="stat">
        <div class="stat-label">Torneos</div>
        <div class="stat-val">{{ torneos().length }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">En curso</div>
        <div class="stat-val">{{ enCurso() }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Inscripciones</div>
        <div class="stat-val">{{ enInscripcion() }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Jugadores</div>
        <div class="stat-val">{{ totalJugadores() }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">En bolsas</div>
        <div class="stat-val accent">{{ totalBolsas() | number }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Finalizados</div>
        <div class="stat-val">{{ finalizados() }}</div>
      </div>
    </div>

    <section class="panel">
      <h2>Crear torneo</h2>
      <div class="grid">
        <label class="field">
          <span>Nombre</span>
          <input type="text" [(ngModel)]="form.nombre" placeholder="Los del jueves, La Oficina…" />
          <small class="pista">Como le van a decir entre ustedes.</small>
        </label>
        <label class="field">
          <span>Modo de juego</span>
          <select [(ngModel)]="form.modo">
            <option value="supervivencia">Supervivencia</option>
            <option value="quiniela">Quiniela por puntos</option>
          </select>
        </label>
        @if (form.modo === 'quiniela') {
          <label class="field">
            <span>Jornadas que dura</span>
            <input type="number" min="1" max="20" [(ngModel)]="form.jornadas" />
          </label>
        } @else {
          <label class="field">
            <span>Vidas por jugador</span>
            <select [(ngModel)]="form.vidas">
              <option [ngValue]="0">Sin vidas (un tropiezo y fuera)</option>
              <option [ngValue]="1">1 vida</option>
              <option [ngValue]="2">2 vidas</option>
              <option [ngValue]="3">3 vidas</option>
            </select>
          </label>

          @if (form.vidas > 0) {
            <label class="field">
              <span>¿Qué salva una vida?</span>
              <select [(ngModel)]="form.vidaCubre">
                <option value="empate">Solo empates</option>
                <option value="tropiezo">Empates y derrotas</option>
              </select>
              <small class="pista">
                @if (form.vidaCubre === 'empate') {
                  El empate gasta una vida; la derrota siempre elimina.
                } @else {
                  Cualquier tropiezo, empate o derrota, gasta una vida.
                }
              </small>
            </label>
          }
        }
        <label class="field">
          <span>Competición</span>
          <select [(ngModel)]="form.competicionId">
            <option value="">Elige una…</option>
            @for (c of competiciones(); track c.id) {
              <option [value]="c.id">{{ c.nombre }}</option>
            }
          </select>
        </label>
        <label class="field">
          <span>Jornada de inicio</span>
          <input type="number" min="1" [(ngModel)]="form.jornadaInicial" />
        </label>
        <label class="field">
          <span>Cierre de inscripciones</span>
          <input type="datetime-local" [(ngModel)]="form.cierreInscripcion" />
          <small class="pista">
            A esa hora el torneo arranca solo. Si no hay al menos dos jugadores,
            se cancela y se devuelven los puntos.
          </small>
        </label>
        <label class="field">
          <span>Costo de entrada (puntos)</span>
          <select [(ngModel)]="form.costoEntrada">
            <option [ngValue]="0">Gratis</option>
            <option [ngValue]="100">100 pts</option>
            <option [ngValue]="200">200 pts</option>
            <option [ngValue]="500">500 pts</option>
            <option [ngValue]="1000">1000 pts</option>
          </select>
        </label>
        <div class="field regla-fija">
          <span>Reglas</span>
          @if (form.modo === 'quiniela') {
            <p>
              Pronosticas el marcador de todos los partidos.
              Marcador exacto: 5 puntos. Solo acertar quién gana: 3 puntos.
              Gana quien más acumule.
            </p>
          } @else {
            <p>Una vida por jugador. El empate la consume; la derrota elimina.</p>
          }
        </div>
      </div>
      <button class="btn btn--primary" [disabled]="guardando()" (click)="crear()">
        {{ guardando() ? 'Creando…' : 'Crear torneo' }}
      </button>
    </section>

    @for (t of torneos(); track t.id) {
      <section class="panel">
        <button class="cab cab--boton" (click)="alternar(t.id)">
          <i class="ti chevron" [class.ti-chevron-down]="!abierto(t.id)"
            [class.ti-chevron-up]="abierto(t.id)"></i>
          <div class="cab-datos">
            <h2>{{ t.nombre }}</h2>
            <span class="sub">
              {{ t.modo === 'quiniela' ? 'Quiniela' : 'Supervivencia' }} ·
              {{ t.competicionNombre }} · jornada {{ t.jornadaActual }}
              @if (t.costoEntrada > 0) {
                · entrada {{ t.costoEntrada | number }} pts
              }
            </span>
            @if (t.costoEntrada > 0) {
              <div class="bolsa">
                <i class="ti ti-coins"></i>
                Bolsa: <strong>{{ t.bolsa | number }}</strong> pts
                @if (t.premioPagado) {
                  · pagado {{ t.premioPagado | number }}
                }
              </div>
            }
          </div>
          <span class="tag">{{ t.estado }}</span>
        </button>

        @if (abierto(t.id)) {

        <div class="invitacion">
          <span class="codigo">{{ t.codigo }}</span>

          <div class="invitacion-acciones">
            <button class="btn sm" (click)="copiar(t)">
              <i class="ti ti-copy"></i> Copiar enlace
            </button>
            @if (t.estado === 'inscripcion') {
              <button class="btn sm" (click)="iniciar(t)">Iniciar torneo</button>
            }
            @if (t.estado === 'en-curso') {
              <button class="btn sm" (click)="finalizar(t)">Cerrar y repartir</button>
            }
          </div>
        </div>

        <div class="participantes">
          <button class="part-cab part-cab--boton" (click)="alternarParticipantes(t.id)">
            <i class="ti chevron"
              [class.ti-chevron-down]="!participantesVisibles(t.id)"
              [class.ti-chevron-up]="participantesVisibles(t.id)"></i>
            <strong>Participantes</strong>
            <span class="sub">
              @if (t.modo === 'quiniela') {
                {{ participantesDe(t.id).length }} jugador(es)
              } @else {
                {{ vivosDe(t.id) }} vivo(s) de {{ participantesDe(t.id).length }}
              }
            </span>
          </button>

          @if (participantesVisibles(t.id)) {
          @if (participantesDe(t.id).length === 0) {
            <p class="sub">Nadie se ha inscrito todavía.</p>
          }

          @if (participantesDe(t.id).length > 8) {
            <div class="buscador">
              <i class="ti ti-search"></i>
              <input
                type="text"
                [ngModel]="busqueda[t.id]"
                (ngModelChange)="busqueda[t.id] = $event"
                placeholder="Buscar participante…"
              />
            </div>
          }

          @for (p of filtrados(t.id); track p.id) {
            <div class="part" [class.part--fuera]="!p.vivo">
              <span class="part-alias">
                {{ p.alias }}
                @if (esGestor(t, p.id)) {
                  <i class="ti ti-settings gestor-ico" title="Administrador del torneo"></i>
                }
              </span>

              <span class="part-datos">
                @if (t.modo === 'quiniela') {
                  <span class="part-estado ok">{{ p.puntosTorneo ?? 0 }} pts</span>
                  <span class="part-usados">{{ p.exactos ?? 0 }} exactos</span>
                } @else {
                  @if (p.vivo) {
                    <span class="part-vidas">
                      @if (p.vidasRestantes > 0) {
                        <i class="ti ti-heart-filled"></i>
                      } @else {
                        <span class="sin-vidas">sin vida</span>
                      }
                    </span>
                    <span class="part-estado ok">Vivo</span>
                  } @else {
                    <span class="part-estado">Eliminado · J{{ p.eliminadoEn }}</span>
                  }

                  <span class="part-usados">{{ p.equiposUsados.length }} equipo(s)</span>
                }
              </span>

              <button class="btn sm" (click)="alternarGestor(t, p.id)">
                {{ esGestor(t, p.id) ? 'Quitar admin' : 'Hacer admin' }}
              </button>
            </div>
          }
          }
        </div>
        }
      </section>
    }
  `,
  styles: [
    `
      .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
      .stat { background: var(--surface-1); border-radius: var(--radius); padding: 12px 14px; }
      .stat-label { font-size: 12px; color: var(--text-secondary); }
      .stat-val { font-size: 22px; font-weight: 600; }
      .accent { color: var(--accent-text); }
      @media (max-width: 620px) {
        .stats { grid-template-columns: repeat(2, 1fr); gap: 10px; }
        .stat-val { font-size: 19px; }
      }

      .msg { display: flex; align-items: center; gap: 8px; cursor: pointer;
        margin-bottom: 16px; font-size: 13px; padding: 11px 13px; border-radius: var(--radius);
        background: var(--success-bg); color: var(--success-text); }

      .panel { background: var(--surface-2); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 16px; margin-bottom: 16px; }
      h2 { font-size: 16px; font-weight: 600; margin: 0; }
      .sub { font-size: 12px; color: var(--text-muted); }
      .pista { display: block; font-size: 11px; color: var(--text-muted); margin-top: 4px; }
      .pista { display: block; font-size: 11px; color: var(--text-muted); margin-top: 4px; }
      .regla-fija p { font-size: 12px; color: var(--text-muted); margin: 0;
        background: var(--surface-1); border-radius: var(--radius); padding: 10px 12px; }
      .bolsa { font-size: 13px; color: var(--success-text); margin-top: 4px; }
      .cab { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
      .cab--boton {
        width: 100%; cursor: pointer; text-align: left;
        background: transparent; border: none; padding: 0; color: inherit;
        align-items: center;
      }
      .cab--boton:hover h2 { color: var(--accent-text); }
      .cab-datos { flex: 1; min-width: 0; }
      .chevron { font-size: 18px; color: var(--text-muted); flex-shrink: 0; }
      .tag { font-size: 11px; font-weight: 700; text-transform: uppercase;
        padding: 3px 9px; border-radius: 999px; background: var(--surface-1); color: var(--text-secondary); }

      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .field { display: block; margin-bottom: 12px; }
      .field span { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
      textarea { width: 100%; font-family: inherit; font-size: 16px; padding: 11px 12px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-primary); }

      .invitacion {
        background: var(--surface-1); border-radius: var(--radius);
        padding: 12px; margin-bottom: 14px;
      }
      .codigo {
        display: block; text-align: center; margin-bottom: 10px;
        font-family: var(--font-mono, monospace); font-size: 18px; font-weight: 700;
        letter-spacing: 3px; color: var(--text-primary);
      }
      .invitacion-acciones { display: flex; gap: 8px; }
      .invitacion-acciones .btn { flex: 1; justify-content: center; }

      .participantes { border-top: 1px solid var(--border); padding-top: 12px; margin-bottom: 14px; }
      .part-cab { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
      .part-cab--boton {
        width: 100%; cursor: pointer; text-align: left; align-items: center;
        background: transparent; border: none; padding: 0; color: inherit;
      }
      .part-cab--boton:hover strong { color: var(--accent-text); }
      .part-cab--boton .sub { margin-left: auto; }
      .buscador {
        display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
        border: 1px solid var(--border); border-radius: var(--radius);
        padding: 0 12px; color: var(--text-muted);
      }
      .buscador input { border: none; background: transparent; padding: 10px 0; min-height: 40px; }
      .buscador input:focus { outline: none; }
      .part {
        display: grid; align-items: center; gap: 8px;
        grid-template-columns: 1fr auto;
        padding: 10px 0; border-bottom: 1px solid var(--border);
      }
      .part-datos {
        grid-column: 1 / -1; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      }
      @media (min-width: 520px) {
        .part { grid-template-columns: 1fr auto auto; }
        .part-datos { grid-column: auto; }
      }
      .part:last-child { border-bottom: none; }
      .part--fuera { opacity: 0.6; }
      .part-alias { flex: 1; font-size: 14px; font-weight: 600; min-width: 110px;
        display: flex; align-items: center; gap: 5px; }
      .gestor-ico { color: var(--accent-fill); font-size: 14px; }
      .part-vidas { color: var(--danger-text); font-size: 12px; }
      .sin-vidas { color: var(--warning-text); font-size: 11px; }
      .part-estado { font-size: 11px; color: var(--text-muted); }
      .part-estado.ok { color: var(--success-text); font-weight: 600; }
      .part-usados { font-size: 11px; color: var(--text-muted); }

      .jornada-nueva { border-top: 1px solid var(--border); padding-top: 14px; margin-bottom: 14px; }
      .jornada { border-top: 1px solid var(--border); padding-top: 12px; margin-top: 12px; }
      .jornada-cab { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      .partido { display: flex; align-items: center; gap: 10px; padding: 6px 0; flex-wrap: wrap; }
      .equipos { flex: 1; font-size: 14px; min-width: 160px; }
      .partido select { width: auto; min-width: 170px; }
      .res { font-size: 13px; color: var(--text-secondary); }
      .acciones { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }

      .btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 9px 16px; cursor: pointer; border: 1px solid var(--border-strong);
        border-radius: var(--radius); background: transparent; font-size: 14px;
        color: var(--text-primary);
      }
      .btn.sm { padding: 7px 13px; font-size: 13px; }
      .btn--primary { background: var(--accent-fill); color: #fff; border-color: transparent; font-weight: 600; }
      .btn:disabled { opacity: 0.6; cursor: default; }

      @media (max-width: 620px) {
        .grid { grid-template-columns: 1fr; }
        .partido select { width: 100%; }
      }
    `,
  ],
})
export class AdminTorneosComponent {
  private readonly service = inject(TorneosService);
  private readonly competicionesSrv = inject(CompeticionesService);
  private readonly confirmar = inject(ConfirmarService);

  readonly torneos = toSignal(this.service.torneos(), { initialValue: [] as Torneo[] });
  readonly guardando = signal(false);
  readonly mensaje = signal('');

  readonly competiciones = toSignal(this.competicionesSrv.competiciones(), {
    initialValue: [] as Competicion[],
  });

  form = {
    nombre: '',
    modo: 'supervivencia' as ModoTorneo,
    jornadas: 5,
    vidas: 1,
    vidaCubre: 'empate' as 'empate' | 'tropiezo',
    competicionId: '',
    jornadaInicial: 1,
    costoEntrada: 0,
    cierreInscripcion: '',
  };

  /** Participantes por torneo. Suscripciones creadas una sola vez. */
  private readonly participantesPorTorneo = signal<Record<string, Participante[]>>({});
  private readonly suscripciones = new Map<string, Subscription>();

  constructor() {
    // Cada torneo nuevo estrena su propia escucha de participantes.
    effect(() => {
      const lista = this.torneos();
      untracked(() => {
        for (const t of lista) {
          if (this.suscripciones.has(t.id)) continue;
          const sub = this.service.participantes(t.id).subscribe((ps) => {
            this.participantesPorTorneo.update((mapa) => ({ ...mapa, [t.id]: ps }));
          });
          this.suscripciones.set(t.id, sub);
        }
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.suscripciones.forEach((s) => s.unsubscribe());
      this.suscripciones.clear();
    });
  }

  /** Participantes de un torneo, vivos primero. */
  participantesDe(torneoId: string): Participante[] {
    const lista = this.participantesPorTorneo()[torneoId] ?? [];
    return [...lista].sort((a, b) => {
      if (a.vivo !== b.vivo) return a.vivo ? -1 : 1;
      return a.alias.localeCompare(b.alias, 'es');
    });
  }

  readonly enCurso = computed(
    () => this.torneos().filter((t) => t.estado === 'en-curso').length,
  );
  readonly enInscripcion = computed(
    () => this.torneos().filter((t) => t.estado === 'inscripcion').length,
  );
  readonly finalizados = computed(
    () => this.torneos().filter((t) => t.estado === 'finalizado').length,
  );

  /** Puntos acumulados en las bolsas de los torneos vigentes. */
  readonly totalBolsas = computed(() =>
    this.torneos()
      .filter((t) => t.estado !== 'finalizado')
      .reduce((suma, t) => suma + Number(t.bolsa ?? 0), 0),
  );

  /** Inscripciones sumadas de todos los torneos. */
  readonly totalJugadores = computed(() =>
    Object.values(this.participantesPorTorneo()).reduce((suma, lista) => suma + lista.length, 0),
  );

  /** Todo arranca colapsado: con muchos torneos, el resumen es lo útil. */
  private readonly desplegados = signal<string[]>([]);

  abierto(torneoId: string): boolean {
    return this.desplegados().includes(torneoId);
  }

  alternar(torneoId: string): void {
    const abiertos = this.desplegados();
    this.desplegados.set(
      abiertos.includes(torneoId)
        ? abiertos.filter((x) => x !== torneoId)
        : [...abiertos, torneoId],
    );
  }

  /** Listas de participantes desplegadas. */
  private readonly participantesAbiertos = signal<string[]>([]);

  participantesVisibles(torneoId: string): boolean {
    return this.participantesAbiertos().includes(torneoId);
  }

  alternarParticipantes(torneoId: string): void {
    const abiertos = this.participantesAbiertos();
    this.participantesAbiertos.set(
      abiertos.includes(torneoId)
        ? abiertos.filter((x) => x !== torneoId)
        : [...abiertos, torneoId],
    );
  }

  /** Texto de búsqueda por torneo. */
  busqueda: Record<string, string> = {};

  /** Participantes que coinciden con la búsqueda. */
  filtrados(torneoId: string): Participante[] {
    const lista = this.participantesDe(torneoId);
    const texto = (this.busqueda[torneoId] ?? '').trim().toLowerCase();
    if (!texto) return lista;
    return lista.filter((p) => p.alias.toLowerCase().includes(texto));
  }

  vivosDe(torneoId: string): number {
    return this.participantesDe(torneoId).filter((p) => p.vivo).length;
  }

  esGestor(t: Torneo, uid: string): boolean {
    return (t.gestores ?? []).includes(uid);
  }

  async alternarGestor(t: Torneo, uid: string): Promise<void> {
    const agregar = !this.esGestor(t, uid);
    if (agregar) {
      const ok = await this.confirmar.pedir({
        titulo: 'Hacer administrador',
        mensaje: 'Esta persona podrá iniciar y cerrar el torneo.',
        aceptar: 'Sí, darle permiso',
      });
      if (!ok) return;
    }
    await this.service.cambiarGestor(t.id, uid, agregar);
    this.mensaje.set(agregar ? 'Ahora administra el torneo.' : 'Permiso retirado.');
  }


  async crear(): Promise<void> {
    if (!this.form.nombre.trim()) {
      this.mensaje.set('Ponle nombre al torneo.');
      return;
    }
    const comp = this.competiciones().find((c) => c.id === this.form.competicionId);
    if (!comp) {
      this.mensaje.set('Elige una competición. Si no hay, créala en la pestaña Ligas.');
      return;
    }
    if (!this.form.cierreInscripcion) {
      this.mensaje.set('Indica hasta cuándo se puede entrar al torneo.');
      return;
    }
    const cierre = new Date(this.form.cierreInscripcion);
    if (cierre.getTime() <= Date.now()) {
      this.mensaje.set('Esa hora ya pasó. Elige una futura.');
      return;
    }
    this.guardando.set(true);
    try {
      await this.service.crearTorneo({
        nombre: this.form.nombre.trim(),
        competicionId: comp.id,
        competicionNombre: comp.nombre,
        jornadaInicial: Number(this.form.jornadaInicial) || 1,
        costoEntrada: Number(this.form.costoEntrada),
        cierreInscripcion: cierre,
        modo: this.form.modo,
        jornadas: this.form.modo === 'quiniela' ? Number(this.form.jornadas) || 1 : 0,
        vidas: this.form.modo === 'supervivencia' ? Number(this.form.vidas) : 0,
        vidaCubre: this.form.vidaCubre,
      });
      this.form = {
        nombre: '',
        modo: 'supervivencia',
        jornadas: 5,
        vidas: 1,
        vidaCubre: 'empate',
        competicionId: '',
        jornadaInicial: 1,
        costoEntrada: 0,
        cierreInscripcion: '',
      };
      this.mensaje.set('Torneo creado. Comparte el enlace de invitación.');
    } catch (e: unknown) {
      this.mensaje.set((e as Error)?.message ?? 'No se pudo crear.');
    } finally {
      this.guardando.set(false);
    }
  }

  copiar(t: Torneo): void {
    const url = `${location.origin}/unirse/${t.codigo}`;
    navigator.clipboard?.writeText(url);
    this.mensaje.set(`Enlace copiado: ${url}`);
  }

  async iniciar(t: Torneo): Promise<void> {
    const ok = await this.confirmar.pedir({
      titulo: 'Iniciar el torneo',
      mensaje: 'Se cierran las inscripciones y ya nadie más podrá entrar.',
      aceptar: 'Iniciar',
    });
    if (!ok) return;
    await this.service.cambiarEstado(t.id, 'en-curso');
    this.mensaje.set('Torneo iniciado.');
  }

  /** Cierra el torneo cuando ya no habrá más jornadas. */
  async finalizar(t: Torneo): Promise<void> {
    const vivos = this.vivosDe(t.id);
    const ok = await this.confirmar.pedir({
      titulo: 'Cerrar el torneo',
      mensaje: `${vivos} sobreviviente(s) se repartirán la bolsa en partes iguales.`,
      aceptar: 'Cerrar y repartir',
      peligro: true,
    });
    if (!ok) return;
    try {
      const r = await this.service.finalizar(t.id);
      this.mensaje.set(
        `Torneo cerrado: ${r.ganadores} ganador(es)` +
        (r.premioPorCabeza > 0 ? ` · ${r.premioPorCabeza} pts cada uno.` : '.'),
      );
    } catch (e: unknown) {
      this.mensaje.set((e as Error)?.message ?? 'No se pudo cerrar.');
    }
  }






}