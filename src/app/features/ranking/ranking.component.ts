import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Auth, user } from '@angular/fire/auth';
import { NavComponent } from '../../shared/nav.component';
import {
  RankingService,
  FilaRanking,
  RankingDoc,
  TOP_LIMITE,
} from '../../core/services/ranking.service';
import { UserService } from '../../core/services/user.service';

type Vista = 'puntos' | 'porcentaje';

@Component({
  selector: 'app-ranking',
  standalone: true,
  imports: [CommonModule, NavComponent],
  template: `
    <div class="screen">
      <app-nav title="Estadísticas" />

      @if (miFila(); as y) {
        <div class="cards">
          <div class="card">
            <div class="card-label">% de acierto</div>
            <div class="card-val accent">{{ y.porcentaje }}%</div>
          </div>
          <div class="card">
            <div class="card-label">Aciertos</div>
            <div class="card-val">{{ y.aciertos }} <span class="soft">/ {{ y.resueltos }}</span></div>
          </div>
          <div class="card">
            <div class="card-label">Posición</div>
            <div class="card-val">{{ miPosicion() ? '#' + miPosicion() : '—' }}</div>
          </div>
          <div class="card">
            <div class="card-label">Puntos históricos</div>
            <div class="card-val" [class.neg]="y.puntos < 0">{{ y.puntos | number }}</div>
          </div>
          <div class="card card--wide">
            <div class="card-label">Racha actual</div>
            <div class="card-val">
              {{ y.racha ?? 0 }}
              @if ((y.racha ?? 0) > 0) {
                <i class="ti ti-flame fire"></i>
              }
              <span class="soft">· mejor {{ y.mejorRacha ?? 0 }}</span>
            </div>
          </div>
        </div>
      } @else {
        <div class="cards-empty">
          Aún no tienes estadísticas. Haz tu primer pronóstico para aparecer aquí.
        </div>
      }

      <div class="head">
        <span class="head-title">Clasificación</span>
        <div class="toggle">
          <button [class.on]="vista() === 'porcentaje'" (click)="vista.set('porcentaje')">% acierto</button>
          @if (isAdmin()) {
            <button [class.on]="vista() === 'puntos'" (click)="vista.set('puntos')">
              <i class="ti ti-shield-check"></i> Históricos
            </button>
          }
        </div>
      </div>

      @if (tabla().length === 0) {
        <p class="empty">Todavía no hay datos para la tabla.</p>
      }

      <!-- Podio: los tres primeros con su medalla. -->
      @for (f of podio(); track f.id) {
        <div
          class="row row--podio"
          [class.row--lider]="f.posicion === 1"
          [class.row--me]="f.id === miUid()"
          [class.row--clic]="isAdmin()"
          (click)="verPerfil(f)"
        >
          <span class="medalla" [class]="'medalla--' + f.posicion">{{ f.posicion }}</span>
          <span class="avatar">{{ inicial(f.alias) }}</span>
          <span class="alias">{{ f.id === miUid() ? 'Tú' : f.alias }}</span>

          @if (vista() === 'puntos' && isAdmin()) {
            <span class="main" [class.neg]="f.puntos < 0">{{ f.puntos | number }}</span>
            <span class="side">{{ f.porcentaje }}%</span>
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

      <!-- Tu lugar, si no estás en el podio. -->
      @if (miLugar(); as f) {
        <div class="separador">
          <span>{{ estoyEnTabla() ? 'Tu lugar' : 'Fuera del top ' + limite }}</span>
        </div>
        <div class="row row--me">
          <span class="pos">{{ f.posicion }}</span>
          <span class="avatar">{{ inicial(f.alias) }}</span>
          <span class="alias">Tú</span>

          @if (vista() === 'puntos' && isAdmin()) {
            <span class="main" [class.neg]="f.puntos < 0">{{ f.puntos | number }}</span>
            <span class="side">{{ f.porcentaje }}%</span>
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

              @if (vista() === 'puntos' && isAdmin()) {
                <span class="main" [class.neg]="f.puntos < 0">{{ f.puntos | number }}</span>
                <span class="side">{{ f.porcentaje }}%</span>
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
      .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 22px; }
      .card { background: var(--surface-1); border-radius: var(--radius); padding: 12px 14px; }
      .card-label { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
      .card-val { font-size: 22px; font-weight: 600; }
      .card-val.accent { color: var(--accent-text); }
      .soft { font-size: 14px; color: var(--text-muted); font-weight: 400; }
      .neg { color: var(--danger-text); }
      .card--wide { grid-column: span 2; }
      .fire { color: var(--warning-text); font-size: 19px; vertical-align: -1px; }
      .cards-empty {
        background: var(--surface-1); border-radius: var(--radius);
        padding: 16px; font-size: 13px; color: var(--text-secondary); margin-bottom: 22px;
      }

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
      .row--podio { padding: 13px 8px; }

      /*
       * Disco con el número dentro. Un icono de medalla se veía casi
       * igual en los tres puestos; con fondo sólido y contraste alto,
       * el oro, la plata y el bronce se distinguen de un vistazo.
       */
      .medalla {
        width: 26px; height: 26px; flex-shrink: 0; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 13px; font-weight: 800; color: #1c1c1e;
        box-shadow: inset 0 -2px 3px rgba(0, 0, 0, 0.18);
      }
      .medalla--1 {
        background: linear-gradient(160deg, #ffdf7a 0%, #f0b429 55%, #c98a06 100%);
      }
      .medalla--2 {
        background: linear-gradient(160deg, #f2f6fa 0%, #c3ccd8 55%, #94a1b2 100%);
      }
      .medalla--3 {
        background: linear-gradient(160deg, #f0b184 0%, #cd7f45 55%, #9c5a29 100%);
        color: #fff;
      }

      /* El líder se lleva un realce discreto en toda su fila. */
      .row--lider {
        background: linear-gradient(
          90deg,
          rgba(240, 180, 41, 0.13) 0%,
          rgba(240, 180, 41, 0) 70%
        );
        border-radius: var(--radius);
      }

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

      .note { font-size: 11px; color: var(--text-muted); text-align: center; margin-top: 14px; }
    `,
  ],
})
export class RankingComponent {
  private readonly service = inject(RankingService);
  private readonly router = inject(Router);
  private readonly users = inject(UserService);
  private readonly auth = inject(Auth);

  readonly limite = TOP_LIMITE;
  readonly isAdmin = toSignal(this.users.isAdmin$, { initialValue: false });

  private readonly authUser = toSignal(user(this.auth), { initialValue: null });
  readonly miUid = computed(() => this.authUser()?.uid ?? '');

  readonly vista = signal<Vista>('porcentaje');
  readonly miPosicion = signal<number | null>(null);

  /** Mi fila: una sola lectura, independiente de la tabla. */
  readonly miFila = toSignal(this.service.miFila(), { initialValue: null });

  private readonly topPuntos = toSignal(this.service.topPuntos(), {
    initialValue: [] as RankingDoc[],
  });
  private readonly topPorcentaje = toSignal(this.service.topPorcentaje(), {
    initialValue: [] as RankingDoc[],
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

      // Si no aparezco (estoy fuera del top), pregunto al servidor.
      const p =
        v === 'puntos' && this.isAdmin()
          ? this.service.miPosicionPorPuntos(f.puntos)
          : f.calificado
            ? this.service.miPosicionPorPorcentaje(f.porcentaje)
            : Promise.resolve(0);

      p.then((n) => this.miPosicion.set(n || null)).catch(() => this.miPosicion.set(null));
    });
  }

  /** Tabla ordenada con desempates; los empates reales comparten lugar. */
  readonly tabla = computed<FilaRanking[]>(() => {
    const esPuntos = this.vista() === 'puntos' && this.isAdmin();
    const base = [...(esPuntos ? this.topPuntos() : this.topPorcentaje())];

    // Desempate: % → más juegos → mejor racha → alfabético.
    base.sort((a, b) => {
      if (esPuntos && b.puntos !== a.puntos) return b.puntos - a.puntos;
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

    const fuera = this.miFila();
    const posicion = this.miPosicion();
    if (!fuera || !posicion) return null;
    return { ...fuera, posicion } as FilaRanking;
  });

  readonly estoyEnTabla = computed(() =>
    this.tabla().some((f) => f.id === this.miUid()),
  );

  readonly resto = computed(() => this.tabla().slice(3));

  verPerfil(f: RankingDoc): void {
    if (!this.isAdmin()) return;
    this.router.navigate(['/perfil', f.id]);
  }

  inicial(alias: string): string {
    return (alias?.[0] ?? '?').toUpperCase();
  }
}