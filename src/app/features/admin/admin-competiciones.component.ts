import { Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { CompeticionesService } from '../../core/services/competiciones.service';
import { AdminService } from '../../core/services/admin.service';
import {
  Competicion,
  Jornada,
  PartidoJornada,
  fechaJornada,
  resultadoDeMarcador,
} from '../../core/models/competicion.model';
import { AppUser } from '../../core/models/user.model';
import { nombreOficial } from '../../core/models/equipos-liga-mx';
import { ConfirmarService } from '../../shared/confirmar.service';
import { ToastService } from '../../shared/toast.service';

@Component({
  selector: 'app-admin-competiciones',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `

    <section class="panel">
      <h2>Nueva competición</h2>
      <p class="ayuda">
        Las jornadas y resultados se capturan aquí una sola vez y se aplican a
        todos los torneos de esa competición.
      </p>
      <div class="fila-form">
        <input type="text" [(ngModel)]="nombre" placeholder="Liga MX" />
        <button class="btn btn--primary" (click)="crear()">Crear</button>
      </div>
    </section>

    @for (c of competiciones(); track c.id) {
      <section class="panel">
        <button class="cab cab--boton" (click)="alternarLiga(c.id)">
          <i class="ti chevron" [class.ti-chevron-down]="!ligaAbierta(c.id)"
            [class.ti-chevron-up]="ligaAbierta(c.id)"></i>
          <div class="cab-datos">
            <h2>{{ c.nombre }}</h2>
            <span class="sub">
              {{ jornadasDe(c.id).length }} jornada(s) ·
              {{ (c.equipos ?? []).length }} equipos
            </span>
          </div>

          @if (porPublicar(c.id); as n) {
            <span class="marca marca--lista">{{ n }} lista(s)</span>
          }
          @if (porCapturar(c.id); as n) {
            <span class="marca marca--warn">{{ n }} en captura</span>
          }
        </button>

        @if (ligaAbierta(c.id)) {
        <div class="gestores">
          <button class="toggle" (click)="alternarPanel(c.id)">
            <i class="ti" [class.ti-chevron-down]="!abierto(c.id)" [class.ti-chevron-up]="abierto(c.id)"></i>
            Administradores de la liga
            <span class="cuenta">{{ (c.gestores ?? []).length }}</span>
          </button>

          @if (abierto(c.id)) {
            <p class="nota">
              Un administrador de liga puede capturar jornadas y publicar resultados.
            </p>

            @for (u of gestoresActuales(c); track u.id) {
              <div class="gestor gestor--activo">
                <span class="quien">
                  <i class="ti ti-settings marca"></i>
                  {{ u.alias || u.email }}
                </span>
                <button class="btn sm" (click)="alternarGestor(c, u.id)">Quitar</button>
              </div>
            }

            <div class="buscador">
              <i class="ti ti-search"></i>
              <input
                type="text"
                [ngModel]="busqueda[c.id]"
                (ngModelChange)="busqueda[c.id] = $event"
                placeholder="Buscar por nombre o correo…"
              />
            </div>

            @if ((busqueda[c.id]).length < 2) {
              <p class="pista">Escribe al menos dos letras para buscar.</p>
            } @else {
              @for (u of resultados(c); track u.id) {
                <div class="gestor">
                  <span class="quien">{{ u.alias || u.email }}</span>
                  <button class="btn sm" (click)="alternarGestor(c, u.id)">Asignar</button>
                </div>
              } @empty {
                <p class="pista">Nadie coincide con esa búsqueda.</p>
              }

              @if (totalCoincidencias(c) > 8) {
                <p class="pista">
                  Mostrando 8 de {{ totalCoincidencias(c) }}. Afina la búsqueda para ver más.
                </p>
              }
            }
          }
        </div>

        <div class="equipos">
          <button class="toggle" (click)="alternarEquipos(c.id)">
            <i class="ti" [class.ti-chevron-down]="!equiposAbiertos(c.id)"
              [class.ti-chevron-up]="equiposAbiertos(c.id)"></i>
            Equipos de la competición
            <span class="cuenta">{{ (c.equipos ?? []).length }}</span>
          </button>

          @if (equiposAbiertos(c.id)) {
            <p class="nota">
              Escríbelos una sola vez, uno por línea. Las jornadas se arman eligiéndolos
              de una lista, así nunca hay dos formas de escribir el mismo equipo.
            </p>
            <textarea rows="6" [(ngModel)]="textoEquipos[c.id]"
              placeholder="América&#10;Chivas&#10;Cruz Azul&#10;Pumas"></textarea>
            <button class="btn sm" (click)="guardarEquipos(c)">Guardar equipos</button>
          }
        </div>

        <div class="equipos">
          <button class="toggle" (click)="alternarApi(c.id)">
            <i class="ti" [class.ti-chevron-down]="!apiAbierto(c.id)"
              [class.ti-chevron-up]="apiAbierto(c.id)"></i>
            Conexión con la API (opcional)
            @if (c.apiLigaId) { <span class="cuenta">on</span> }
          </button>

          @if (apiAbierto(c.id)) {
            <p class="nota">
              Vincula esta competición con una liga y temporada para traer las jornadas
              y los resultados automáticamente. Elige de la lista, no necesitas saber
              ningún código.
            </p>
            <div class="grid">
              <label class="field">
                <span>Liga</span>
                <select [(ngModel)]="apiCfg(c.id).ligaId">
                  <option [ngValue]="null">Sin conexión</option>
                  @for (l of ligasApi; track l.id) {
                    <option [ngValue]="l.id">{{ l.nombre }}</option>
                  }
                </select>
              </label>
              <label class="field">
                <span>Temporada</span>
                <select [(ngModel)]="apiCfg(c.id).temporada">
                  <option value="">Elige…</option>
                  @for (t of temporadasApi; track t) {
                    <option [value]="t">{{ t }}</option>
                  }
                </select>
              </label>
            </div>
            <button class="btn sm" (click)="guardarApi(c)">Guardar conexión</button>
          }
        </div>

        <div class="nueva">
          @if ((c.equipos ?? []).length < 2) {
            <p class="nota-vacia">
              Primero captura los equipos de la competición para poder armar jornadas.
            </p>
          } @else {
            <div class="grid">
              <label class="field">
                <span>Jornada número</span>
                <input type="number" min="1" [(ngModel)]="b(c.id).numero" />
              </label>
              <label class="field">
                <span>Inicio del primer partido</span>
                <input type="datetime-local" [(ngModel)]="b(c.id).cierra" />
              </label>
            </div>

            <span class="etiqueta-campo">Partidos de la jornada</span>
            @for (fila of b(c.id).filas; track $index) {
              <div class="fila-partido">
                <select [(ngModel)]="fila.local">
                  <option value="">Local…</option>
                  @for (e of disponibles(c, b(c.id).filas, fila, 'local'); track e) {
                    <option [value]="e">{{ e }}</option>
                  }
                </select>
                <span class="vs">vs</span>
                <select [(ngModel)]="fila.visitante">
                  <option value="">Visitante…</option>
                  @for (e of disponibles(c, b(c.id).filas, fila, 'visitante'); track e) {
                    <option [value]="e">{{ e }}</option>
                  }
                </select>
                <button class="quitar" (click)="quitarFila(c.id, $index)" aria-label="Quitar">
                  <i class="ti ti-x"></i>
                </button>
              </div>
            }

            <div class="acciones">
              <button class="btn sm" (click)="agregarFila(c.id)">
                <i class="ti ti-plus"></i> Agregar partido
              </button>
              @if (b(c.id).filas.length === 0) {
                <button class="btn sm" (click)="llenarJornada(c)">
                  Armar jornada completa
                </button>
              }
              @if (c.apiLigaId) {
                <button class="btn sm" [disabled]="trayendo()" (click)="traerJornada(c)">
                  <i class="ti ti-cloud-download"></i>
                  {{ trayendo() ? 'Trayendo…' : 'Traer jornada de la API' }}
                </button>
              }
              <button class="btn sm btn--primary" (click)="agregarJornada(c)">
                Guardar jornada
              </button>
            </div>
          }
        </div>

        @for (j of jornadasDe(c.id); track j.id) {
          <div class="jornada">
            <button class="jornada-cab" (click)="alternarJornada(j.id)">
              <i class="ti" [class.ti-chevron-down]="!jornadaAbierta(j)"
                [class.ti-chevron-up]="jornadaAbierta(j)"></i>
              <span class="jornada-titulo">Jornada {{ j.numero }}</span>
              <span class="jornada-fecha">{{ cierre(j) | date: 'dd/MM, h:mm a' }}</span>

              @if (j.estado === 'resuelta') {
                @if (tieneAplazados(j)) {
                  <span class="marca marca--warn">En espera</span>
                } @else {
                  <span class="marca marca--ok">Resuelta</span>
                }
              } @else if (faltantes(j) > 0) {
                <span class="marca marca--warn">Faltan {{ faltantes(j) }}</span>
              } @else {
                <span class="marca marca--lista">Lista para publicar</span>
              }
            </button>

            @if (jornadaAbierta(j)) {
              @if (j.estado === 'resuelta' && tieneAplazados(j)) {
                <div class="aviso-aplazado">
                  <i class="ti ti-clock-pause"></i>
                  Hay partidos aplazados. Cuando se jueguen, captura el resultado y
                  define las elecciones que quedaron en espera.
                </div>
              }

              @for (p of j.partidos; track $index) {
                <div class="partido">
                  <span class="equipos">{{ p.local }} vs {{ p.visitante }}</span>
                  @if (j.estado === 'resuelta' && p.resultado !== 'pospuesto') {
                    <span class="res">{{ etiqueta(p) }}</span>
                  } @else {
                    <div class="captura">
                      <input
                        type="number"
                        min="0"
                        max="20"
                        class="goles"
                        [ngModel]="p.golesLocal"
                        (ngModelChange)="ponerGoles(p, 'local', $event)"
                        [disabled]="p.resultado === 'pospuesto'"
                        aria-label="Goles del local"
                      />
                      <span class="guion">–</span>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        class="goles"
                        [ngModel]="p.golesVisitante"
                        (ngModelChange)="ponerGoles(p, 'visitante', $event)"
                        [disabled]="p.resultado === 'pospuesto'"
                        aria-label="Goles del visitante"
                      />

                      <button
                        class="aplazar"
                        [class.aplazar--activo]="p.resultado === 'pospuesto'"
                        (click)="alternarAplazado(p)"
                        title="Aplazado o anulado"
                      >
                        <i class="ti ti-calendar-off"></i>
                      </button>

                      <span class="deduccion">{{ etiqueta(p) }}</span>
                    </div>
                  }
                </div>
              }

              @if (j.estado !== 'resuelta') {
                @if (faltantes(j) > 0) {
                  <div class="alerta-faltan">
                    <i class="ti ti-alert-triangle"></i>
                    Faltan {{ faltantes(j) }} resultado(s) por capturar para poder publicar.
                  </div>
                }

                <div class="acciones">
                  @if (c.apiLigaId) {
                    <button class="btn sm" [disabled]="trayendo()" (click)="traerResultados(c, j)">
                      <i class="ti ti-cloud-download"></i>
                      {{ trayendo() ? 'Trayendo…' : 'Traer resultados de la API' }}
                    </button>
                  }
                  <button class="btn sm" (click)="guardar(c, j)">Guardar resultados</button>
                  <button
                    class="btn sm btn--primary"
                    [disabled]="resolviendo() || faltantes(j) > 0"
                    (click)="resolver(c, j)"
                  >
                    {{ resolviendo() ? 'Aplicando…' : 'Publicar y aplicar a los torneos' }}
                  </button>
                </div>
              } @else if (tieneAplazados(j)) {
                <div class="acciones">
                  <button class="btn sm" (click)="guardar(c, j)">Guardar resultados</button>
                  <button
                    class="btn sm btn--primary"
                    [disabled]="resolviendo() || tieneAplazados(j)"
                    (click)="definirPendientes(c, j)"
                  >
                    {{ resolviendo() ? 'Definiendo…' : 'Definir elecciones en espera' }}
                  </button>
                </div>
              }
            }
          </div>
        }
        }
      </section>
    }
  `,
  styles: [
    `
      .msg { display: flex; align-items: center; gap: 8px; cursor: pointer;
        margin-bottom: 16px; font-size: 13px; padding: 11px 13px; border-radius: var(--radius);
        background: var(--success-bg); color: var(--success-text); }

      .panel { background: var(--surface-2); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 16px; margin-bottom: 16px; }
      h2 { font-size: 16px; font-weight: 600; margin: 0; }
      .sub { font-size: 12px; color: var(--text-muted); }
      .ayuda { font-size: 13px; color: var(--text-secondary); margin: 6px 0 12px; }
      .cab { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
      .cab--boton {
        width: 100%; cursor: pointer; text-align: left; gap: 10px;
        align-items: center; background: transparent; border: none;
        padding: 0; color: inherit; margin-bottom: 0;
      }
      .cab--boton:hover h2 { color: var(--accent-text); }
      .cab-datos { flex: 1; min-width: 0; }
      .cab-datos h2 { margin: 0; }
      .cab-datos .sub { display: block; margin-top: 2px; }
      .chevron { font-size: 18px; color: var(--text-muted); flex-shrink: 0; }

      .fila-form { display: flex; gap: 8px; }
      .fila-form input { flex: 1; }

      .gestores { margin-bottom: 14px; margin-top: 14px; }
      .toggle {
        display: flex; align-items: center; gap: 8px; width: 100%; cursor: pointer;
        background: var(--surface-1); border: 1px solid var(--border);
        border-radius: var(--radius); padding: 10px 12px;
        font-size: 13px; font-weight: 600; color: var(--text-secondary);
      }
      .cuenta {
        margin-left: auto; font-size: 11px; font-weight: 700;
        background: var(--surface-2); color: var(--text-muted);
        border-radius: 999px; padding: 2px 9px;
      }
      .nota { font-size: 12px; color: var(--text-muted); margin: 10px 0 4px; }
      .gestor { display: flex; align-items: center; justify-content: space-between;
        gap: 10px; font-size: 13px; padding: 8px 0;
        border-bottom: 1px solid var(--border); }
      .gestor:last-child { border-bottom: none; }
      .quien { display: flex; align-items: center; gap: 6px; }
      .gestor--activo { background: var(--surface-1); border-radius: var(--radius); padding: 8px 10px; }
      .buscador {
        display: flex; align-items: center; gap: 8px; margin: 12px 0 8px;
        border: 1px solid var(--border); border-radius: var(--radius);
        padding: 0 12px; color: var(--text-muted);
      }
      .buscador input { border: none; background: transparent; padding: 10px 0; min-height: 40px; }
      .buscador input:focus { outline: none; }
      .pista { font-size: 12px; color: var(--text-muted); margin: 8px 0 0; }
      .marca { color: var(--accent-fill); font-size: 14px; }

      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .field { display: block; margin-bottom: 12px; }
      .field span { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
      textarea { width: 100%; font-family: inherit; font-size: 16px; padding: 11px 12px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-primary); }

      .equipos { margin-bottom: 14px; }
      .equipos textarea { margin-bottom: 8px; }
      .nota-vacia {
        font-size: 13px; color: var(--warning-text); background: var(--warning-bg);
        border-radius: var(--radius); padding: 12px; margin: 0;
      }
      .etiqueta-campo {
        display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;
      }
      .fila-partido {
        display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
      }
      .fila-partido select { flex: 1; min-width: 0; }
      .vs { font-size: 12px; color: var(--text-muted); flex-shrink: 0; }
      .quitar {
        flex-shrink: 0; width: 34px; height: 34px; cursor: pointer;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: transparent; color: var(--text-muted);
      }
      .quitar:hover { color: var(--danger-text); border-color: var(--danger-text); }

      .nueva { border-top: 1px solid var(--border); padding-top: 14px; margin-bottom: 8px; }
      .jornada { border-top: 1px solid var(--border); padding-top: 12px; margin-top: 12px; }
      .jornada-cab {
        display: flex; align-items: center; gap: 8px; width: 100%; cursor: pointer;
        background: transparent; border: none; padding: 4px 0; margin-bottom: 8px;
        color: var(--text-primary); font-size: 14px; text-align: left;
      }
      .jornada-titulo { font-weight: 600; }
      .jornada-fecha { font-size: 12px; color: var(--text-muted); margin-left: auto; }
      .marca {
        font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px;
        padding: 3px 9px; border-radius: 999px; white-space: nowrap;
        background: var(--surface-1); color: var(--text-secondary);
      }
      .marca--ok { background: var(--success-bg); color: var(--success-text); }
      .marca--warn { background: var(--warning-bg); color: var(--warning-text); }
      .marca--lista { background: var(--accent-bg); color: var(--accent-text); }
      .alerta-faltan {
        display: flex; align-items: center; gap: 8px; margin-top: 10px;
        font-size: 12px; padding: 10px 12px; border-radius: var(--radius);
        background: var(--warning-bg); color: var(--warning-text);
      }
      .partido { display: flex; align-items: center; gap: 10px; padding: 6px 0; flex-wrap: wrap; }
      .equipos { flex: 1; font-size: 14px; min-width: 160px; }
      .partido select { width: auto; min-width: 170px; }
      .captura { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .goles {
        width: 52px; min-height: 40px; text-align: center; font-size: 16px;
        padding: 6px; border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-primary);
      }
      .goles:disabled { opacity: 0.4; }
      .guion { color: var(--text-muted); }
      .aplazar {
        width: 38px; height: 38px; cursor: pointer;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: transparent; color: var(--text-muted);
      }
      .aplazar--activo {
        background: var(--warning-bg); color: var(--warning-text); border-color: transparent;
      }
      .deduccion { font-size: 12px; color: var(--text-secondary); min-width: 96px; }
      .res { font-size: 13px; color: var(--text-secondary); }
      .aviso-aplazado {
        display: flex; align-items: flex-start; gap: 8px;
        font-size: 12px; padding: 10px 12px; border-radius: var(--radius);
        background: var(--warning-bg); color: var(--warning-text); margin-bottom: 8px;
      }
      .acciones { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }

      .btn { padding: 9px 16px; cursor: pointer; border: 1px solid var(--border-strong);
        border-radius: var(--radius); background: transparent; font-size: 14px; }
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
export class AdminCompeticionesComponent {
  private readonly service = inject(CompeticionesService);
  private readonly admin = inject(AdminService);
  private readonly confirmar = inject(ConfirmarService);
  private readonly toast = inject(ToastService);

  readonly competiciones = toSignal(this.service.competiciones(), {
    initialValue: [] as Competicion[],
  });
  readonly usuarios = toSignal(this.admin.getUsers(), { initialValue: [] as AppUser[] });

  readonly resolviendo = signal(false);
  /** True mientras se consulta la API (traer jornada o resultados). */
  readonly trayendo = signal(false);
  nombre = '';

  /* --- Conexión con la API (TheSportsDB) --- */
  /** Ligas soportadas por la API. Agregar aquí para habilitar más. */
  readonly ligasApi: Array<{ id: number; nombre: string }> = [
    { id: 4350, nombre: 'Liga MX' },
  ];
  /** Temporadas elegibles (formato de la API). La más reciente primero. */
  readonly temporadasApi: string[] = ['2026-2027', '2025-2026', '2024-2025'];

  private readonly apiPanel = signal<string[]>([]);
  private readonly apiCfgMap: Record<string, { ligaId: number | null; temporada: string }> = {};

  apiAbierto(competicionId: string): boolean {
    return this.apiPanel().includes(competicionId);
  }

  alternarApi(competicionId: string): void {
    const actuales = this.apiPanel();
    if (actuales.includes(competicionId)) {
      this.apiPanel.set(actuales.filter((x) => x !== competicionId));
      return;
    }
    const c = this.competiciones().find((x) => x.id === competicionId);
    this.apiCfgMap[competicionId] = {
      ligaId: c?.apiLigaId ?? null,
      temporada: c?.apiTemporada ?? '',
    };
    this.apiPanel.set([...actuales, competicionId]);
  }

  apiCfg(competicionId: string): { ligaId: number | null; temporada: string } {
    if (!this.apiCfgMap[competicionId]) {
      this.apiCfgMap[competicionId] = { ligaId: null, temporada: '' };
    }
    return this.apiCfgMap[competicionId];
  }

  async guardarApi(c: Competicion): Promise<void> {
    const cfg = this.apiCfg(c.id);
    const ligaId = Number(cfg.ligaId ?? 0);
    const temporada = (cfg.temporada ?? '').trim();
    if (!ligaId || !temporada) {
      this.toast.error('Escribe el ID de liga y la temporada.');
      return;
    }
    try {
      await this.service.guardarConfigApi(c.id, ligaId, temporada);
      this.avisar('Conexión con la API guardada.');
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo guardar.');
    }
  }

  /** Trae de la API los enfrentamientos de la jornada del borrador. */
  async traerJornada(c: Competicion): Promise<void> {
    const bor = this.b(c.id);
    if (!bor.numero || bor.numero < 1) {
      this.toast.error('Escribe primero el número de jornada.');
      return;
    }
    this.trayendo.set(true);
    try {
      const r = await this.service.traerJornadaApi(c.id, bor.numero);
      bor.filas = r.partidos.map((p) => ({ local: p.local, visitante: p.visitante }));
      if (r.primeraHora) {
        bor.cierra = this.isoALocalInput(r.primeraHora);
      }

      // Los selects solo muestran equipos del catálogo de la competición. Si la
      // jornada trae equipos que aún no están en el catálogo, aparecerían
      // vacíos. Así que los agregamos automáticamente para que se vean.
      const actuales = new Set(c.equipos ?? []);
      const nuevos: string[] = [];
      for (const p of r.partidos) {
        for (const eq of [p.local, p.visitante]) {
          if (eq && !actuales.has(eq)) {
            actuales.add(eq);
            nuevos.push(eq);
          }
        }
      }
      if (nuevos.length > 0) {
        await this.service.guardarEquipos(c.id, [...actuales]);
      }

      this.avisar(
        `${r.partidos.length} partido(s) traídos de la API.` +
          (nuevos.length > 0 ? ` Se agregaron ${nuevos.length} equipo(s) al catálogo.` : '') +
          ' Revisa y guarda.',
      );
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo traer la jornada.');
    } finally {
      this.trayendo.set(false);
    }
  }

  /** Trae de la API los marcadores de una jornada ya guardada. */
  async traerResultados(c: Competicion, j: Jornada): Promise<void> {
    this.trayendo.set(true);
    try {
      const r = await this.service.traerResultadosApi(c.id, j.id);
      j.partidos = r.partidos;
      this.avisar(
        `${r.conResultado} resultado(s) traídos. Revisa y guarda antes de publicar.`,
      );
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudieron traer los resultados.');
    } finally {
      this.trayendo.set(false);
    }
  }

  /** Convierte un ISO UTC a formato datetime-local en la hora del navegador. */
  private isoALocalInput(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  borrador: Record<
    string,
    { numero: number; cierra: string; filas: Array<{ local: string; visitante: string }> }
  > = {};

  /** Texto del catálogo de equipos mientras se edita. */
  textoEquipos: Record<string, string> = {};
  private readonly equiposPanel = signal<string[]>([]);

  equiposAbiertos(competicionId: string): boolean {
    return this.equiposPanel().includes(competicionId);
  }

  alternarEquipos(competicionId: string): void {
    const actuales = this.equiposPanel();
    if (actuales.includes(competicionId)) {
      this.equiposPanel.set(actuales.filter((x) => x !== competicionId));
      return;
    }
    // Al abrir, precarga los equipos ya guardados.
    const c = this.competiciones().find((x) => x.id === competicionId);
    this.textoEquipos[competicionId] = (c?.equipos ?? []).join('\n');
    this.equiposPanel.set([...actuales, competicionId]);
  }

  async guardarEquipos(c: Competicion): Promise<void> {
    const lista = (this.textoEquipos[c.id] ?? '')
      .split('\n')
      .map((e) => nombreOficial(e))
      .filter(Boolean);

    if (lista.length < 2) {
      this.avisar('Escribe al menos dos equipos.');
      return;
    }
    await this.service.guardarEquipos(c.id, lista);
    this.avisar(`${lista.length} equipos guardados.`);
  }

  /** Equipos que se pueden elegir en un desplegable, sin repetir dentro de la jornada. */
  disponibles(
    c: Competicion,
    filas: Array<{ local: string; visitante: string }>,
    fila: { local: string; visitante: string },
    lado: 'local' | 'visitante',
  ): string[] {
    const usados = new Set<string>();
    for (const f of filas) {
      if (f.local) usados.add(f.local);
      if (f.visitante) usados.add(f.visitante);
    }
    // El propio valor sigue disponible para que no desaparezca del selector.
    const propio = lado === 'local' ? fila.local : fila.visitante;
    if (propio) usados.delete(propio);

    const catalogo = c.equipos ?? [];
    const lista = catalogo.filter((e) => !usados.has(e));
    // Si el valor de la fila aún no está en el catálogo (recién traído de la
    // API y todavía propagándose), lo incluimos para que el select lo muestre.
    if (propio && !catalogo.includes(propio)) lista.push(propio);
    return lista;
  }

  agregarFila(competicionId: string): void {
    this.b(competicionId).filas.push({ local: '', visitante: '' });
  }

  quitarFila(competicionId: string, indice: number): void {
    this.b(competicionId).filas.splice(indice, 1);
  }

  /** Crea tantas filas vacías como partidos quepan con los equipos disponibles. */
  llenarJornada(c: Competicion): void {
    const cuantos = Math.floor((c.equipos ?? []).length / 2);
    const filas = this.b(c.id).filas;
    for (let i = 0; i < cuantos; i++) filas.push({ local: '', visitante: '' });
  }

  /** Borrador de la competición, creándolo si hace falta. */
  b(competicionId: string): {
    numero: number;
    cierra: string;
    filas: Array<{ local: string; visitante: string }>;
  } {
    if (!this.borrador[competicionId]) {
      this.borrador[competicionId] = { numero: 1, cierra: '', filas: [] };
    }
    return this.borrador[competicionId];
  }

  /** Avisa con un toast de éxito. */
  private avisar(texto: string): void {
    this.toast.exito(texto);
  }

  /** Qué paneles de gestores están desplegados. */
  private readonly panelesAbiertos = signal<string[]>([]);

  abierto(competicionId: string): boolean {
    return this.panelesAbiertos().includes(competicionId);
  }

  alternarPanel(competicionId: string): void {
    const actuales = this.panelesAbiertos();
    this.panelesAbiertos.set(
      actuales.includes(competicionId)
        ? actuales.filter((x) => x !== competicionId)
        : [...actuales, competicionId],
    );
  }

  /** Jornadas por competición. Se llena con suscripciones creadas una sola vez. */
  private readonly jornadasPorComp = signal<Record<string, Jornada[]>>({});
  private readonly suscripciones = new Map<string, Subscription>();

  jornadasDe(competicionId: string): Jornada[] {
    return this.jornadasPorComp()[competicionId] ?? [];
  }

  constructor() {
    // Al aparecer una competición nueva, escuchamos sus jornadas.
    effect(() => {
      const lista = this.competiciones();
      untracked(() => {
        for (const c of lista) {
          if (this.suscripciones.has(c.id)) continue;
          const sub = this.service.jornadas(c.id).subscribe((js) => {
            this.jornadasPorComp.update((mapa) => ({ ...mapa, [c.id]: js }));
          });
          this.suscripciones.set(c.id, sub);
        }
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.suscripciones.forEach((s) => s.unsubscribe());
      this.suscripciones.clear();
    });
  }

  cierre(j: Jornada): Date | null {
    return fechaJornada(j);
  }

  etiqueta(p: PartidoJornada): string {
    if (p.resultado === 'local') return `Ganó ${p.local}`;
    if (p.resultado === 'visitante') return `Ganó ${p.visitante}`;
    if (p.resultado === 'empate') return 'Empate';
    if (p.resultado === 'pospuesto') return 'Aplazado';
    return 'Sin resultado';
  }

  /**
   * Todo arranca colapsado. Con temporadas de quince o más jornadas,
   * abrir solo la que se va a tocar es más rápido que buscar entre todas.
   */
  private readonly jornadasDesplegadas = signal<string[]>([]);
  private readonly ligasDesplegadas = signal<string[]>([]);

  jornadaAbierta(j: Jornada): boolean {
    return this.jornadasDesplegadas().includes(j.id);
  }

  alternarJornada(jornadaId: string): void {
    const abiertas = this.jornadasDesplegadas();
    this.jornadasDesplegadas.set(
      abiertas.includes(jornadaId)
        ? abiertas.filter((x) => x !== jornadaId)
        : [...abiertas, jornadaId],
    );
  }

  ligaAbierta(competicionId: string): boolean {
    return this.ligasDesplegadas().includes(competicionId);
  }

  alternarLiga(competicionId: string): void {
    const abiertas = this.ligasDesplegadas();
    this.ligasDesplegadas.set(
      abiertas.includes(competicionId)
        ? abiertas.filter((x) => x !== competicionId)
        : [...abiertas, competicionId],
    );
  }

  /** Jornadas completas esperando a que las publiques. */
  porPublicar(competicionId: string): number {
    return this.jornadasDe(competicionId).filter(
      (j) => j.estado !== 'resuelta' && this.faltantes(j) === 0,
    ).length;
  }

  /** Jornadas a las que todavía les faltan resultados. */
  porCapturar(competicionId: string): number {
    return this.jornadasDe(competicionId).filter(
      (j) => j.estado !== 'resuelta' && this.faltantes(j) > 0,
    ).length;
  }


  /** Cuántos partidos siguen sin resultado. */
  faltantes(j: Jornada): number {
    return j.partidos.filter((p) => !p.resultado).length;
  }

  /** Guarda el marcador y deduce solo quién ganó. */
  ponerGoles(p: PartidoJornada, lado: 'local' | 'visitante', valor: unknown): void {
    const n = valor === null || valor === '' ? null : Math.trunc(Number(valor));
    if (lado === 'local') p.golesLocal = n;
    else p.golesVisitante = n;

    p.resultado = resultadoDeMarcador(p.golesLocal, p.golesVisitante);
  }

  /** Marca o desmarca el partido como aplazado. */
  alternarAplazado(p: PartidoJornada): void {
    if (p.resultado === 'pospuesto') {
      p.resultado = resultadoDeMarcador(p.golesLocal, p.golesVisitante);
      return;
    }
    p.golesLocal = null;
    p.golesVisitante = null;
    p.resultado = 'pospuesto';
  }

  /** ¿Esta jornada dejó elecciones en espera? */
  tieneAplazados(j: Jornada): boolean {
    return j.partidos.some((p) => p.resultado === 'pospuesto');
  }

  /** Define la suerte de quienes eligieron equipos de partidos aplazados. */
  async definirPendientes(c: Competicion, j: Jornada): Promise<void> {
    if (this.tieneAplazados(j)) {
      this.avisar('Primero cambia el resultado de los partidos aplazados.');
      return;
    }
    const ok = await this.confirmar.pedir({
      titulo: 'Definir elecciones en espera',
      mensaje:
        'Se resolverá la suerte de quienes eligieron equipos de partidos aplazados. ' +
        'Algunos podrían quedar eliminados.',
      aceptar: 'Definir',
    });
    if (!ok) return;

    this.resolviendo.set(true);
    try {
      await this.service.guardarResultados(c.id, j.id, j.partidos);
      const r = await this.service.resolverPendientes(c.id, j.id);
      this.avisar(
        `${r.resueltos} elección(es) definida(s), ${r.eliminados} eliminado(s).` +
        (r.cerrados.length ? ` Cerrados: ${r.cerrados.join(', ')}.` : ''),
      );
    } catch (e: unknown) {
      this.avisar((e as Error)?.message ?? 'No se pudo definir.');
    } finally {
      this.resolviendo.set(false);
    }
  }

  /** Texto de búsqueda por competición. */
  busqueda: Record<string, string> = {};

  /** Quienes ya gestionan la competición, siempre visibles. */
  gestoresActuales(c: Competicion): AppUser[] {
    const ids = c.gestores ?? [];
    return this.usuarios().filter((u) => ids.includes(u.id));
  }

  private coincidencias(c: Competicion): AppUser[] {
    const texto = (this.busqueda[c.id]).trim().toLowerCase();
    if (texto.length < 2) return [];
    const ids = c.gestores ?? [];

    return this.usuarios().filter(
      (u) =>
        !ids.includes(u.id) &&
        ((u.alias ?? '').toLowerCase().includes(texto) ||
          (u.email ?? '').toLowerCase().includes(texto)),
    );
  }

  /** Primeros ocho resultados, para no llenar la pantalla. */
  resultados(c: Competicion): AppUser[] {
    return this.coincidencias(c).slice(0, 8);
  }

  totalCoincidencias(c: Competicion): number {
    return this.coincidencias(c).length;
  }

  esGestor(c: Competicion, uid: string): boolean {
    return (c.gestores ?? []).includes(uid);
  }

  async alternarGestor(c: Competicion, uid: string): Promise<void> {
    const agregar = !this.esGestor(c, uid);
    await this.service.cambiarGestor(c.id, uid, agregar);
    this.toast.exito(agregar ? 'Ahora puede capturar resultados.' : 'Permiso retirado.');
  }

  async crear(): Promise<void> {
    if (!this.nombre.trim()) {
      this.avisar('Ponle nombre a la competición.');
      return;
    }
    await this.service.crear(this.nombre);
    this.nombre = '';
    this.avisar('Competición creada.');
  }

  async agregarJornada(c: Competicion): Promise<void> {
    const b = this.b(c.id);
    if (!b.cierra) {
      this.avisar('Indica la hora del primer partido.');
      return;
    }
    const cierre = new Date(b.cierra);
    if (cierre.getTime() <= Date.now()) {
      this.avisar('Esa hora ya pasó.');
      return;
    }

    const partidos = b.filas.filter((f) => f.local && f.visitante);

    if (partidos.length === 0) {
      this.avisar('Agrega al menos un partido con sus dos equipos.');
      return;
    }
    if (partidos.length !== b.filas.length) {
      this.avisar('Hay partidos incompletos. Complétalos o quítalos.');
      return;
    }

    const numero = Number(b.numero) || 1;
    await this.service.crearJornada(c.id, numero, cierre, partidos);
    this.borrador[c.id] = { numero: numero + 1, cierra: '', filas: [] };
    this.avisar(`Jornada ${numero} agregada con ${partidos.length} partido(s).`);
  }

  async guardar(c: Competicion, j: Jornada): Promise<void> {
    await this.service.guardarResultados(c.id, j.id, j.partidos);
    // Recalcula la previa de las quinielas con lo capturado hasta ahora, para
    // que los jugadores vean sus puntos parciales (incluidos los empates que
    // se acaban de capturar) sin esperar a que se publique la jornada. Si
    // falla, no bloquea: los resultados ya quedaron guardados.
    try {
      await this.service.previsualizarQuiniela(c.id, j.id);
    } catch {
      // La previa es un extra; si falla, los resultados ya están guardados.
    }
    this.avisar('Resultados guardados.');
  }

  async resolver(c: Competicion, j: Jornada): Promise<void> {
    if (j.partidos.some((p) => !p.resultado)) {
      this.avisar('Faltan resultados por capturar.');
      return;
    }
    const aplazados = j.partidos.filter((p) => p.resultado === 'pospuesto').length;
    const aviso = aplazados
      ? `Hay ${aplazados} partido(s) aplazado(s): quienes los eligieron quedarán en espera hasta que se jueguen. `
      : '';
    const ok = await this.confirmar.pedir({
      titulo: `Publicar la jornada ${j.numero}`,
      mensaje: `${aviso}Se aplicará a todos los torneos que estén en esta jornada. No se puede deshacer.`,
      aceptar: 'Publicar',
      peligro: true,
    });
    if (!ok) return;

    this.resolviendo.set(true);
    try {
      await this.service.guardarResultados(c.id, j.id, j.partidos);
      const r = await this.service.resolver(c.id, j.id);
      this.avisar(
        `Aplicado a ${r.torneos} torneo(s): ${r.sobreviven} siguen, ${r.eliminados} fuera` +
        (r.pendientes ? `, ${r.pendientes} en espera` : '') +
        '.' +
        (r.cerrados.length ? ` Cerrados: ${r.cerrados.join(', ')}.` : ''),
      );
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo aplicar.');
    } finally {
      this.resolviendo.set(false);
    }
  }
}