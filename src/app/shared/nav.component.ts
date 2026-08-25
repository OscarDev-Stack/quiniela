import { Component, computed, inject, input, signal } from '@angular/core';
import { CampanitaComponent } from './campanita.component';
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
  imports: [CommonModule, RouterLink, RouterLinkActive, CampanitaComponent],
  template: `
    <!-- Encabezado -->
    <header class="topbar">
      @if (back()) {
        <button class="icon-btn" (click)="volver()" aria-label="Volver">
          <i class="ti ti-arrow-left"></i>
        </button>
        <span class="title">{{ title() }}</span>
      } @else if (minimal()) {
        <span class="marca">{{ title() || 'Quiniela' }}</span>
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

      @if (!ocultarSaldo()) {
        <div class="balance" [class.balance--negativo]="(me()?.puntos ?? 0) < 0">
          <i class="ti ti-coins"></i>
          <span>{{ me()?.puntos ?? 0 | number }} pts</span>
        </div>
      }

      @if (!back()) {
        <a class="icono-top" routerLink="/ranking" aria-label="Ranking" title="Ranking">
          <i class="ti ti-trophy"></i>
        </a>

        <app-campanita />

        @if (isAdmin()) {
          <div class="menu-admin">
            <button class="icono-top" (click)="menuAbierto.set(!menuAbierto())" aria-label="Menú de administración">
              <i class="ti ti-dots-vertical"></i>
              @if (pendientes() > 0) { <span class="punto-rojo"></span> }
            </button>
            @if (menuAbierto()) {
              <div class="menu-fondo" (click)="menuAbierto.set(false)"></div>
              <div class="menu-lista">
                <span class="menu-tit">Administración</span>
                <a routerLink="/admin/partidos" (click)="menuAbierto.set(false)"><i class="ti ti-ball-football"></i> Partidos</a>
                <a routerLink="/admin/usuarios" (click)="menuAbierto.set(false)">
                  <i class="ti ti-users"></i> Usuarios
                  @if (pendientes() > 0) { <span class="menu-badge">{{ pendientes() }}</span> }
                </a>
                <a routerLink="/admin/torneos" (click)="menuAbierto.set(false)"><i class="ti ti-tournament"></i> Torneos</a>
                <a routerLink="/admin/competiciones" (click)="menuAbierto.set(false)"><i class="ti ti-trophy"></i> Ligas</a>
                <a routerLink="/admin/brackets" (click)="menuAbierto.set(false)"><i class="ti ti-sitemap"></i> Eliminatorias</a>
              </div>
            }
          </div>
        } @else if (esGestor()) {
          <a class="icono-top" routerLink="/liga" aria-label="Mi liga" title="Mi liga">
            <i class="ti ti-ball-football"></i>
          </a>
        }
      }
    </header>

    @if (me() && !me()!.validada) {
      <div class="banner">
        <i class="ti ti-clock"></i>
        Tu cuenta está en revisión. Un administrador debe validarla para que puedas pronosticar.
      </div>
    }

    <!-- Barra inferior -->
    <nav class="tabs">
      <a routerLink="/inicio" routerLinkActive="on">
        <i class="ti ti-home"></i><span>Inicio</span>
      </a>
      <a routerLink="/partidos" routerLinkActive="on">
        <i class="ti ti-ball-football"></i><span>Partidos</span>
      </a>
      <a routerLink="/mis-pronosticos" routerLinkActive="on">
        <i class="ti ti-ticket"></i><span>Míos</span>
      </a>
      <a routerLink="/torneos" routerLinkActive="on">
        <i class="ti ti-tournament"></i><span>Torneos</span>
      </a>
    </nav>
  `,
  styles: [
    `
      .topbar {
        position: sticky; top: 0; z-index: 20;
        display: flex; align-items: center; gap: 6px;
        /* Ancho consistente en todas las vistas, aunque el contenedor
           (p.ej. admin a 780px) sea más ancho: la barra se mantiene igual. */
        width: 100%; max-width: 460px; margin: 0 auto 16px;
        /* Deja libre la barra de estado cuando corre como app instalada. */
        padding: calc(12px + env(safe-area-inset-top)) 0 12px;
        background: var(--surface-0);
        border-bottom: 1px solid var(--border);
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
      .marca { flex: 1; font-size: 17px; font-weight: 800; color: var(--text-primary); }

      .icon-btn {
        width: 36px; height: 36px; border-radius: 50%; cursor: pointer;
        border: 1px solid var(--border); background: var(--surface-2);
        display: flex; align-items: center; justify-content: center; font-size: 18px;
        flex-shrink: 0;
      }

      .balance {
        display: flex; align-items: center; gap: 6px;
        background: var(--accent-bg); color: var(--accent-text);
        padding: 7px 13px; border-radius: 999px; font-weight: 600; font-size: 14px;
        white-space: nowrap;
      }
      /* En rojo cuando debes puntos, para que se note. */
      .balance--negativo { background: var(--danger-bg); color: var(--danger-text); }

      /* Botones de ícono en la barra superior (ranking, tres puntos). */
      .icono-top {
        position: relative; flex-shrink: 0;
        width: 38px; height: 38px; border-radius: 50%; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        border: none; background: transparent; color: var(--text-secondary);
        font-size: 20px; text-decoration: none;
      }
      .icono-top:hover { background: var(--surface-1); color: var(--text-primary); }
      .punto-rojo {
        position: absolute; top: 7px; right: 7px;
        width: 8px; height: 8px; border-radius: 50%; background: var(--danger-text);
      }

      /* Menú desplegable de administración. */
      .menu-admin { position: relative; flex-shrink: 0; }
      .menu-fondo { position: fixed; inset: 0; z-index: 190; }
      .menu-lista {
        position: absolute; top: calc(100% + 6px); right: 0; z-index: 200;
        min-width: 190px; display: flex; flex-direction: column;
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 12px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
        padding: 6px; animation: menuAparece 0.15s ease;
      }
      @keyframes menuAparece { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
      .menu-tit {
        font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
        color: var(--text-muted); padding: 6px 10px 4px;
      }
      .menu-lista a {
        display: flex; align-items: center; gap: 10px;
        padding: 10px; border-radius: 8px; text-decoration: none;
        color: var(--text-primary); font-size: 14px;
      }
      .menu-lista a:hover { background: var(--surface-1); }
      .menu-lista a i { font-size: 18px; color: var(--text-secondary); }
      .menu-badge {
        margin-left: auto; font-size: 11px; font-weight: 700; min-width: 18px; height: 18px;
        display: flex; align-items: center; justify-content: center; padding: 0 5px;
        border-radius: 999px; background: var(--danger-text); color: #fff;
      }

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
        flex: 1; max-width: 72px; min-width: 0;
        display: flex; flex-direction: column; align-items: center; gap: 3px;
        text-decoration: none; cursor: pointer;
        border: none; background: none;
        color: var(--text-muted); font-size: 10px; padding: 4px 1px;
        border-radius: var(--radius);
      }
      .tabs a span, .tabs button span {
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .tabs i { font-size: 20px; }
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
  /** Si es true, muestra la barra superior sin nombre/avatar (solo marca + puntos + campanita). */
  readonly minimal = input(false);
  /** Si es true, oculta el saldo de la barra (útil cuando ya se muestra en la propia vista). */
  readonly ocultarSaldo = input(false);

  /** Menú desplegable de administración (tres puntos). */
  readonly menuAbierto = signal(false);

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