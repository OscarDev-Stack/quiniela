import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { AdminService } from '../../core/services/admin.service';
import { AppUser } from '../../core/models/user.model';
import { ConfirmarService } from '../../shared/confirmar.service';
import { ToastService } from '../../shared/toast.service';

@Component({
  selector: 'app-admin-usuarios',
  standalone: true,
  imports: [CommonModule],
  template: `

    <section class="panel">
      <header class="cabecera">
        <div class="titulo">
          <h2>Usuarios</h2>
          <span class="conteo">
            {{ visibles().length }} en total
            @if (pendientes() > 0) {
              · <span class="pend">{{ pendientes() }} por validar</span>
            }
          </span>
        </div>

        <div class="acciones-top">
          @if (pendientes() > 0) {
            <button class="chip chip--danger" (click)="eliminarPendientes()">
              <i class="ti ti-trash"></i> Eliminar sin validar
            </button>
          }
          <button class="chip" (click)="recalcular()">
            <i class="ti ti-refresh"></i> Recalcular ranking
          </button>
          <button class="chip" [disabled]="trabajando()" (click)="sincronizar()">
            <i class="ti ti-history-toggle"></i>
            {{ trabajando() ? 'Corrigiendo…' : 'Igualar históricos' }}
          </button>
        </div>
      </header>

      @if (visibles().length === 0) {
        <p class="vacio">Aún no hay usuarios registrados.</p>
      }

      <ul class="lista">
        @for (u of ordenados(); track u.id) {
          <li class="item" [class.item--pend]="!u.validada">
            <span class="avatar" [class.avatar--pend]="!u.validada">{{ inicial(u) }}</span>

            <div class="datos">
              <div class="nombre">
                {{ nombre(u) }}
                @if (u.validada) {
                  <i class="ti ti-rosette-discount-check-filled check" title="Validada"></i>
                }
                @if (u.bloqueado) {
                  <span class="mini mini--danger">Bloqueado</span>
                }
              </div>
              <div class="correo">{{ u.email }}</div>
            </div>

            <span class="puntos">
              <span class="saldo" [class.neg]="(u.puntos ?? 0) < 0">
                {{ u.puntos ?? 0 | number }}
              </span>
              <span class="hist">hist. {{ u.puntosHistoricos ?? u.puntos ?? 0 | number }}</span>
            </span>

            <div class="acciones">
              @if (!u.validada) {
                <button class="btn btn--ok" (click)="validar(u)">
                  <i class="ti ti-check"></i> Validar
                </button>
                <button class="btn btn--icon" (click)="eliminar(u)" aria-label="Eliminar">
                  <i class="ti ti-trash"></i>
                </button>
              } @else {
                <button class="btn btn--icono-solo" (click)="reiniciar(u)" title="Reiniciar puntos" aria-label="Reiniciar puntos">
                  <i class="ti ti-refresh"></i>
                </button>
                <button
                  class="btn btn--icono-solo"
                  [class.btn--grupo-on]="u.esAdminGrupo"
                  (click)="toggleAdminGrupo(u)"
                  [title]="u.esAdminGrupo ? 'Quitar admin de grupo' : 'Hacer admin de grupo'"
                  [attr.aria-label]="u.esAdminGrupo ? 'Quitar admin de grupo' : 'Hacer admin de grupo'"
                >
                  <i class="ti ti-shield-star"></i>
                </button>
              }
            </div>
          </li>
        }
      </ul>

      <div class="leyenda">
        <span><i class="ti ti-refresh"></i> Reiniciar puntos</span>
        <span><i class="ti ti-shield-star"></i> Admin de grupo</span>
      </div>
    </section>
  `,
  styles: [
    `
      .msg {
        display: flex; align-items: center; gap: 8px; cursor: pointer;
        margin-bottom: 16px; font-size: 13px; padding: 11px 13px;
        border-radius: var(--radius);
        background: var(--success-bg); color: var(--success-text);
      }
      .msg .cerrar { margin-left: auto; opacity: 0.7; }

      .panel {
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: var(--radius-lg); padding: 16px;
      }

      .cabecera { margin-bottom: 14px; }
      .titulo h2 { font-size: 16px; font-weight: 600; margin: 0; }
      .conteo { font-size: 12px; color: var(--text-muted); }
      .pend { color: var(--warning-text); font-weight: 600; }

      .acciones-top { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      .chip {
        display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
        font-size: 13px; padding: 8px 14px; border-radius: 999px;
        border: 1px solid var(--border); background: transparent; color: var(--text-secondary);
      }
      .chip:hover { background: var(--surface-1); }
      .chip--danger { color: var(--danger-text); border-color: var(--danger-text); }

      .vacio { color: var(--text-muted); font-size: 14px; }

      .lista { list-style: none; margin: 0; padding: 0; }
      .item {
        display: grid;
        grid-template-columns: 38px 1fr auto;
        grid-template-areas: 'avatar datos puntos' '. acciones acciones';
        align-items: center; gap: 6px 12px;
        padding: 14px 0; border-bottom: 1px solid var(--border);
      }
      .item:last-child { border-bottom: none; }

      .avatar {
        grid-area: avatar;
        width: 38px; height: 38px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        background: var(--surface-1); color: var(--text-secondary);
        font-size: 14px; font-weight: 700;
      }
      .avatar--pend { background: var(--warning-bg); color: var(--warning-text); }

      .datos { grid-area: datos; min-width: 0; }
      .nombre {
        display: flex; align-items: center; gap: 6px;
        font-size: 15px; font-weight: 600;
      }
      .check { color: var(--accent-fill); font-size: 16px; }
      .mini {
        font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 999px;
        text-transform: uppercase; letter-spacing: 0.3px;
      }
      .mini--danger { background: var(--danger-bg); color: var(--danger-text); }
      .correo {
        font-size: 12px; color: var(--text-muted);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }

      .puntos { grid-area: puntos; text-align: right; white-space: nowrap; }
      .saldo { display: block; font-size: 15px; font-weight: 600; }
      .saldo.neg { color: var(--danger-text); }
      .hist { display: block; font-size: 11px; color: var(--text-muted); }

      .acciones { grid-area: acciones; display: flex; gap: 8px; justify-content: flex-end; }
      .btn {
        display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
        font-size: 13px; padding: 7px 14px; border-radius: var(--radius);
        border: 1px solid var(--border-strong); background: transparent;
      }
      .btn:hover { background: var(--surface-1); }
      .btn--ok {
        background: var(--accent-fill); color: #fff; border-color: transparent; font-weight: 600;
      }
      .btn--icon { color: var(--danger-text); border-color: var(--danger-text); padding: 7px 11px; }
      .btn--grupo-on { background: var(--tipo-elim-fill); color: #fff; border-color: var(--tipo-elim-fill); }
      .btn--icono-solo {
        display: inline-flex; align-items: center; justify-content: center;
        width: 38px; height: 38px; padding: 0; flex-shrink: 0;
      }
      .btn--icono-solo i { font-size: 18px; }
      .leyenda {
        display: flex; flex-wrap: wrap; gap: 16px; margin-top: 16px;
        padding-top: 14px; border-top: 1px solid var(--border);
        font-size: 12px; color: var(--text-muted);
      }
      .leyenda span { display: inline-flex; align-items: center; gap: 5px; }
      .leyenda i { font-size: 15px; }

      @media (min-width: 620px) {
        .cabecera { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .acciones-top { margin-top: 0; }
        .item {
          grid-template-columns: 38px 1fr auto auto;
          grid-template-areas: 'avatar datos puntos acciones';
        }
      }
    `,
  ],
})
export class AdminUsuariosComponent {
  private readonly admin = inject(AdminService);
  private readonly confirmar = inject(ConfirmarService);
  private readonly toast = inject(ToastService);

  readonly users = toSignal(this.admin.getUsers(), { initialValue: [] as AppUser[] });
  readonly trabajando = signal(false);



  /** Ids ya eliminados, para que la lista responda de inmediato. */
  private readonly eliminados = signal<string[]>([]);

  /** Usuarios visibles: los de Firestore menos los recién eliminados. */
  readonly visibles = computed(() =>
    this.users().filter((u) => !this.eliminados().includes(u.id)),
  );

  readonly pendientes = computed(() => this.visibles().filter((u) => !u.validada).length);

  /** Primero los pendientes, luego por alias. */
  readonly ordenados = computed(() =>
    [...this.visibles()].sort((a, b) => {
      if (!!a.validada !== !!b.validada) return a.validada ? 1 : -1;
      return this.nombre(a).localeCompare(this.nombre(b), 'es');
    }),
  );

  nombre(u: AppUser): string {
    return u.alias?.trim() || (u.email ?? '').split('@')[0] || 'jugador';
  }

  inicial(u: AppUser): string {
    return this.nombre(u).charAt(0).toUpperCase();
  }

  async validar(u: AppUser): Promise<void> {
    await this.admin.validarUsuario(u.id);
    this.toast.exito(`${this.nombre(u)} ya puede participar.`);
  }

  /** Activa o quita el rol de administrador de grupo (crear/gestionar grupos). */
  async toggleAdminGrupo(u: AppUser): Promise<void> {
    const nuevo = !u.esAdminGrupo;
    await this.admin.setAdminGrupo(u.id, nuevo);
    this.toast.exito(
      nuevo
        ? `${this.nombre(u)} ahora puede crear y administrar grupos.`
        : `${this.nombre(u)} ya no es administrador de grupo.`,
    );
  }

  async reiniciar(u: AppUser): Promise<void> {
    const ok = await this.confirmar.pedir({
      titulo: 'Reiniciar saldo',
      mensaje: `${this.nombre(u)} volverá a 0 puntos. Su historial y estadísticas no cambian.`,
      aceptar: 'Reiniciar',
      peligro: true,
    });
    if (!ok) return;
    await this.admin.reiniciarPuntos(u.id);
    this.toast.exito(`Saldo de ${this.nombre(u)} reiniciado a 0.`);
  }

  async eliminar(u: AppUser): Promise<void> {
    const ok = await this.confirmar.pedir({
      titulo: 'Eliminar cuenta',
      mensaje: `Se borrará la cuenta de ${this.nombre(u)} por completo. No se puede deshacer.`,
      aceptar: 'Eliminar',
      peligro: true,
    });
    if (!ok) return;
    try {
      const r = await this.admin.eliminarUsuarios([u.id]);
      if (r.borrados > 0) {
        this.eliminados.set([...this.eliminados(), u.id]);
        this.toast.exito('Cuenta eliminada.');
      } else {
        this.toast.error(
          r.omitidos?.length
            ? `No se eliminó: ${r.omitidos.join(', ')}.`
            : 'No se pudo eliminar.',
        );
      }
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo eliminar.');
    }
  }

  async eliminarPendientes(): Promise<void> {
    const sinValidar = this.visibles().filter((u) => !u.validada);
    if (sinValidar.length === 0) return;
    const ok = await this.confirmar.pedir({
      titulo: 'Eliminar cuentas sin validar',
      mensaje: `Se borrarán ${sinValidar.length} cuenta(s). No se puede deshacer.`,
      aceptar: 'Eliminar todas',
      peligro: true,
    });
    if (!ok) return;
    try {
      const r = await this.admin.eliminarUsuarios(sinValidar.map((u) => u.id));
      if (r.borrados > 0) {
        this.eliminados.set([...this.eliminados(), ...sinValidar.map((u) => u.id)]);
      }
      this.toast.exito(
        `${r.borrados} cuenta(s) eliminada(s).` +
        (r.omitidos?.length ? ` Omitidas: ${r.omitidos.join(', ')}.` : ''),
      );
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudieron eliminar.');
    }
  }

  /** Corrige las cuentas anteriores a que existiera el histórico. */
  async sincronizar(): Promise<void> {
    const ok = await this.confirmar.pedir({
      titulo: 'Igualar históricos',
      mensaje:
        'Los puntos históricos de cada cuenta pasarán a ser iguales a su saldo actual. ' +
        'Solo debe usarse si nunca has reiniciado el saldo de nadie.',
      aceptar: 'Igualar',
      peligro: true,
    });
    if (!ok) return;

    this.trabajando.set(true);
    try {
      const r = await this.admin.sincronizarHistoricos();
      this.toast.exito(`${r.corregidos} cuenta(s) corregida(s).`);
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo sincronizar.');
    } finally {
      this.trabajando.set(false);
    }
  }

  async recalcular(): Promise<void> {
    try {
      const r = await this.admin.recalcularRanking();
      this.toast.exito(`Ranking actualizado: ${r.jugadores} jugador(es).`);
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo recalcular.');
    }
  }
}