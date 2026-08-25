import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { tap } from 'rxjs/operators';
import { NavComponent } from '../../shared/nav.component';
import { CargandoComponent } from '../../shared/cargando.component';
import { apagarCargando } from '../../shared/cargando.util';
import { EscudoComponent } from '../../shared/escudo.component';
import { PartidosService } from '../../core/services/partidos.service';
import { TorneosService } from '../../core/services/torneos.service';
import { BracketsService } from '../../core/services/brackets.service';
import { UserService } from '../../core/services/user.service';
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
              <button class="fila" (click)="ir('/torneos/' + t.id)">
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
              <button class="fila fila--col" (click)="ir('/torneos/' + t.id)">
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
      }
    </div>
  `,
  styles: [
    `
      .screen { padding-bottom: 96px; }

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
    `,
  ],
})
export class InicioComponent {
  private readonly partidosSrv = inject(PartidosService);
  private readonly torneosSrv = inject(TorneosService);
  private readonly bracketsSrv = inject(BracketsService);
  private readonly usersSrv = inject(UserService);
  private readonly router = inject(Router);

  readonly cargando = signal(true);
  private readonly inicioCarga = Date.now();

  private readonly me = toSignal(this.usersSrv.me$, { initialValue: null });
  readonly alias = computed(() => this.me()?.alias ?? '');
  readonly inicial = computed(() => (this.me()?.alias ?? '?').charAt(0).toUpperCase());
  readonly puntos = computed(() => this.me()?.puntos ?? 0);
  readonly racha = computed(() => this.me()?.racha ?? 0);
  readonly trofeos = computed(() => this.me()?.torneosGanados ?? 0);

  private readonly partidos = toSignal(
    this.partidosSrv.getPartidos().pipe(tap(() => apagarCargando(this.cargando, this.inicioCarga))),
    { initialValue: [] as Partido[] },
  );
  private readonly torneos = toSignal(this.torneosSrv.misTorneos$, { initialValue: [] as Torneo[] });
  private readonly misBrackets = toSignal(this.bracketsSrv.misBrackets(), { initialValue: [] as Bracket[] });
  private readonly bracketsPublicos = toSignal(this.bracketsSrv.bracketsPublicos(), { initialValue: [] as Bracket[] });

  readonly partidosAbiertos = computed(() =>
    this.partidos()
      .filter((m) => m.status === 'abierto' || m.status === 'cierra-pronto')
      .sort((a, b) => {
        // El más próximo a cerrar primero. Sin fecha, al final.
        const fa = fechaCierre(a)?.getTime() ?? Infinity;
        const fb = fechaCierre(b)?.getTime() ?? Infinity;
        return fa - fb;
      }),
  );
  readonly survivors = computed(() =>
    this.torneos().filter((t) => (t.modo ?? 'supervivencia') === 'supervivencia' && t.estado !== 'finalizado'),
  );
  readonly quinielas = computed(() =>
    this.torneos().filter((t) => t.modo === 'quiniela' && t.estado !== 'finalizado'),
  );

  private readonly idsMios = computed(() => new Set(this.misBrackets().map((b) => b.id)));

  /** Eliminatorias mías (activas) + públicas abiertas donde aún no estoy, sin duplicar. */
  readonly eliminatorias = computed(() => {
    const mias = this.misBrackets().filter((b) => b.estado !== 'finalizado');
    const publicasNuevas = this.bracketsPublicos().filter((b) => !this.idsMios().has(b.id));
    return [...mias, ...publicasNuevas];
  });

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
      this.eliminatorias().length === 0,
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