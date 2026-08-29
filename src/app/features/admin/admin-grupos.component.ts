import { Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { GruposService } from '../../core/services/grupos.service';
import { Grupo, MiembroGrupo } from '../../core/models/grupo.model';

/**
 * Lista todos los grupos del sistema para el super admin y, al abrir cada
 * uno, muestra quiénes son sus miembros. Es una vista de consulta: no cambia
 * el contexto activo ni crea nada.
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
                Abre un grupo para ver quiénes lo integran.
            </p>
        </section>

        @if (grupos().length === 0) {
            <p class="vacio">
                <i class="ti ti-users-group"></i>
                Todavía no hay grupos creados.
            </p>
        }

        @for (g of grupos(); track g.id) {
            <div class="grupo">
                <button class="grupo-cab" (click)="alternar(g.id)">
                    <div class="grupo-ico">{{ g.icono }}</div>
                    <div class="grupo-txt">
                        <div class="grupo-nom">{{ g.nombre }}</div>
                        <div class="grupo-sub">
                            {{ g.miembrosCount ?? 1 }} miembro(s) · {{ g.codigo }}
                        </div>
                    </div>
                    <i class="ti chevron"
                        [class.ti-chevron-down]="!abierto(g.id)"
                        [class.ti-chevron-up]="abierto(g.id)"></i>
                </button>

                @if (abierto(g.id)) {
                    <div class="miembros">
                        @for (m of miembrosDe(g.id); track m.uid) {
                            <div class="miembro">
                                <span class="ava">{{ inicial(m.alias) }}</span>
                                <span class="mi-alias">{{ m.alias }}</span>
                                @if (m.rol === 'admin') {
                                    <span class="mi-badge">ADMIN</span>
                                }
                            </div>
                        } @empty {
                            <p class="sin-miembros">Cargando miembros…</p>
                        }
                    </div>
                }
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
            background: var(--surface-2); border: 1px solid var(--border);
            border-radius: var(--radius-lg); margin-bottom: 10px; overflow: hidden;
        }
        .grupo-cab {
            display: flex; align-items: center; gap: 12px; width: 100%;
            padding: 13px 14px; cursor: pointer; text-align: left;
            background: transparent; border: none; color: inherit;
        }
        .grupo-cab:hover { background: var(--surface-1); }
        .grupo-ico {
            width: 42px; height: 42px; border-radius: 10px; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center;
            font-size: 22px; background: var(--surface-1);
        }
        .grupo-txt { flex: 1; min-width: 0; }
        .grupo-nom {
            font-size: 14px; font-weight: 700;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .grupo-sub { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
        .chevron { font-size: 18px; color: var(--text-muted); flex-shrink: 0; }

        .miembros {
            padding: 4px 14px 12px; border-top: 1px solid var(--border);
        }
        .miembro {
            display: flex; align-items: center; gap: 10px;
            padding: 9px 0; border-bottom: 1px solid var(--border);
        }
        .miembro:last-child { border-bottom: none; }
        .ava {
            width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center;
            background: var(--surface-1); color: var(--text-secondary);
            font-size: 12px; font-weight: 700;
        }
        .mi-alias { flex: 1; font-size: 14px; font-weight: 600; min-width: 0; }
        .mi-badge {
            font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 999px;
            background: var(--tipo-elim-bg, rgba(55, 138, 221, 0.14));
            color: var(--tipo-elim-text, #0c447c);
        }
        .sin-miembros { font-size: 13px; color: var(--text-muted); margin: 8px 0; }
        `,
    ],
})
export class AdminGruposComponent {
    private readonly gruposSrv = inject(GruposService);

    readonly grupos = toSignal(this.gruposSrv.todosLosGrupos(), {
        initialValue: [] as Grupo[],
    });

    /** Grupos expandidos. */
    private readonly abiertos = signal<string[]>([]);
    /** Miembros por grupo, cargados bajo demanda al abrir. */
    private readonly miembrosPorGrupo = signal<Record<string, MiembroGrupo[]>>({});
    private readonly suscripciones = new Map<string, Subscription>();

    constructor() {
        inject(DestroyRef).onDestroy(() => {
            this.suscripciones.forEach((s) => s.unsubscribe());
            this.suscripciones.clear();
        });
    }

    abierto(grupoId: string): boolean {
        return this.abiertos().includes(grupoId);
    }

    miembrosDe(grupoId: string): MiembroGrupo[] {
        return this.miembrosPorGrupo()[grupoId] ?? [];
    }

    /** Abre o cierra un grupo. Al abrir por primera vez, escucha sus miembros. */
    alternar(grupoId: string): void {
        const actuales = this.abiertos();
        if (actuales.includes(grupoId)) {
            this.abiertos.set(actuales.filter((x) => x !== grupoId));
            return;
        }
        this.abiertos.set([...actuales, grupoId]);

        // Suscripción única por grupo: se mantiene aunque se cierre y reabra.
        if (!this.suscripciones.has(grupoId)) {
            const sub = this.gruposSrv.miembros(grupoId).subscribe((lista) => {
                this.miembrosPorGrupo.update((mapa) => ({ ...mapa, [grupoId]: lista }));
            });
            this.suscripciones.set(grupoId, sub);
        }
    }

    inicial(alias: string): string {
        return (alias ?? '?').charAt(0).toUpperCase();
    }
}
