import { Component, computed, inject, input } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from '../core/services/auth.service';
import { UserService } from '../core/services/user.service';
import { AdminService } from '../core/services/admin.service';
import { TorneosService } from '../core/services/torneos.service';

@Component({
  selector: 'app-nav',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <!-- Encabezado -->
    <header class="topbar">
      @if (back()) {
        <button class="icon-btn" (click)="volver()" aria-label="Volver">
          <i class="ti ti-arrow-left"></i>
        </button>
        <span class="title">{{ title() }}</span>
      } @else {
        <div class="brand">
          <span class="avatar" routerLink="/perfil">{{ inicial() }}</span>
          <span class="who" routerLink="/perfil">
            <span class="alias">
              {{ alias() }}
              @if (me()?.validada) {
                <i class="ti ti-rosette-discount-check-filled check" title="Cuenta validada"></i>
              }
            </span>
            <span class="sub">{{ title() || 'Quiniela' }}</span>
          </span>
        </div>
      }

      <div class="balance" [class.balance--negativo]="(me()?.puntos ?? 0) < 0">
        <i class="ti ti-coins"></i>
        <span>{{ me()?.puntos ?? 0 | number }} pts</span>
      </div>
    </header>

    @if (me() && !me()!.validada) {
      <div class="banner">
        <i class="ti ti-clock"></i>
        Tu cuenta está en revisión. Un administrador debe validarla para que puedas pronosticar.
      </div>
    }

    <!-- Barra inferior -->
    <nav class="tabs">
      <a routerLink="/partidos" routerLinkActive="on">
        <i class="ti ti-ball-football"></i><span>Partidos</span>
      </a>
      <a routerLink="/mis-pronosticos" routerLinkActive="on">
        <i class="ti ti-ticket"></i><span>Míos</span>
      </a>
      <a routerLink="/ranking" routerLinkActive="on">
        <i class="ti ti-trophy"></i><span>Ranking</span>
      </a>
      @if (tengoTorneos()) {
        <a routerLink="/torneos" routerLinkActive="on" class="con-badge">
          <i class="ti ti-tournament"></i><span>Torneos</span>
          @if (pendientesTorneos() > 0) {
            <span class="badge">{{ pendientesTorneos() }}</span>
          }
        </a>
      }
      @if (isAdmin()) {
        <a routerLink="/admin" routerLinkActive="on" class="con-badge">
          <i class="ti ti-shield-check"></i><span>Admin</span>
          @if (pendientes() > 0) {
            <span class="badge">{{ pendientes() }}</span>
          }
        </a>
      } @else if (esGestor()) {
        <a routerLink="/liga" routerLinkActive="on">
          <i class="ti ti-whistle"></i><span>Mi liga</span>
        </a>
      }
    </nav>
  `,
  styles: [
    `
      .topbar {
        position: sticky; top: 0; z-index: 20;
        display: flex; align-items: center; gap: 12px;
        /* Deja libre la barra de estado cuando corre como app instalada. */
        padding: calc(12px + env(safe-area-inset-top)) 0 12px;
        background: var(--surface-0);
        border-bottom: 1px solid var(--border);
        margin-bottom: 16px;
      }
      .brand { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
      .avatar { cursor: pointer;
        width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
        background: var(--accent-bg); color: var(--accent-text);
        display: flex; align-items: center; justify-content: center;
        font-size: 15px; font-weight: 700;
      }
      .who { cursor: pointer; display: flex; flex-direction: column; min-width: 0; }
      .alias {
        display: flex; align-items: center; gap: 4px;
        font-size: 15px; font-weight: 600; line-height: 1.2;
        overflow: hidden; white-space: nowrap;
      }
      .check { color: var(--accent-fill); font-size: 15px; flex-shrink: 0; }
      .sub { font-size: 11px; color: var(--text-muted); line-height: 1.3; }
      .title { flex: 1; font-size: 16px; font-weight: 600; }

      .icon-btn {
        width: 34px; height: 34px; border-radius: 50%; cursor: pointer;
        border: 1px solid var(--border); background: var(--surface-2);
        display: flex; align-items: center; justify-content: center; font-size: 18px;
      }

      .balance {
        display: flex; align-items: center; gap: 6px;
        background: var(--accent-bg); color: var(--accent-text);
        padding: 7px 13px; border-radius: 999px; font-weight: 600; font-size: 14px;
        white-space: nowrap;
      }
      /* En rojo cuando debes puntos, para que se note. */
      .balance--negativo { background: var(--danger-bg); color: var(--danger-text); }

      .banner {
        display: flex; align-items: center; gap: 8px;
        background: var(--warning-bg); color: var(--warning-text);
        font-size: 13px; padding: 11px 13px; border-radius: var(--radius); margin-bottom: 14px;
      }

      .tabs {
        position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
        display: flex; justify-content: center; gap: 4px;
        padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
        background: var(--surface-2);
        border-top: 1px solid var(--border);
      }
      .tabs a, .tabs button {
        flex: 1; max-width: 88px;
        display: flex; flex-direction: column; align-items: center; gap: 3px;
        text-decoration: none; cursor: pointer;
        border: none; background: none;
        color: var(--text-muted); font-size: 11px; padding: 4px 2px;
        border-radius: var(--radius);
      }
      .tabs i { font-size: 21px; }
      .tabs a.on { color: var(--accent-text); }
      .con-badge { position: relative; }
      .badge {
        position: absolute; top: 0; right: 12px;
        min-width: 17px; height: 17px; padding: 0 4px;
        border-radius: 999px; background: var(--danger-text); color: #fff;
        font-size: 10px; font-weight: 700; line-height: 17px; text-align: center;
      }
      .tabs a:hover, .tabs button:hover { color: var(--text-primary); }
    `,
  ],
})
export class NavComponent {
  private readonly auth = inject(AuthService);
  private readonly users = inject(UserService);
  private readonly admin = inject(AdminService);
  private readonly torneos = inject(TorneosService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** Muestra flecha de regreso en vez del logo. */
  readonly back = input(false);
  /** Título del encabezado. */
  readonly title = input('');

  readonly me = toSignal(this.users.me$, { initialValue: null });
  readonly isAdmin = toSignal(this.users.isAdmin$, { initialValue: false });
  readonly esGestor = toSignal(this.users.esGestor$, { initialValue: false });
  /** Resultados de la API por confirmar y alertas de partidos. */
  readonly pendientes = toSignal(this.admin.pendientes$, { initialValue: 0 });
  /** Torneos donde falta elegir equipo. */
  readonly pendientesTorneos = toSignal(this.torneos.pendientes$, { initialValue: 0 });
  /** La pestaña de torneos solo aparece si participo en alguno. */
  private readonly misTorneos = toSignal(this.torneos.misTorneos$, { initialValue: [] });
  readonly tengoTorneos = computed(() => this.misTorneos().length > 0);

  /** Alias del usuario, con el correo como respaldo. */
  alias(): string {
    const u = this.me();
    if (!u) return 'Invitado';
    return u.alias?.trim() || (u.email ?? '').split('@')[0] || 'jugador';
  }

  inicial(): string {
    return this.alias().charAt(0).toUpperCase();
  }

  volver(): void {
    // Regresa a la pantalla anterior. Si se entró directo por URL y no
    // hay historial dentro de la app, cae a partidos como respaldo.
    const haremos = document.referrer || history.length > 1;
    if (haremos) {
      this.location.back();
    } else {
      this.router.navigate(['/partidos']);
    }
  }


}