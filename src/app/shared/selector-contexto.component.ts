import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { ContextoService } from './contexto.service';
import { GruposService } from '../core/services/grupos.service';
import { UserService } from '../core/services/user.service';
import { Grupo } from '../core/models/grupo.model';

/**
 * Selector de contexto para la barra del inicio. Es un icono que muestra el
 * contexto activo (🌎 Global o el emoji del grupo). Al tocarlo, despliega un
 * menú con Global + grupos favoritos (hasta 3) + "Ver todos mis grupos".
 */
@Component({
  selector: 'app-selector-contexto',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="selector">
      <button class="icono-top" [class.activo]="abierto()" (click)="abrir()" aria-label="Cambiar contexto">
        <span class="emoji">{{ ctx.actual().icono }}</span>
      </button>

      @if (abierto()) {
        <div class="fondo" (click)="cerrar()"></div>
        <div class="menu">
          <span class="menu-tit">Ver como</span>

          <!-- Global -->
          <button class="op" (click)="elegirGlobal()">
            <span class="op-ico">🌎</span>
            <span class="op-nom">Global</span>
            @if (ctx.esGlobal()) { <i class="ti ti-check activo-check"></i> }
          </button>

          <!-- Grupos favoritos (hasta 3) -->
          @for (g of favoritosVisibles(); track g.id) {
            <button class="op" (click)="elegirGrupo(g)">
              <span class="op-ico">{{ g.icono }}</span>
              <span class="op-nom">{{ g.nombre }}</span>
              @if (ctx.grupoId() === g.id) { <i class="ti ti-check activo-check"></i> }
            </button>
          }

          <div class="sep"></div>
          <button class="op op--ver" (click)="verTodos()">
            <span class="op-ico"><i class="ti ti-users-group"></i></span>
            <span class="op-nom">Ver todos mis grupos</span>
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .selector { position: relative; display: inline-flex; }
      .icono-top {
        display: inline-flex; align-items: center; justify-content: center;
        width: 38px; height: 38px; border-radius: 10px; cursor: pointer;
        border: none; background: transparent;
      }
      .icono-top:hover { background: var(--surface-1); }
      .icono-top.activo { background: var(--accent-bg); }
      .emoji { font-size: 19px; line-height: 1; }

      .fondo { position: fixed; inset: 0; z-index: 30; }
      .menu {
        position: absolute; top: calc(100% + 6px); left: 0; z-index: 31;
        min-width: 230px; background: var(--surface-2);
        border: 1px solid var(--border); border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); overflow: hidden; padding: 6px;
      }
      .menu-tit {
        display: block; font-size: 11px; color: var(--text-muted);
        text-transform: uppercase; letter-spacing: 0.5px; padding: 4px 10px 6px;
      }
      .op {
        width: 100%; display: flex; align-items: center; gap: 10px;
        padding: 10px 10px; border-radius: 8px; cursor: pointer;
        background: transparent; border: none; color: var(--text-primary); text-align: left;
      }
      .op:hover { background: var(--surface-1); }
      .op-ico { font-size: 16px; width: 20px; text-align: center; }
      .op-nom {
        flex: 1; font-size: 13px; font-weight: 600;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .activo-check { color: var(--accent-text); font-size: 14px; }
      .op--ver .op-nom { color: var(--accent-text); }
      .sep { height: 1px; background: var(--border); margin: 4px 0; }
    `,
  ],
})
export class SelectorContextoComponent {
  readonly ctx = inject(ContextoService);
  private readonly gruposSrv = inject(GruposService);
  private readonly users = inject(UserService);
  private readonly router = inject(Router);

  readonly abierto = signal(false);

  private readonly me = toSignal(this.users.me$, { initialValue: null });
  private readonly grupos = toSignal(this.gruposSrv.misGrupos(), { initialValue: [] as Grupo[] });

  /** Grupos favoritos del usuario; si no tiene, muestra los primeros que haya. */
  readonly favoritosVisibles = computed(() => {
    const favs = new Set(this.me()?.gruposFavoritos ?? []);
    const todos = this.grupos();
    const marcados = todos.filter((g) => favs.has(g.id));
    const lista = marcados.length > 0 ? marcados : todos;
    return lista.slice(0, 3);
  });

  abrir(): void {
    this.abierto.set(!this.abierto());
  }
  cerrar(): void {
    this.abierto.set(false);
  }

  elegirGlobal(): void {
    this.ctx.aGlobal();
    this.cerrar();
  }
  elegirGrupo(g: Grupo): void {
    this.ctx.cambiar({ grupoId: g.id, nombre: g.nombre, icono: g.icono });
    this.cerrar();
  }
  verTodos(): void {
    this.cerrar();
    this.router.navigate(['/grupos']);
  }
}