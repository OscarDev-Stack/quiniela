import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavComponent } from '../../shared/nav.component';
import { UserService } from '../../core/services/user.service';
import { AdminPartidosComponent } from '../admin/admin-partidos.component';

/**
 * Panel para gestores de liga (no admins globales). Les confirma que
 * tienen el rol, lista las ligas que gestionan, y les da acceso a la
 * captura de resultados — que es lo único que un gestor puede hacer.
 */
@Component({
    selector: 'app-liga-panel',
    standalone: true,
    imports: [CommonModule, NavComponent, AdminPartidosComponent],
    template: `
    <div class="screen">
      <app-nav [back]="true" title="Mi liga" />

      <div class="cabecera">
        <span class="rol"><i class="ti ti-whistle"></i> Administrador de liga</span>
        <p class="desc">
          Puedes capturar jornadas y publicar resultados de
          @if (ligas().length === 1) {
            la liga que gestionas.
          } @else {
            las ligas que gestionas.
          }
        </p>

        @if (ligas().length > 0) {
          <div class="ligas">
            @for (l of ligas(); track l.id) {
              <span class="liga-chip">{{ l.nombre || l.id }}</span>
            }
          </div>
        }
      </div>

      <app-admin-partidos [soloLiquidar]="true" />
    </div>
  `,
    styles: [
        `
      .cabecera { margin-bottom: 18px; }
      .rol {
        display: inline-flex; align-items: center; gap: 7px;
        padding: 6px 12px; border-radius: 999px;
        background: var(--accent-bg); color: var(--accent-text);
        font-size: 13px; font-weight: 700;
      }
      .desc { font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin: 10px 0 0; }
      .ligas { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
      .liga-chip {
        padding: 5px 11px; border-radius: 8px; font-size: 12px; font-weight: 600;
        background: var(--surface-1); color: var(--text-secondary); border: 1px solid var(--border);
      }
    `,
    ],
})
export class LigaPanelComponent {
    private readonly users = inject(UserService);
    readonly ligas = toSignal(this.users.misLigas$, { initialValue: [] });
}