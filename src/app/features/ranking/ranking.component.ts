import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { tap } from 'rxjs/operators';
import { Auth, user } from '@angular/fire/auth';
import { NavComponent } from '../../shared/nav.component';
import { CargandoComponent } from '../../shared/cargando.component';
import { apagarCargando } from '../../shared/cargando.util';
import {
  RankingService,
  FilaRanking,
  RankingDoc,
  TOP_LIMITE,
} from '../../core/services/ranking.service';
import { UserService } from '../../core/services/user.service';
import { ContextoService } from '../../shared/contexto.service';
import { GruposService } from '../../core/services/grupos.service';
import { FilaTablaGrupo } from '../../core/models/grupo.model';
import { switchMap } from 'rxjs/operators';
import { of } from 'rxjs';

type Vista = 'porcentaje' | 'balance';

@Component({
  selector: 'app-ranking',
  standalone: true,
  imports: [CommonModule, NavComponent, CargandoComponent],
  template: `
    <div class="screen">
      <app-nav title="Clasificación" />

      <div class="head">
        <span class="head-title">
          @if (enGrupo()) {
            <i class="ti ti-users-group"></i> {{ nombreContexto() }}
          } @else {
            Clasificación global
          }
        </span>
        @if (isAdmin() && !enGrupo()) {
          <div class="toggle">
            <button [class.on]="vista() === 'porcentaje'" (click)="vista.set('porcentaje')">% acierto</button>
            <button [class.on]="vista() === 'balance'" (click)="vista.set('balance')">
              <i class="ti ti-scale"></i> Balance
            </button>
          </div>
        }
      </div>

      @if (enGrupo() && tabla().length === 0 && !cargando()) {
        <p class="empty">Este grupo aún no tiene tabla. Jueguen partidos del grupo para verla.</p>
      }

      @if (cargando()) {
        <app-cargando texto="Cargando la tabla" />
      } @else if (tabla().length === 0) {
        <p class="empty">Todavía no hay datos para la tabla.</p>
      } @else {
        <!-- Podio estilo F1: 2° a la izquierda, 1° al centro (más alto), 3° a la derecha. -->
        <div class="podio">
          @for (f of podioOrdenado(); track f.id) {
            <div class="col col--{{ f.posicion }}" [class.col--me]="f.id === miUid()" [class.col--clic]="isAdmin()" (click)="verPerfil(f)">
              @if (f.posicion === 1) {
                <span class="estrella"><i class="ti ti-star-filled"></i></span>
              }
              <span class="col-avatar" [class]="'col-avatar--' + f.posicion">{{ inicial(f.alias) }}</span>
              <span class="col-alias">{{ f.id === miUid() ? 'Tú' : f.alias }}</span>
              <span class="col-val">
                @if (esBalance()) {
                  {{ (f.balance ?? 0) > 0 ? '+' : '' }}{{ f.balance ?? 0 | number }} pts
                } @else {
                  {{ f.porcentaje }}%
                }
              </span>
              <span class="barra barra--{{ f.posicion }}">{{ f.posicion }}</span>
            </div>
          }
        </div>
      }

      <!-- Tu lugar, si no estás en el podio. -->
      @if (miLugar(); as f) {
        <div class="separador">
          <span>{{ estoyEnTabla() ? 'Tu lugar' : 'Fuera del top ' + limite }}</span>
        </div>
        <div class="row row--me">
          <span class="pos">{{ f.posicion }}</span>
          <span class="avatar">{{ inicial(f.alias) }}</span>
          <span class="alias">Tú</span>

          @if (esBalance()) {
            <span class="main" [class.neg]="(f.balance ?? 0) < 0">
              {{ (f.balance ?? 0) > 0 ? '+' : '' }}{{ f.balance ?? 0 | number }}
            </span>
            <span class="side side--gyg">
              <span class="ganado">+{{ f.totalGanado ?? 0 | number }}</span>
              <span class="gastado">-{{ f.totalGastado ?? 0 | number }}</span>
            </span>
          } @else {
            <span class="main">{{ f.porcentaje }}%</span>
            <span class="side">
              @if ((f.racha ?? 0) >= 3) {
                <i class="ti ti-flame fire-sm"></i>{{ f.racha }}
              } @else {
                {{ f.aciertos }}/{{ f.resueltos }}
              }
            </span>
          }
        </div>
      }

      <!-- El resto de la tabla, a un toque. -->
      @if (resto().length > 0) {
        @if (verTodos()) {
          <div class="separador"><span>Los demás</span></div>

          @for (f of resto(); track f.id) {
            <div
              class="row"
              [class.row--me]="f.id === miUid()"
              [class.row--clic]="isAdmin()"
              (click)="verPerfil(f)"
            >
              <span class="pos">{{ f.posicion }}</span>
              <span class="avatar">{{ inicial(f.alias) }}</span>
              <span class="alias">{{ f.id === miUid() ? 'Tú' : f.alias }}</span>

              @if (esBalance()) {
                <span class="main" [class.neg]="(f.balance ?? 0) < 0">
                  {{ (f.balance ?? 0) > 0 ? '+' : '' }}{{ f.balance ?? 0 | number }}
                </span>
                <span class="side side--gyg">
                  <span class="ganado">+{{ f.totalGanado ?? 0 | number }}</span>
                  <span class="gastado">-{{ f.totalGastado ?? 0 | number }}</span>
                </span>
              } @else {
                <span class="main">{{ f.porcentaje }}%</span>
                <span class="side">
                  @if ((f.racha ?? 0) >= 3) {
                    <i class="ti ti-flame fire-sm"></i>{{ f.racha }}
                  } @else {
                    {{ f.aciertos }}/{{ f.resueltos }}
                  }
                </span>
              }
            </div>
          }
        }

        <button class="ver-todos" (click)="verTodos.set(!verTodos())">
          <i class="ti" [class.ti-chevron-down]="!verTodos()" [class.ti-chevron-up]="verTodos()"></i>
          {{ verTodos() ? 'Ocultar' : 'Ver la tabla completa (' + resto().length + ')' }}
        </button>
      }
    </div>
  `,
  styles: [
    `
      /* ===== Podio estilo F1 ===== */
      .podio {
        display: flex; align-items: flex-end; justify-content: center; gap: 8px;
        margin: 8px 0 26px; min-height: 240px;
      }
      .col {
        flex: 1; display: flex; flex-direction: column; align-items: center;
        cursor: default; max-width: 120px;
      }
      .col--clic { cursor: pointer; }
      .estrella {
        font-size: 22px; color: #f1c40f; margin-bottom: 2px;
        animation: estrella-late 1.6s ease-in-out infinite;
      }
      @keyframes estrella-late {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.22); opacity: 0.7; }
      }
      .col-avatar {
        width: 46px; height: 46px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        color: #fff; font-weight: 700; font-size: 18px; margin-bottom: 6px;
      }
      .col-avatar--1 { width: 56px; height: 56px; font-size: 22px; background: var(--accent-fill); box-shadow: 0 0 0 3px #f1c40f; }
      .col-avatar--2 { background: #9aa0aa; }
      .col-avatar--3 { background: #cd7f4d; }
      .col-alias {
        font-size: 13px; font-weight: 700; color: var(--text-primary);
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .col--1 .col-alias { font-size: 14px; }
      .col-val { font-size: 11px; color: var(--text-secondary); margin-bottom: 7px; }
      .barra {
        width: 100%; border-radius: 12px 12px 0 0;
        display: flex; align-items: flex-start; justify-content: center; padding-top: 8px;
        color: #fff; font-weight: 700;
      }
      .barra--1 { height: 130px; font-size: 26px; background: linear-gradient(180deg, #f4d03f, #e0a800); }
      .barra--2 { height: 92px; font-size: 22px; background: linear-gradient(180deg, #c3c8d0, #a2a8b3); }
      .barra--3 { height: 64px; font-size: 20px; background: linear-gradient(180deg, #d98e5f, #b46a3a); }
      .col--me .col-alias { color: var(--accent-text); }

      .neg { color: var(--danger-text); }

      .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 10px; }
      .head-title { font-size: 13px; color: var(--text-secondary); }
      .toggle { display: flex; gap: 4px; }
      .toggle button {
        font-size: 12px; padding: 5px 12px; border-radius: 999px; cursor: pointer;
        border: 1px solid var(--border); background: transparent; color: var(--text-secondary);
      }
      .toggle button.on {
        background: var(--text-primary); color: var(--surface-0);
        border-color: var(--text-primary); font-weight: 600;
      }

      .empty { color: var(--text-muted); font-size: 14px; text-align: center; padding: 24px 0; }

      .row {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 8px; border-bottom: 1px solid var(--border);
      }
      .row--clic { cursor: pointer; }

      .separador {
        display: flex; align-items: center; gap: 10px;
        margin: 16px 0 8px; color: var(--text-muted); font-size: 11px;
        text-transform: uppercase; letter-spacing: 0.5px;
      }
      .separador::after {
        content: ''; flex: 1; height: 1px; background: var(--border);
      }

      .ver-todos {
        display: flex; align-items: center; justify-content: center; gap: 6px;
        width: 100%; margin-top: 14px; cursor: pointer;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: transparent; color: var(--text-secondary);
        font-size: 13px; padding: 11px;
      }
      .row--me { background: var(--accent-bg); border-radius: var(--radius); border-bottom-color: transparent; }
      .pos { width: 24px; font-size: 14px; font-weight: 600; color: var(--text-secondary); }
      .pos--top { color: var(--warning-text); }
      .avatar {
        width: 30px; height: 30px; border-radius: 50%; background: var(--surface-1);
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 600; color: var(--text-secondary);
      }
      .alias { flex: 1; font-size: 14px; font-weight: 600; }
      .main { font-size: 14px; font-weight: 600; }
      .side { width: 56px; text-align: right; font-size: 12px; color: var(--text-muted); }
      .fire-sm { color: var(--warning-text); font-size: 13px; vertical-align: -1px; margin-right: 2px; }

      /* Ganado (verde) y gastado (rojo) en la vista Balance, para diferenciarlos. */
      .side--gyg {
        width: auto; min-width: 70px; display: flex; flex-direction: column;
        align-items: flex-end; gap: 1px; line-height: 1.2;
      }
      .side--gyg .ganado { color: var(--success-text); font-weight: 600; }
      .side--gyg .gastado { color: var(--danger-text); font-weight: 600; }

      .note { font-size: 11px; color: var(--text-muted); text-align: center; margin-top: 14px; }

    `,
  ],
})
export class RankingComponent {
  private readonly service = inject(RankingService);
  private readonly router = inject(Router);
  private readonly users = inject(UserService);
  private readonly auth = inject(Auth);
  private readonly contexto = inject(ContextoService);
  private readonly gruposSrv = inject(GruposService);

  /** ¿Estamos viendo un grupo? (si no, es Global) */
  readonly enGrupo = computed(() => this.contexto.grupoId() !== null);
  readonly nombreContexto = computed(() => this.contexto.actual().nombre);

  /** Marca cuándo llegó el primer dato de cada fuente de tabla. */
  private readonly listoGlobal = signal(false);
  private readonly listoGrupo = signal(false);

  /** Tabla del grupo activo (vacía si estamos en Global). */
  private readonly tablaGrupo = toSignal(
    toObservable(this.contexto.grupoId).pipe(
      switchMap((gid) => (gid ? this.gruposSrv.tabla(gid) : of([] as FilaTablaGrupo[]))),
      tap(() => this.listoGrupo.set(true)),
    ),
    { initialValue: [] as FilaTablaGrupo[] },
  );

  readonly limite = TOP_LIMITE;
  readonly isAdmin = toSignal(this.users.isAdmin$, { initialValue: false });

  private readonly authUser = toSignal(user(this.auth), { initialValue: null });
  readonly miUid = computed(() => this.authUser()?.uid ?? '');

  readonly vista = signal<Vista>('porcentaje');
  readonly miPosicion = signal<number | null>(null);

  /** ¿Vista de balance activa? (solo admin, fuera de grupo). */
  readonly esBalance = computed(() => this.vista() === 'balance' && this.isAdmin() && !this.enGrupo());

  /** Mi fila: una sola lectura, independiente de la tabla. */
  readonly miFila = toSignal(this.service.miFila(), { initialValue: null });

  private readonly topBalance = toSignal(this.service.topBalance(), {
    initialValue: [] as RankingDoc[],
  });
  /** True hasta que llegan los primeros datos de la tabla. */
  readonly cargando = signal(true);
  private readonly inicioCarga = Date.now();

  private readonly topPorcentaje = toSignal(
    this.service.topPorcentaje().pipe(tap(() => this.listoGlobal.set(true))),
    { initialValue: [] as RankingDoc[] },
  );

  /**
   * Apaga el loading según el contexto: en un grupo espera la tabla del grupo;
   * en global espera el ranking general. Así no se ve la tabla vacía mientras
   * llega la fuente que de verdad se está mostrando.
   */
  private readonly apagar = effect(() => {
    const listo = this.enGrupo() ? this.listoGrupo() : this.listoGlobal();
    if (listo) {
      apagarCargando(this.cargando, this.inicioCarga);
    }
  });

  constructor() {
    // Recalcula la posición cuando cambia la vista o mis números.
    effect(() => {
      const f = this.miFila();
      const v = this.vista();
      if (!f) {
        this.miPosicion.set(null);
        return;
      }
      // Si ya aparezco en la tabla cargada, uso esa posición: es exacta y gratis.
      const enTabla = this.tabla().find((x) => x.id === this.miUid());
      if (enTabla) {
        this.miPosicion.set(enTabla.posicion);
        return;
      }

      // Si no aparezco (estoy fuera del top), pregunto al servidor. La vista
      // balance no tiene consulta de posición propia, así que ahí no calculamos.
      const p =
        v === 'balance'
          ? Promise.resolve(0)
          : f.calificado
            ? this.service.miPosicionPorPorcentaje(f.porcentaje)
            : Promise.resolve(0);

      p.then((n) => this.miPosicion.set(n || null)).catch(() => this.miPosicion.set(null));
    });
  }

  /** Tabla ordenada con desempates; los empates reales comparten lugar. */
  readonly tabla = computed<FilaRanking[]>(() => {
    // Si estamos en un grupo, la tabla viene de ese grupo (solo por %).
    if (this.enGrupo()) {
      const filas = [...this.tablaGrupo()]
        .sort((a, b) => b.porcentaje - a.porcentaje || b.aciertos - a.aciertos)
        .map((f, i) => ({
          id: f.uid,
          alias: f.alias,
          puntos: 0,
          aciertos: f.aciertos,
          resueltos: f.resueltos,
          porcentaje: f.porcentaje,
          calificado: true,
          posicion: i + 1,
        }) as FilaRanking);
      return filas;
    }

    const esBalance = this.esBalance();
    const base = [...(esBalance ? this.topBalance() : this.topPorcentaje())];

    // Desempate según la vista activa.
    base.sort((a, b) => {
      if (esBalance) {
        const bb = b.balance ?? 0;
        const ba = a.balance ?? 0;
        if (bb !== ba) return bb - ba;
        return a.alias.localeCompare(b.alias, 'es');
      }
      if (b.porcentaje !== a.porcentaje) return b.porcentaje - a.porcentaje;
      if (b.resueltos !== a.resueltos) return b.resueltos - a.resueltos;
      const rb = b.mejorRacha ?? 0;
      const ra = a.mejorRacha ?? 0;
      if (rb !== ra) return rb - ra;
      return a.alias.localeCompare(b.alias, 'es');
    });

    // Posiciones consecutivas: 1, 2, 3, 4... sin lugares compartidos.
    return base.map((f, i) => ({ ...f, posicion: i + 1 }));
  });

  /** El perfil ajeno es, por ahora, solo para administradores. */
  /** ¿Está desplegada la tabla completa? */
  readonly verTodos = signal(false);

  /** Los tres primeros lugares. */
  readonly podio = computed(() => this.tabla().slice(0, 3));

  /**
   * El podio en orden visual de F1: 2° a la izquierda, 1° al centro,
   * 3° a la derecha. Si hay menos de 3, respeta lo que haya.
   */
  readonly podioOrdenado = computed(() => {
    const top = this.tabla().slice(0, 3);
    const p1 = top.find((f) => f.posicion === 1);
    const p2 = top.find((f) => f.posicion === 2);
    const p3 = top.find((f) => f.posicion === 3);
    return [p2, p1, p3].filter((f): f is FilaRanking => !!f);
  });

  /**
   * Mi fila destacada. Se muestra cuando no estoy en el podio y mi lugar
   * no se ve ya en la tabla: al desplegarla se oculta para no duplicarme,
   * salvo que esté fuera del top y no aparezca de ninguna otra forma.
   */
  readonly miLugar = computed<FilaRanking | null>(() => {
    const yo = this.tabla().find((f) => f.id === this.miUid());

    if (yo) {
      if (yo.posicion <= 3) return null;
      return this.verTodos() ? null : yo;
    }

    // Fuera del top: es el único sitio donde puedo verme.
    const fuera = this.miFila();
    const posicion = this.miPosicion();
    if (!fuera || !posicion) return null;
    return { ...fuera, posicion } as FilaRanking;
  });

  /** ¿Aparezco dentro de la tabla que se está mostrando? */
  readonly estoyEnTabla = computed(() =>
    this.tabla().some((f) => f.id === this.miUid()),
  );

  /** Todos los que no están en el podio. */
  readonly resto = computed(() => this.tabla().slice(3));

  verPerfil(f: RankingDoc): void {
    if (!this.isAdmin()) return;
    this.router.navigate(['/perfil', f.id]);
  }

  inicial(alias: string): string {
    return (alias?.[0] ?? '?').toUpperCase();
  }
}