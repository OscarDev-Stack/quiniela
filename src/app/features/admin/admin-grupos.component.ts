import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { GruposService } from '../../core/services/grupos.service';
import { ContextoService } from '../../shared/contexto.service';
import { Grupo } from '../../core/models/grupo.model';

/**
 * Lista todos los grupos del sistema para el super admin.
 * Desde aquí puede cambiar el contexto activo a cualquier grupo y luego
 * crear partidos, torneos o eliminatorias para él desde las secciones
 * correspondientes del panel de admin.
 */
@Component({
    selector: 'app-admin-grupos',
    standalone: true,
    imports: [CommonModule],
    template: `
        <section class="panel">
            <div class="panel-head">
                <h2>Grupos</h2>
                <span class="conteo">{{ grupos().length }} en total</span>
            </div>
            <p class="ayuda">
                Selecciona un grupo para cambiar el contexto activo. Después podrás
                crear partidos, torneos o eliminatorias para ese grupo desde las
                secciones correspondientes.
            </p>
        </section>

        @if (grupos().length === 0) {
            <p class="vacio">
                <i class="ti ti-users-group"></i>
                Todavía no hay grupos creados.
            </p>
        }

        @for (g of grupos(); track g.id) {
            <div class="grupo" [class.grupo--activo]="esActivo(g.id)">
                <div class="grupo-ico">{{ g.icono }}</div>
                <div class="grupo-txt">
                    <div class="grupo-nom">{{ g.nombre }}</div>
                    <div class="grupo-sub">
                        {{ g.miembrosCount ?? 1 }} miembro(s) · {{ g.codigo }}
                    </div>
                </div>
                <div class="grupo-acciones">
                    @if (esActivo(g.id)) {
                        <span class="badge badge--activo">Activo</span>
                        <button class="btn" (click)="irAGlobal()">
                            Global
                        </button>
                    } @else {
                        <button class="btn btn--primary" (click)="seleccionar(g)">
                            Seleccionar
                        </button>
                    }
                </div>
            </div>
        }
    `,
    styles: [
        `
        .panel {
            background: var(--surface-2); border: 1px solid var(--border);
            border-radius: var(--radius-lg); padding: 15px; margin-bottom: 14px;
        }
        .panel-head {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 6px;
        }
        h2 { font-size: 15px; font-weight: 600; margin: 0; }
        .conteo { font-size: 12px; color: var(--text-muted); }
        .ayuda { font-size: 13px; color: var(--text-secondary); margin: 0; }

        .vacio {
            display: flex; flex-direction: column; align-items: center; gap: 10px;
            text-align: center; color: var(--text-muted); padding: 44px 24px;
            font-size: 13px;
        }
        .vacio i { font-size: 40px; opacity: 0.4; }

        .grupo {
            display: flex; align-items: center; gap: 12px;
            background: var(--surface-2); border: 1px solid var(--border);
            border-radius: var(--radius-lg); padding: 13px 14px; margin-bottom: 10px;
        }
        .grupo--activo {
            border-color: var(--accent-fill);
            background: var(--accent-bg);
        }
        .grupo-ico {
            width: 42px; height: 42px; border-radius: 10px; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center;
            font-size: 22px; background: var(--surface-1);
        }
        .grupo--activo .grupo-ico { background: var(--surface-2); }
        .grupo-txt { flex: 1; min-width: 0; }
        .grupo-nom {
            font-size: 14px; font-weight: 700;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .grupo-sub { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
        .grupo-acciones {
            display: flex; align-items: center; gap: 8px; flex-shrink: 0;
        }

        .badge { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; }
        .badge--activo {
            background: var(--accent-fill); color: #fff;
        }

        .btn {
            padding: 7px 13px; cursor: pointer; font-size: 13px; font-weight: 600;
            border: 1px solid var(--border); border-radius: var(--radius);
            background: var(--surface-1); color: var(--text-primary);
        }
        .btn--primary {
            background: var(--accent-fill); color: #fff; border-color: transparent;
        }
        .btn:hover { opacity: 0.85; }
        `,
    ],
})
export class AdminGruposComponent {
    private readonly gruposSrv = inject(GruposService);
    private readonly contexto = inject(ContextoService);

    readonly grupos = toSignal(this.gruposSrv.todosLosGrupos(), {
        initialValue: [] as Grupo[],
    });

    esActivo(grupoId: string): boolean {
        return this.contexto.grupoId() === grupoId;
    }

    /** Cambia el contexto activo al grupo elegido. */
    seleccionar(g: Grupo): void {
        this.contexto.cambiar({ grupoId: g.id, nombre: g.nombre, icono: g.icono });
    }

    /** Vuelve al contexto global. */
    irAGlobal(): void {
        this.contexto.aGlobal();
    }
}
