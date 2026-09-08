import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { NavComponent } from '../../shared/nav.component';
import { CargandoComponent } from '../../shared/cargando.component';
import { NovedadesService } from '../../shared/novedades.service';
import { apagarCargando } from '../../shared/cargando.util';
import { EscudoComponent } from '../../shared/escudo.component';
import { ContextoService } from '../../shared/contexto.service';
import { GruposService } from '../../core/services/grupos.service';
import { Grupo } from '../../core/models/grupo.model';
import { PartidosService } from '../../core/services/partidos.service';
import { TorneosService } from '../../core/services/torneos.service';
import { BracketsService } from '../../core/services/brackets.service';
import { UserService } from '../../core/services/user.service';
import { StatsService } from '../../shared/stats.service';
import { Partido, fechaCierre } from '../../core/models/partido.model';
import { Torneo } from '../../core/models/torneo.model';
import { Bracket } from '../../core/models/bracket.model';

/**
 * Hub de inicio. Arriba, el saludo con el avatar y una fila compacta de
 * stats (saldo, racha y trofeos; racha/trofeos solo si son > 0). Debajo,
 * una tarjeta DESTACADA con lo más relevante para actuar ahora (un torneo
 * en curso, o el próximo partido a cerrar). El resto se organiza en
 * secciones por tipo, con su color: pronósticos (morado), survivor (rojo),
 * quiniela (verde), eliminatorias (azul).
 */
@Component({
  selector: 'app-inicio',
  standalone: true,
  imports: [CommonModule, NavComponent, CargandoComponent, EscudoComponent],
  template: `
    <div class="screen">
      <app-nav [minimal]="true" title="Inicio" [ocultarSaldo]="true" />

      @if (cargando()) {
        <app-cargando texto="Cargando tu inicio" />
      } @else {
        <!-- Saludo con avatar + stats compactos (toca para ir a tu perfil) -->
        <button class="saludo" (click)="ir('/perfil')">
          <span class="saludo-avatar">{{ inicial() }}</span>
          <span class="saludo-txt">
            <span class="hola">¡Hola, {{ alias() || 'jugador' }}! 👋</span>
            <span class="lema">Demuestra cuánto sabes de fútbol 🔥</span>
            <span class="intro">Esto es todo lo que tienes en juego ahora mismo.</span>
            <span class="stats">
              <span class="stat"><b>{{ puntos() | number }}</b> pts</span>
              @if (racha() > 0) {
                <span class="stat"><i class="ti ti-flame"></i> <b>{{ racha() }}</b></span>
              }
              @if (trofeos() > 0) {
                <span class="stat"><i class="ti ti-trophy"></i> <b>{{ trofeos() }}</b></span>
              }
            </span>
          </span>
          <i class="ti ti-chevron-right"></i>
        </button>

        @if (todoVacio()) {
          <div class="vacio">
            <i class="ti ti-ball-football"></i>
            <p>Aún no tienes nada en juego.</p>
            <p class="pista">En cuanto se abra un partido o te inviten a un torneo, aparecerá aquí.</p>
          </div>
        }

        <!-- TARJETA DESTACADA: lo más relevante para actuar ahora -->
        @if (destacado(); as d) {
          <button class="destacado" [class]="'destacado--' + d.tipo" (click)="ir(d.ruta)">
            <span class="destacado-top">
              <i class="ti" [class]="d.icono"></i>
              <span class="destacado-eti">{{ d.etiqueta }}</span>
            </span>
            <span class="destacado-nom">{{ d.titulo }}</span>
            <span class="destacado-sub">{{ d.sub }}</span>
          </button>
        }

        <!-- PARTIDOS (morado) -->
        @if (partidosAbiertos().length > 0) {
          <section class="bloque bloque--pron">
            <div class="bloque-cab">
              <span class="bloque-tit"><i class="ti ti-ticket"></i> Partidos abiertos</span>
              <button class="bloque-ver" (click)="ir('/partidos')">Ver todos</button>
            </div>
            @for (m of partidosAbiertos().slice(0, 3); track m.id) {
              <button class="fila" (click)="ir('/pronosticar/' + m.id)">
                <span class="fila-teams">
                  <app-escudo [equipo]="m.homeTeam" [size]="24" />
                  <span class="fila-vs">vs</span>
                  <app-escudo [equipo]="m.awayTeam" [size]="24" />
                </span>
                <span class="fila-txt">
                  <span class="fila-nom">{{ m.homeTeam }} — {{ m.awayTeam }}</span>
                  <span class="fila-sub">{{ m.competition }}</span>
                </span>
                <i class="ti ti-chevron-right"></i>
              </button>
            }
          </section>
        }

        <!-- SURVIVOR (rojo) -->
        @if (survivors().length > 0) {
          <section class="bloque bloque--surv">
            <div class="bloque-cab">
              <span class="bloque-tit"><i class="ti ti-activity-heartbeat"></i> Survivor</span>
            </div>
            @for (t of survivors(); track t.id) {
              <button class="fila" (click)="irTorneo(t)">
                <span class="fila-txt">
                  <span class="fila-nom">{{ t.nombre }}</span>
                  <span class="fila-sub">
                    {{ etiquetaEstado(t.estado) }}
                    @if (t.estado === 'en-curso') { · Jornada {{ t.jornadaActual }} }
                    @else if (t.estado === 'inscripcion' && cierre(t.cierreInscripcion); as f) { · Cierra {{ f }} }
                  </span>
                </span>
                <i class="ti ti-chevron-right"></i>
              </button>
            }
          </section>
        }

        <!-- QUINIELA (verde) -->
        @if (quinielas().length > 0) {
          <section class="bloque bloque--quin">
            <div class="bloque-cab">
              <span class="bloque-tit"><i class="ti ti-list-check"></i> Quinielas</span>
            </div>
            @for (t of quinielas(); track t.id) {
              <button class="fila fila--col" (click)="irTorneo(t)">
                <span class="fila-top">
                  <span class="fila-txt">
                    <span class="fila-nom">{{ t.nombre }}</span>
                    <span class="fila-sub">
                      {{ etiquetaEstado(t.estado) }}
                      @if (t.estado === 'inscripcion' && cierre(t.cierreInscripcion); as f) { · Cierra {{ f }} }
                    </span>
                  </span>
                  <i class="ti ti-chevron-right"></i>
                </span>
                @if (t.estado === 'en-curso' && t.jornadas && t.jornadas > 0) {
                  <span class="progreso">
                    <span class="progreso-barra">
                      <span class="progreso-fill" [style.width.%]="pct(t.jornadaActual, t.jornadas)"></span>
                    </span>
                    <span class="progreso-txt">Jornada {{ t.jornadaActual }} de {{ t.jornadas }}</span>
                  </span>
                }
              </button>
            }
          </section>
        }

        <!-- ELIMINATORIAS (azul) — mías + públicas abiertas -->
        @if (eliminatorias().length > 0) {
          <section class="bloque bloque--elim">
            <div class="bloque-cab">
              <span class="bloque-tit"><i class="ti ti-sitemap"></i> Eliminatorias</span>
            </div>
            @for (b of eliminatorias(); track b.id) {
              <button class="fila" (click)="ir('/eliminatorias/' + b.id)">
                <span class="fila-txt">
                  <span class="fila-nom">{{ b.nombre }}</span>
                  <span class="fila-sub">
                    {{ etiquetaEstadoBracket(b.estado) }}
                    @if (esPublicoNoMio(b)) { · Abierta para unirse }
                    @if (cierre(b.cierraAt); as f) { · Cierra {{ f }} }
                  </span>
                </span>
                <i class="ti ti-chevron-right"></i>
              </button>
            }
          </section>
        }

        <!-- ABIERTOS PARA UNIRSE — al final. Torneos/eliminatorias públicos en
             inscripción; solo un adelanto (uno de cada tipo) + "Ver más".
             Cada fila usa el color de SU tipo (no se mezclan). -->
        @if (abiertosPublicos().length > 0) {
          <section class="bloque bloque--abiertos">
            <div class="bloque-cab">
              <span class="bloque-tit bloque-tit--abiertos">
                <span class="bloque-tit-ico"><i class="ti ti-flame"></i></span>
                <span class="bloque-tit-txt">
                  <span class="bloque-tit-main">¡Únete a la acción!</span>
                  <span class="bloque-tit-sub">Torneos y quinielas abiertos ahora</span>
                </span>
              </span>
              @if (totalAbiertosPublicos() > abiertosPublicos().length) {
                <button class="bloque-ver" (click)="ir('/torneos')">Ver más</button>
              }
            </div>
            @for (a of abiertosPublicos(); track a.nombre) {
              <button class="fila fila--unirse" [class]="'fila--' + a.clase" (click)="a.accion()">
                <span class="fila-icono"><i class="ti" [class]="a.icono"></i></span>
                <span class="fila-txt">
                  <span class="fila-nom">{{ a.nombre }}</span>
                  <span class="fila-sub">{{ a.sub }} · Abierto para unirse</span>
                </span>
                <span class="unete-badge">Únete</span>
              </button>
            }
          </section>
        }

        <!-- Acceso a las novedades de esta versión (mismo modal que el login).
             Va al final: es informativo, no una acción del día a día. -->
        <button
          class="novedades"
          [class.novedades--nuevo]="hayNovedades()"
          (click)="verNovedades()"
        >
          <span class="novedades-ico"><i class="ti ti-sparkles"></i></span>
          <span class="novedades-txt">
            <span class="novedades-tit">Novedades</span>
            <span class="novedades-sub">Descubre lo nuevo de esta versión</span>
          </span>
          @if (hayNovedades()) {
            <span class="novedades-badge">Nuevo</span>
          } @else {
            <i class="ti ti-chevron-right"></i>
          }
        </button>
      }
    </div>
  `,
  styles: [
    `
      /* Layout en columna a toda la altura útil: así la tarjeta de novedades
         (con margin-top:auto) se pega al fondo cuando hay poco contenido, y
         queda al final del scroll cuando hay más. */
      .screen {
        padding-bottom: 96px;
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        min-height: 100dvh;
      }
      /* La app de carga ocupa el hueco para centrarse verticalmente. */
      app-cargando { flex: 1; }

      /* Saludo con avatar + stats compactos */
      .saludo {
        width: 100%; display: flex; align-items: center; gap: 12px; text-align: left;
        margin: 4px 0 16px; padding: 12px 14px; cursor: pointer;
        border: 1px solid var(--border); border-radius: var(--radius-lg);
        background: var(--surface-1);
      }
      .saludo-avatar {
        flex-shrink: 0; width: 46px; height: 46px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        background: var(--accent-fill); color: #fff; font-size: 18px; font-weight: 700;
      }
      .saludo-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
      .hola { font-size: 17px; font-weight: 800; color: var(--text-primary); }
      .lema { font-size: 12px; color: var(--tipo-surv-fill); font-weight: 600; }
      .intro { font-size: 12px; color: var(--text-secondary); }
      .stats { display: flex; gap: 12px; margin-top: 4px; }
      .stat { font-size: 12px; color: var(--text-secondary); display: inline-flex; align-items: center; gap: 3px; }
      .stat b { color: var(--text-primary); font-weight: 700; }
      .stat .ti-flame { color: var(--tipo-surv-fill); font-size: 13px; }
      .stat .ti-trophy { color: #c99a2e; font-size: 13px; }
      .saludo > .ti-chevron-right { color: var(--text-muted); flex-shrink: 0; }

      /* Acceso a novedades: fila con acento azul; pulsa solo si hay algo nuevo */
      .novedades {
        width: 100%; display: flex; align-items: center; gap: 12px; text-align: left;
        /* margin-top:auto la empuja al fondo cuando sobra espacio; con
           contenido de más, actúa como margen normal y queda al final. */
        margin: auto 0 0; padding: 12px 14px; cursor: pointer;
        border: 1px solid rgba(55, 138, 221, 0.4); border-radius: var(--radius-lg);
        background: linear-gradient(
          135deg,
          rgba(55, 138, 221, 0.14),
          rgba(55, 138, 221, 0.04)
        );
      }
      .novedades--nuevo { animation: novedades-pulso 2.4s ease-in-out infinite; }
      .novedades-ico {
        flex-shrink: 0; width: 38px; height: 38px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        background: var(--accent-fill); color: #fff; font-size: 19px;
      }
      .novedades-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      .novedades-tit { font-size: 14px; font-weight: 700; color: var(--text-primary); }
      .novedades-sub { font-size: 12px; color: var(--text-secondary); }
      .novedades-badge {
        flex-shrink: 0; font-size: 10px; font-weight: 800; letter-spacing: 0.4px; text-transform: uppercase;
        padding: 3px 8px; border-radius: 999px;
        background: var(--accent-fill); color: #fff;
      }
      .novedades > .ti-chevron-right { color: var(--text-muted); flex-shrink: 0; }
      @keyframes novedades-pulso {
        0%, 100% { box-shadow: 0 0 0 0 transparent; }
        50% { box-shadow: 0 0 0 3px rgba(55, 138, 221, 0.28); }
      }
      @media (prefers-reduced-motion: reduce) {
        .novedades--nuevo { animation: none; }
      }

      /* Tarjeta destacada: fondo de color con texto blanco */
      .destacado {
        width: 100%; display: flex; flex-direction: column; gap: 3px; text-align: left;
        margin: 0 0 16px; padding: 16px; cursor: pointer;
        border: none; border-radius: var(--radius-lg); color: #fff;
      }
      .destacado--surv { background: var(--tipo-surv-fill); }
      .destacado--quin { background: var(--tipo-quin-fill); }
      .destacado--elim { background: var(--tipo-elim-fill); }
      .destacado--pron { background: var(--tipo-pron-fill); }
      .destacado-top { display: flex; align-items: center; gap: 7px; margin-bottom: 5px; }
      .destacado-top .ti { font-size: 17px; }
      .destacado-eti { font-size: 11px; opacity: 0.9; letter-spacing: 0.5px; text-transform: uppercase; }
      .destacado-nom { font-size: 18px; font-weight: 800; }
      .destacado-sub { font-size: 13px; opacity: 0.92; }

      .vacio { text-align: center; padding: 40px 24px; color: var(--text-muted); }
      .vacio i { font-size: 40px; opacity: 0.5; }
      .vacio p { margin: 10px 0 0; font-size: 14px; }
      .vacio .pista { font-size: 12px; }

      /* Bloques: tarjeta + borde izquierdo de color */
      .bloque {
        margin: 0 0 16px; padding: 14px; border-radius: var(--radius-lg);
        border: 1px solid var(--border); border-left: 4px solid var(--c-fill);
        background: var(--surface-1);
      }
      .bloque--pron { --c-fill: var(--tipo-pron-fill); }
      .bloque--surv { --c-fill: var(--tipo-surv-fill); }
      .bloque--quin { --c-fill: var(--tipo-quin-fill); }
      .bloque--elim { --c-fill: var(--tipo-elim-fill); }

      .bloque-cab { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .bloque-tit { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 700; color: var(--c-fill); }
      .bloque-ver { background: transparent; border: none; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--text-secondary); }

      .fila {
        width: 100%; display: flex; align-items: center; gap: 11px; text-align: left;
        padding: 11px; margin-bottom: 7px; cursor: pointer;
        background: var(--surface-0); border: 1px solid var(--border); border-radius: var(--radius);
      }
      .fila:last-child { margin-bottom: 0; }
      .fila--col { flex-direction: column; align-items: stretch; gap: 9px; }
      .fila-top { display: flex; align-items: center; gap: 11px; }
      .fila-teams { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
      .fila-vs { font-size: 11px; color: var(--text-muted); }
      .fila-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .fila-nom { font-size: 14px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fila-sub { font-size: 12px; color: var(--text-secondary); }
      .fila > .ti-chevron-right, .fila-top > .ti-chevron-right { color: var(--text-muted); flex-shrink: 0; }

      .progreso { display: flex; flex-direction: column; gap: 4px; }
      .progreso-barra { height: 6px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
      .progreso-fill { display: block; height: 100%; background: var(--tipo-quin-fill); border-radius: 999px; transition: width 0.3s ease; }
      .progreso-txt { font-size: 11px; color: var(--text-muted); }

      /* Sección "Abiertos para unirse". El bloque no tiene color fijo: cada
         fila lleva el color de SU tipo en --c-fila, así no se mezclan. */
      .bloque--abiertos { --c-fill: var(--text-secondary); }

      /* Encabezado más llamativo para invitar a unirse. Sin color de tipo
         (el rojo es exclusivo de survivor); usa el neutro del tema. */
      .bloque-tit--abiertos { align-items: center; gap: 9px; }
      .bloque-tit-ico {
        flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        color: var(--c-fill);
        animation: tit-late 1.8s ease-in-out infinite;
      }
      .bloque-tit-ico .ti { font-size: 22px; }
      .bloque-tit-txt { display: flex; flex-direction: column; gap: 1px; line-height: 1.2; }
      .bloque-tit-main { font-size: 15px; font-weight: 800; color: var(--text-primary); letter-spacing: 0.2px; }
      .bloque-tit-sub { font-size: 11px; font-weight: 500; color: var(--text-secondary); }

      @keyframes tit-late {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.12); }
      }
      @media (prefers-reduced-motion: reduce) {
        .bloque-tit-ico { animation: none; }
      }

      .fila--unirse {
        --c-fila: var(--text-muted);
        border-left: 4px solid var(--c-fila);
      }
      /* Énfasis en el nombre de la fila que se puede unir. */
      .fila--unirse .fila-nom { font-weight: 700; color: var(--text-primary); }
      .fila--surv { --c-fila: var(--tipo-surv-fill); }
      .fila--quin { --c-fila: var(--tipo-quin-fill); }
      .fila--elim { --c-fila: var(--tipo-elim-fill); }

      .fila-icono {
        flex-shrink: 0; width: 30px; height: 30px; border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        background: color-mix(in srgb, var(--c-fila) 15%, transparent);
        color: var(--c-fila);
      }
      .fila-icono .ti { font-size: 16px; }
      .unete-badge {
        flex-shrink: 0; font-size: 11px; font-weight: 700;
        padding: 3px 9px; border-radius: 999px;
        background: var(--c-fila);
        color: #fff;
        animation: unete-pulso 2.2s ease-in-out infinite;
      }

      @keyframes unete-pulso {
        0%, 100% { box-shadow: 0 0 0 0 transparent; }
        50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--c-fila) 35%, transparent); }
      }
      @media (prefers-reduced-motion: reduce) {
        .unete-badge {
          animation: none;
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--c-fila) 30%, transparent);
        }
      }
    `,
  ],
})
export class InicioComponent {
  private readonly partidosSrv = inject(PartidosService);
  private readonly torneosSrv = inject(TorneosService);
  private readonly bracketsSrv = inject(BracketsService);
  private readonly usersSrv = inject(UserService);
  private readonly router = inject(Router);
  private readonly contexto = inject(ContextoService);
  private readonly gruposSrv = inject(GruposService);
  private readonly stats = inject(StatsService);
  private readonly novedadesSrv = inject(NovedadesService);

  /**
   * ¿Hay novedades sin ver? Enciende el badge "Nuevo" y el pulso del acceso.
   * Es signal para que, al abrir el modal (que marca la versión como vista),
   * el badge desaparezca al instante sin recargar.
   */
  readonly hayNovedades = signal(this.novedadesSrv.hayNuevo());

  /** Abre el modal de novedades (mismo que el login) y apaga el badge. */
  verNovedades(): void {
    this.stats.evento('novedades_abiertas', { origen: 'inicio' });
    this.novedadesSrv.abrir();
    this.hayNovedades.set(this.novedadesSrv.hayNuevo());
  }

  // undefined = todavía no cargó de Firestore; [] = cargó y no tiene grupos.
  // Distinguirlos evita resolver el contexto con la lista vacía inicial (que
  // forzaría Global antes de que los grupos lleguen).
  private readonly misGruposRaw = toSignal(
    this.gruposSrv.misGrupos() as Observable<Grupo[] | undefined>,
  );
  private readonly misGrupos = computed(() => this.misGruposRaw() ?? []);

  constructor() {
    // Traza del embudo: el usuario llegó al hub de inicio.
    this.stats.evento('hub_visto');

    // Al conocer los grupos del usuario, decide el contexto inicial:
    // si pertenece a un grupo, entra a un grupo (no a Global por defecto).
    // Solo resolvemos cuando los grupos YA cargaron (no en el estado inicial).
    effect(() => {
      const grupos = this.misGruposRaw();
      if (grupos === undefined) return; // aún no carga: esperamos
      this.contexto.resolverInicial(grupos);
    });
  }

  readonly cargando = signal(true);
  private readonly inicioCarga = Date.now();

  /**
   * El inicio se arma con varias fuentes. Marcamos cuándo llegó el PRIMER
   * dato real de cada una (los toSignal emiten un initialValue inmediato que
   * no cuenta). El loading se apaga solo cuando todas están listas, para no
   * mostrar el dashboard a medias.
   */
  private readonly listoMe = signal(false);
  private readonly listoPartidos = signal(false);
  private readonly listoTorneos = signal(false);
  private readonly listoTorneosPublicos = signal(false);
  private readonly listoMisBrackets = signal(false);
  private readonly listoBracketsPublicos = signal(false);

  private readonly me = toSignal(
    this.usersSrv.me$.pipe(tap(() => this.listoMe.set(true))),
    { initialValue: null },
  );
  readonly alias = computed(() => this.me()?.alias ?? '');
  readonly inicial = computed(() => (this.me()?.alias ?? '?').charAt(0).toUpperCase());
  readonly puntos = computed(() => this.me()?.puntos ?? 0);
  readonly racha = computed(() => this.me()?.racha ?? 0);
  readonly trofeos = computed(() => this.me()?.torneosGanados ?? 0);

  private readonly partidos = toSignal(
    this.partidosSrv.getPartidos().pipe(tap(() => this.listoPartidos.set(true))),
    { initialValue: [] as Partido[] },
  );
  private readonly torneos = toSignal(
    this.torneosSrv.misTorneos$.pipe(tap(() => this.listoTorneos.set(true))),
    { initialValue: [] as Torneo[] },
  );
  private readonly torneosPublicos = toSignal(
    this.torneosSrv.torneosPublicos().pipe(tap(() => this.listoTorneosPublicos.set(true))),
    { initialValue: [] as Torneo[] },
  );
  private readonly misBrackets = toSignal(
    this.bracketsSrv.misBrackets().pipe(tap(() => this.listoMisBrackets.set(true))),
    { initialValue: [] as Bracket[] },
  );
  private readonly bracketsPublicos = toSignal(
    this.bracketsSrv.bracketsPublicos().pipe(tap(() => this.listoBracketsPublicos.set(true))),
    { initialValue: [] as Bracket[] },
  );

  /** Apaga el loading solo cuando TODAS las fuentes emitieron su primer dato. */
  private readonly apagar = effect(() => {
    if (
      this.listoMe() &&
      this.listoPartidos() &&
      this.listoTorneos() &&
      this.listoTorneosPublicos() &&
      this.listoMisBrackets() &&
      this.listoBracketsPublicos()
    ) {
      apagarCargando(this.cargando, this.inicioCarga);
    }
  });

  readonly partidosAbiertos = computed(() => {
    const ctx = this.contexto.grupoId();
    return this.partidos()
      .filter(
        (m) =>
          (m.grupoId ?? null) === ctx &&
          (m.status === 'abierto' || m.status === 'cierra-pronto'),
      )
      .sort((a, b) => {
        // El más próximo a cerrar primero. Sin fecha, al final.
        const fa = fechaCierre(a)?.getTime() ?? Infinity;
        const fb = fechaCierre(b)?.getTime() ?? Infinity;
        return fa - fb;
      });
  });
  private readonly idsMiosTorneos = computed(() => new Set(this.torneos().map((t) => t.id)));

  /** Torneos del contexto: los míos (activos) + públicos abiertos donde aún no estoy. */
  private readonly torneosVista = computed(() => {
    const ctx = this.contexto.grupoId();
    const mios = this.torneos().filter(
      (t) => (t.grupoId ?? null) === ctx && t.estado !== 'finalizado',
    );
    const publicosNuevos = this.torneosPublicos().filter(
      (t) => (t.grupoId ?? null) === ctx && !this.idsMiosTorneos().has(t.id),
    );
    return [...mios, ...publicosNuevos];
  });

  // Las secciones por tipo muestran lo MÍO. Los públicos abiertos donde aún
  // no participo van a su propia sección "Abiertos para unirse", así que aquí
  // los excluimos para no duplicarlos.
  readonly survivors = computed(() =>
    this.torneosVista().filter(
      (t) => (t.modo ?? 'supervivencia') === 'supervivencia' && !this.esPublicoNoMioTorneo(t),
    ),
  );
  readonly quinielas = computed(() =>
    this.torneosVista().filter((t) => t.modo === 'quiniela' && !this.esPublicoNoMioTorneo(t)),
  );

  /**
   * Torneos y eliminatorias PÚBLICOS abiertos a inscripción donde aún no
   * participo, del contexto actual. Es la sección para descubrir y unirse.
   * Cada item lleva su tipo para pintar el color propio (no se mezclan).
   */
  private readonly torneosAbiertosPublicos = computed(() =>
    this.torneosVista()
      .filter((t) => this.esPublicoNoMioTorneo(t) && t.estado === 'inscripcion')
      .map((t) => ({
        clase: (t.modo === 'quiniela' ? 'quin' : 'surv') as 'quin' | 'surv',
        icono: t.modo === 'quiniela' ? 'ti-list-check' : 'ti-activity-heartbeat',
        nombre: t.nombre,
        sub: t.modo === 'quiniela' ? 'Quiniela' : 'Survivor',
        accion: () => this.irTorneo(t),
      })),
  );

  private readonly bracketsAbiertosPublicos = computed(() =>
    this.eliminatoriasBase()
      .filter((b) => this.esPublicoNoMio(b) && b.estado === 'inscripcion')
      .map((b) => ({
        clase: 'elim' as const,
        icono: 'ti-sitemap',
        nombre: b.nombre,
        sub: 'Eliminatoria',
        accion: () => this.ir('/eliminatorias/' + b.id),
      })),
  );

  /** Total disponible, para decidir si mostramos "Ver más". */
  readonly totalAbiertosPublicos = computed(
    () => this.torneosAbiertosPublicos().length + this.bracketsAbiertosPublicos().length,
  );

  /**
   * En el hub mostramos un adelanto de hasta 3 abiertos, de cualquier tipo.
   * El resto se ve con "Ver más" en la lista completa de torneos.
   */
  readonly abiertosPublicos = computed(() =>
    [...this.torneosAbiertosPublicos(), ...this.bracketsAbiertosPublicos()].slice(0, 3),
  );

  /** ¿Es un torneo público abierto en el que aún no participo? */
  esPublicoNoMioTorneo(t: Torneo): boolean {
    return !this.idsMiosTorneos().has(t.id);
  }

  /** Abre el torneo: si es público y no estoy, va a la pantalla de unirse. */
  irTorneo(t: Torneo): void {
    if (this.esPublicoNoMioTorneo(t)) {
      this.router.navigate(['/unirse', t.codigo]);
      return;
    }
    this.router.navigate(['/torneos', t.id]);
  }

  private readonly idsMios = computed(() => new Set(this.misBrackets().map((b) => b.id)));

  /** Eliminatorias mías (activas) + públicas abiertas donde aún no estoy, sin duplicar. */
  private readonly eliminatoriasBase = computed(() => {
    const ctx = this.contexto.grupoId();
    const mias = this.misBrackets().filter(
      (b) => (b.grupoId ?? null) === ctx && b.estado !== 'finalizado',
    );
    const publicasNuevas = this.bracketsPublicos().filter(
      (b) => (b.grupoId ?? null) === ctx && !this.idsMios().has(b.id),
    );
    return [...mias, ...publicasNuevas];
  });

  /**
   * Sección "Eliminatorias" de la vista: solo las MÍAS. Las públicas abiertas
   * donde aún no participo se muestran en "Abiertos para unirse".
   */
  readonly eliminatorias = computed(() =>
    this.eliminatoriasBase().filter((b) => !this.esPublicoNoMio(b)),
  );

  esPublicoNoMio(b: Bracket): boolean {
    return !this.idsMios().has(b.id);
  }

  /**
   * Lo más relevante para mostrar destacado. Prioriza torneos en curso
   * (donde el jugador debe actuar), luego una quiniela/survivor en
   * inscripción, y como último recurso el próximo partido por cerrar.
   * Devuelve null si no hay nada, y entonces no se pinta la tarjeta.
   */
  readonly destacado = computed(() => {
    const survEnCurso = this.survivors().find((t) => t.estado === 'en-curso');
    if (survEnCurso) {
      return {
        tipo: 'surv',
        icono: 'ti-activity-heartbeat',
        etiqueta: 'Survivor · en curso',
        titulo: survEnCurso.nombre,
        sub: `Jornada ${survEnCurso.jornadaActual} · elige tu equipo`,
        ruta: '/torneos/' + survEnCurso.id,
      };
    }
    const quinEnCurso = this.quinielas().find((t) => t.estado === 'en-curso');
    if (quinEnCurso) {
      return {
        tipo: 'quin',
        icono: 'ti-list-check',
        etiqueta: 'Quiniela · en curso',
        titulo: quinEnCurso.nombre,
        sub: `Jornada ${quinEnCurso.jornadaActual} · captura tus marcadores`,
        ruta: '/torneos/' + quinEnCurso.id,
      };
    }
    const elimEnCurso = this.eliminatorias().find((b) => b.estado === 'en-curso');
    if (elimEnCurso) {
      return {
        tipo: 'elim',
        icono: 'ti-sitemap',
        etiqueta: 'Eliminatoria · en curso',
        titulo: elimEnCurso.nombre,
        sub: 'Sigue tu cuadro',
        ruta: '/eliminatorias/' + elimEnCurso.id,
      };
    }
    const prox = this.partidosAbiertos()[0];
    if (prox) {
      return {
        tipo: 'pron',
        icono: 'ti-ticket',
        etiqueta: 'Partido abierto',
        titulo: `${prox.homeTeam} — ${prox.awayTeam}`,
        sub: prox.competition + ' · toca para pronosticar',
        ruta: '/pronosticar/' + prox.id,
      };
    }
    return null;
  });

  readonly todoVacio = computed(
    () =>
      this.partidosAbiertos().length === 0 &&
      this.survivors().length === 0 &&
      this.quinielas().length === 0 &&
      this.eliminatorias().length === 0 &&
      this.abiertosPublicos().length === 0,
  );

  ir(ruta: string): void {
    this.router.navigate([ruta]);
  }

  pct(actual: number, total: number): number {
    if (!total) return 0;
    return Math.min(100, Math.round((actual / total) * 100));
  }

  cierre(f: { seconds: number } | Date | null | undefined): string | null {
    if (!f) return null;
    const d = f instanceof Date ? f : new Date(f.seconds * 1000);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  etiquetaEstado(estado: string): string {
    const m: Record<string, string> = {
      inscripcion: 'Abierto para unirse',
      'en-curso': 'En curso',
      finalizado: 'Finalizado',
    };
    return m[estado] ?? estado;
  }

  etiquetaEstadoBracket(estado: string): string {
    const m: Record<string, string> = {
      armando: 'Armándose',
      inscripcion: 'Abierta',
      'en-curso': 'En curso',
      finalizado: 'Finalizada',
    };
    return m[estado] ?? estado;
  }
}