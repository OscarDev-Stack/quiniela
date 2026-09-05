import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { TorneosService } from '../../core/services/torneos.service';
import { Torneo, Participante } from '../../core/models/torneo.model';
import { ConfirmarService } from '../../shared/confirmar.service';
import { ToastService } from '../../shared/toast.service';
import { ContextoService } from '../../shared/contexto.service';
import { CodigoInvitarComponent } from '../../shared/codigo-invitar.component';

/**
 * Pantalla dedicada SOLO a gestionar torneos ya creados (iniciar, cerrar,
 * ver participantes, gestores). La lista se filtra por el contexto activo
 * (Global o el grupo elegido). Crear un torneo vive en CrearTorneoComponent.
 */
@Component({
    selector: 'app-gestionar-torneos',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, CodigoInvitarComponent],
    template: `

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

    <a class="btn btn--primary ancho-btn" routerLink="/admin/torneos/crear">
      <i class="ti ti-plus"></i> Crear torneo
    </a>

    <section class="panel panel--lista">
      <h2 class="panel-title">Torneos</h2>

      <nav class="tabs">
        <button class="tab" [class.tab--on]="filtro() === 'En juego'" (click)="filtro.set('En juego')">
          En juego <span class="tab-num">{{ conteo('En juego') }}</span>
        </button>
        <button class="tab" [class.tab--on]="filtro() === 'Abiertos'" (click)="filtro.set('Abiertos')">
          Abiertos <span class="tab-num">{{ conteo('Abiertos') }}</span>
        </button>
        <button class="tab" [class.tab--on]="filtro() === 'Cerrados'" (click)="filtro.set('Cerrados')">
          Cerrados <span class="tab-num">{{ conteo('Cerrados') }}</span>
        </button>
      </nav>

    @for (t of torneosFiltrados(); track t.id) {
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
          <app-codigo-invitar [codigo]="t.codigo" [url]="urlInvitacion(t.codigo)" />

          <div class="invitacion-acciones">
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
    } @empty {
      <p class="empty">
        @if (filtro() === 'En juego') {
          No hay torneos en juego ahora mismo.
        } @else if (filtro() === 'Abiertos') {
          No hay torneos abiertos a inscripción.
        } @else {
          Todavía no hay torneos finalizados.
        }
      </p>
    }
    </section>

  `,
    styles: [
        `
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 20px;
  }

  .stat {
    background: var(--surface-1);
    border-radius: var(--radius);
    padding: 12px 14px;
  }

  .stat-label {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .stat-val {
    font-size: 22px;
    font-weight: 600;
  }

  .accent {
    color: var(--accent-text);
  }

  @media (max-width: 620px) {
    .stats {
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }

    .stat-val {
      font-size: 19px;
    }
  }

  .msg {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    margin-bottom: 16px;
    font-size: 13px;
    padding: 11px 13px;
    border-radius: var(--radius);
    background: var(--success-bg);
    color: var(--success-text);
  }

  .panel {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 16px;
    margin-bottom: 16px;
  }

  /* Panel contenedor de la lista: agrupa las pestañas y las tarjetas
     para que no queden "volando" sueltas sobre el fondo. */
  .panel--lista {
    padding: 16px 16px 6px;
  }
  .panel-title {
    font-size: 15px;
    font-weight: 600;
    margin: 0 0 14px;
  }
  /* Tarjetas internas: fondo más tenue para distinguirlas del contenedor. */
  .panel--lista .panel {
    background: var(--surface-1);
  }
  .panel--lista .panel:last-of-type {
    margin-bottom: 10px;
  }

  h2 {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
  }

  .sub {
    font-size: 12px;
    color: var(--text-muted);
  }

  .pista {
    display: block;
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
  }

  .switch {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    cursor: pointer;
    margin-top: 4px;
  }

  .switch-texto {
    flex: 1;
    font-size: 14px;
  }

  .switch-input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .switch-pista {
    position: relative;
    flex-shrink: 0;
    margin-top: 2px;
    width: 46px;
    height: 26px;
    border-radius: 999px;
    background: var(--surface-1);
    border: 1px solid var(--border);
    transition: background 0.18s ease, border-color 0.18s ease;
  }

  .switch-pista::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--text-muted);
    transition: transform 0.18s ease, background 0.18s ease;
  }

  .switch-input:checked + .switch-pista {
    background: var(--accent-fill);
    border-color: transparent;
  }

  .switch-input:checked + .switch-pista::after {
    transform: translateX(20px);
    background: #fff;
  }

  @media (prefers-reduced-motion: reduce) {
    .switch-pista,
    .switch-pista::after {
      transition: none;
    }
  }

  .regla-fija p {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0;
    background: var(--surface-1);
    border-radius: var(--radius);
    padding: 10px 12px;
  }

  .bolsa {
    font-size: 13px;
    color: var(--success-text);
    margin-top: 4px;
  }

  .cab {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
  }

  .cab--boton {
    width: 100%;
    cursor: pointer;
    text-align: left;
    background: transparent;
    border: none;
    padding: 0;
    color: inherit;
    align-items: center;
  }

  .cab--boton:hover h2 {
    color: var(--accent-text);
  }

  .cab-datos {
    flex: 1;
    min-width: 0;
  }

  .chevron {
    font-size: 18px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .tag {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 3px 9px;
    border-radius: 999px;
    background: var(--surface-1);
    color: var(--text-secondary);
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .field {
    display: block;
    margin-bottom: 12px;
  }

  .field span {
    display: block;
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }

  textarea {
    width: 100%;
    font-family: inherit;
    font-size: 16px;
    padding: 11px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text-primary);
  }

  .invitacion {
    background: var(--surface-1);
    border-radius: var(--radius);
    padding: 12px;
    margin-bottom: 14px;
  }

  .codigo {
    display: block;
    text-align: center;
    margin-bottom: 10px;
    font-family: var(--font-mono, monospace);
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 3px;
    color: var(--text-primary);
  }

  .invitacion-acciones {
    display: flex;
    gap: 8px;
    margin-top: 14px;
  }

  .invitacion-acciones .btn {
    flex: 1;
    justify-content: center;
  }

  .participantes {
    border-top: 1px solid var(--border);
    padding-top: 12px;
    margin-bottom: 14px;
  }

  .part-cab {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 8px;
  }

  .part-cab--boton {
    width: 100%;
    cursor: pointer;
    text-align: left;
    align-items: center;
    background: transparent;
    border: none;
    padding: 0;
    color: inherit;
  }

  .part-cab--boton:hover strong {
    color: var(--accent-text);
  }

  .part-cab--boton .sub {
    margin-left: auto;
  }

  .buscador {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0 12px;
    color: var(--text-muted);
  }

  .buscador input {
    border: none;
    background: transparent;
    padding: 10px 0;
    min-height: 40px;
  }

  .buscador input:focus {
    outline: none;
  }

  .part {
    display: grid;
    align-items: center;
    gap: 8px;
    grid-template-columns: 1fr auto;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }

  .part-datos {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  @media (min-width: 520px) {
    .part {
      grid-template-columns: 1fr auto auto;
    }

    .part-datos {
      grid-column: auto;
    }
  }

  .part:last-child {
    border-bottom: none;
  }

  .part--fuera {
    opacity: 0.6;
  }

  .part-alias {
    flex: 1;
    font-size: 14px;
    font-weight: 600;
    min-width: 110px;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .gestor-ico {
    color: var(--accent-fill);
    font-size: 14px;
  }

  .part-vidas {
    color: var(--danger-text);
    font-size: 12px;
  }

  .sin-vidas {
    color: var(--warning-text);
    font-size: 11px;
  }

  .part-estado {
    font-size: 11px;
    color: var(--text-muted);
  }

  .part-estado.ok {
    color: var(--success-text);
    font-weight: 600;
  }

  .part-usados {
    font-size: 11px;
    color: var(--text-muted);
  }

  .jornada-nueva {
    border-top: 1px solid var(--border);
    padding-top: 14px;
    margin-bottom: 14px;
  }

  .jornada {
    border-top: 1px solid var(--border);
    padding-top: 12px;
    margin-top: 12px;
  }

  .jornada-cab {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .partido {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    flex-wrap: wrap;
  }

  .equipos {
    flex: 1;
    font-size: 14px;
    min-width: 160px;
  }

  .partido select {
    width: auto;
    min-width: 170px;
  }

  .res {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .acciones {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 16px;
    cursor: pointer;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: transparent;
    font-size: 14px;
    color: var(--text-primary);
  }

  .btn.sm {
    padding: 7px 13px;
    font-size: 13px;
  }

  .btn--primary {
    background: var(--accent-fill);
    color: #fff;
    border-color: transparent;
    font-weight: 600;
  }

  .ancho-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    text-decoration: none;
    margin-bottom: 18px;
  }

  /* Tabs de filtro por estado (mismo patrón que la vista de Partidos). */
  .tabs {
    display: flex;
    gap: 6px;
    margin-top: 8px;
    margin-bottom: 18px;
  }

  .tab {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 9px 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-2);
    color: var(--text-secondary);
  }

  .tab--on {
    background: var(--accent-fill);
    color: #fff;
    border-color: var(--accent-fill);
  }

  .tab-num {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.12);
  }

  .tab--on .tab-num {
    background: rgba(255, 255, 255, 0.25);
  }

  .empty {
    color: var(--text-muted);
    font-size: 14px;
    padding: 8px 0;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  @media (max-width: 620px) {
    .grid {
      grid-template-columns: 1fr;
    }

    .partido select {
      width: 100%;
    }
  }
  `,
    ],
})
export class GestionarTorneosComponent {
    private readonly service = inject(TorneosService);
    private readonly confirmar = inject(ConfirmarService);
    private readonly toast = inject(ToastService);
    private readonly contexto = inject(ContextoService);

    private readonly todos = toSignal(this.service.torneos(), { initialValue: [] as Torneo[] });

    /** Torneos del contexto activo (Global o el grupo elegido). */
    readonly torneos = computed(() => {
        const ctx = this.contexto.grupoId();
        return this.todos().filter((t) => (t.grupoId ?? null) === ctx);
    });

    /* Filtro por estado, mismas tres pestañas que la vista de Partidos.
       Arranca en 'Abiertos', igual que Partidos. */
    readonly filtro = signal<'En juego' | 'Abiertos' | 'Cerrados'>('Abiertos');

    /**
     * ¿El estado del torneo entra en la pestaña activa?
     *  En juego → en-curso · Abiertos → inscripcion · Cerrados → finalizado.
     */
    private pasaFiltro(estado: string): boolean {
        switch (this.filtro()) {
            case 'En juego':
                return estado === 'en-curso';
            case 'Abiertos':
                return estado === 'inscripcion';
            default: // 'Cerrados'
                return estado === 'finalizado';
        }
    }

    /**
     * Lista visible según el chip. Se deriva de torneos() (no lo reemplaza)
     * para que las estadísticas de arriba sigan contando el total real.
     */
    readonly torneosFiltrados = computed(() =>
        this.torneos().filter((t) => this.pasaFiltro(t.estado)),
    );

    /** Cuántos torneos hay para una etiqueta de chip (para el badge del chip). */
    conteo(etiqueta: string): number {
        const lista = this.torneos();
        switch (etiqueta) {
            case 'En juego':
                return lista.filter((t) => t.estado === 'en-curso').length;
            case 'Abiertos':
                return lista.filter((t) => t.estado === 'inscripcion').length;
            case 'Cerrados':
                return lista.filter((t) => t.estado === 'finalizado').length;
            default:
                return lista.length;
        }
    }


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
        this.toast.exito(agregar ? 'Ahora administra el torneo.' : 'Permiso retirado.');
    }



    /** URL de invitación para el QR. El copiar (solo el código) lo hace el componente. */
    urlInvitacion(codigo: string): string {
        return `${location.origin}/unirse/${codigo}`;
    }

    async iniciar(t: Torneo): Promise<void> {
        const ok = await this.confirmar.pedir({
            titulo: 'Iniciar el torneo',
            mensaje: 'Se cierran las inscripciones y ya nadie más podrá entrar.',
            aceptar: 'Iniciar',
        });
        if (!ok) return;
        await this.service.cambiarEstado(t.id, 'en-curso');
        this.toast.exito('Torneo iniciado.');
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
            this.toast.exito(
                `Torneo cerrado: ${r.ganadores} ganador(es)` +
                (r.premioPorCabeza > 0 ? ` · ${r.premioPorCabeza} pts cada uno.` : '.'),
            );
        } catch (e: unknown) {
            this.toast.error((e as Error)?.message ?? 'No se pudo cerrar.');
        }
    }






}