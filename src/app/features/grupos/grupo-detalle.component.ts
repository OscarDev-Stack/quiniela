import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { NavComponent } from '../../shared/nav.component';
import { CargandoComponent } from '../../shared/cargando.component';
import { GruposService } from '../../core/services/grupos.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../shared/toast.service';
import { Grupo, MiembroGrupo, FilaTablaGrupo } from '../../core/models/grupo.model';

@Component({
  selector: 'app-grupo-detalle',
  standalone: true,
  imports: [CommonModule, FormsModule, NavComponent, CargandoComponent],
  template: `
    <div class="screen">
      <app-nav [back]="true" title="Grupo" />

      @if (cargando()) {
        <app-cargando texto="Cargando el grupo" />
      } @else if (grupo(); as g) {
        <!-- Cabecera -->
        <div class="cab">
          <div class="cab-ico">{{ g.icono }}</div>
          <div class="cab-txt">
            <div class="cab-nom">{{ g.nombre }}</div>
            <div class="cab-sub">{{ g.miembrosCount ?? miembros().length }} miembros</div>
          </div>
        </div>

        <!-- Código para compartir -->
        <div class="codigo-box">
          <div class="codigo-label">Código de invitación</div>
          <div class="codigo-val">{{ g.codigo }}</div>
          <button class="copiar" (click)="copiar(g.codigo)">
            <i class="ti ti-copy"></i> Copiar
          </button>
        </div>

        <!-- Acciones de admin -->
        @if (soyAdmin(g)) {
          <button class="btn btn--primary ancho" (click)="abrirAgregar()">
            <i class="ti ti-user-plus"></i> Agregar miembro
          </button>

          <div class="crear-grupo">
            <span class="crear-tit">Crear para este grupo</span>
            <div class="crear-botones">
              <button class="btn btn--crear" (click)="crearPartido()">
                <i class="ti ti-ball-football"></i> Partido
              </button>
              <button class="btn btn--crear" (click)="crearTorneo()">
                <i class="ti ti-tournament"></i> Torneo
              </button>
              <button class="btn btn--crear" (click)="crearEliminatoria()">
                <i class="ti ti-sitemap"></i> Eliminatoria
              </button>
            </div>
          </div>
        }

        <!-- Tabla del grupo -->
        @if (tabla().length > 0) {
          <div class="seccion">Tabla del grupo</div>
          <div class="tabla">
            @for (f of tabla(); track f.uid; let i = $index) {
              <div class="fila" [class.fila--yo]="f.uid === miUid()">
                <span class="pos" [class.pos--1]="i === 0" [class.pos--2]="i === 1" [class.pos--3]="i === 2">
                  {{ i + 1 }}
                </span>
                <span class="fila-alias">{{ f.uid === miUid() ? f.alias + ' (tú)' : f.alias }}</span>
                <span class="fila-pct">{{ f.porcentaje }}%</span>
                <span class="fila-ac">{{ f.aciertos }}/{{ f.resueltos }}</span>
              </div>
            }
          </div>
        }

        <!-- Miembros -->
        <div class="seccion">Miembros</div>
        @for (m of miembros(); track m.uid) {
          <div class="miembro">
            <div class="ava">{{ inicial(m.alias) }}</div>
            <span class="mi-alias">{{ m.uid === miUid() ? m.alias + ' (tú)' : m.alias }}</span>
            @if (m.rol === 'admin') {
              <span class="mi-badge">ADMIN</span>
            }
          </div>
        }

        <!-- Salir -->
        <button class="btn btn--peligro ancho" (click)="intentarSalir(g)">
          <i class="ti ti-logout"></i> Salir del grupo
        </button>
      } @else {
        <p class="empty">No encontramos este grupo, o ya no perteneces a él.</p>
      }

      <!-- Diálogo: agregar miembro -->
      @if (dialogo() === 'agregar') {
        <div class="overlay" (click)="cerrar()">
          <div class="dialogo" (click)="$event.stopPropagation()">
            <h3>Agregar miembro</h3>
            <label class="campo">
              <span>Buscar por nombre</span>
              <input [(ngModel)]="busqueda" (ngModelChange)="buscar()" placeholder="Escribe un alias…" />
            </label>
            @if (buscando()) {
              <p class="hint">Buscando…</p>
            } @else if (resultados().length === 0 && busqueda.trim().length >= 2) {
              <p class="hint">Nadie coincide con “{{ busqueda }}”.</p>
            }
            @for (u of resultados(); track u.uid) {
              <div class="res">
                <span>{{ u.alias }}</span>
                <button class="btn sm" [disabled]="ocupado()" (click)="agregar(u.uid)">Agregar</button>
              </div>
            }
            <div class="dialogo-acciones">
              <button class="btn" (click)="cerrar()">Cerrar</button>
            </div>
          </div>
        </div>
      }

      <!-- Diálogo: transferir admin al salir -->
      @if (dialogo() === 'transferir') {
        <div class="overlay" (click)="cerrar()">
          <div class="dialogo" (click)="$event.stopPropagation()">
            <h3>Transferir administración</h3>
            <p class="hint">
              Eres el administrador. Antes de salir, elige quién quedará a cargo del grupo.
            </p>
            @for (m of otrosMiembros(); track m.uid) {
              <div class="res">
                <span>{{ m.alias }}</span>
                <button class="btn sm" [disabled]="ocupado()" (click)="salirTransfiriendo(m.uid)">
                  Dejar a cargo
                </button>
              </div>
            }
            <div class="dialogo-acciones">
              <button class="btn" (click)="cerrar()">Cancelar</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .cab { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
      .cab-ico {
        width: 54px; height: 54px; border-radius: 14px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        font-size: 26px; background: var(--surface-2);
      }
      .cab-nom { font-size: 19px; font-weight: 800; }
      .cab-sub { font-size: 13px; color: var(--text-secondary); }

      .codigo-box {
        background: var(--surface-2); border: 1px dashed var(--accent-fill);
        border-radius: 14px; padding: 14px; text-align: center; margin-bottom: 16px;
      }
      .codigo-label { font-size: 11px; color: var(--text-secondary); letter-spacing: 1px; }
      .codigo-val {
        font-size: 26px; font-weight: 800; letter-spacing: 4px;
        color: var(--accent-text); margin: 4px 0 10px;
      }
      .copiar {
        display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
        font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 999px;
        border: 1px solid var(--border); background: var(--surface-1); color: var(--text-primary);
      }

      .btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        padding: 11px; font-size: 14px; font-weight: 600; cursor: pointer;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-primary);
      }
      .btn.sm { padding: 6px 12px; font-size: 13px; }
      .btn.ancho { width: 100%; }
      .btn--primary { background: var(--accent-fill); color: #fff; border-color: var(--accent-fill); }

      .crear-grupo {
        margin-top: 16px; padding: 14px; border: 1px solid var(--border);
        border-radius: var(--radius); background: var(--surface-1);
      }
      .crear-tit {
        display: block; font-size: 11px; font-weight: 700; color: var(--text-muted);
        text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px;
      }
      .crear-botones { display: flex; gap: 8px; }
      .crear-botones .btn { flex: 1; }
      .btn--crear {
        display: inline-flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 5px; padding: 12px 8px; background: var(--surface-2);
        color: var(--text-primary); font-size: 12px; font-weight: 600;
      }
      .btn--crear i { font-size: 19px; color: var(--accent-text); }
      .btn--peligro { color: var(--danger-text); border-color: var(--danger-text); margin-top: 20px; }
      .btn:disabled { opacity: 0.6; cursor: default; }

      .seccion {
        font-size: 12px; font-weight: 700; color: var(--text-secondary);
        text-transform: uppercase; letter-spacing: 0.5px; margin: 20px 0 10px;
      }
      .tabla { display: flex; flex-direction: column; }
      .fila {
        display: flex; align-items: center; gap: 10px;
        padding: 9px 6px; border-bottom: 1px solid var(--border);
      }
      .fila--yo { background: var(--accent-bg); border-radius: 8px; }
      .pos {
        width: 24px; height: 24px; flex-shrink: 0; border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 700; background: var(--surface-1); color: var(--text-secondary);
      }
      .pos--1 { background: #f4d03f; color: #6b5300; }
      .pos--2 { background: #c8ccd4; color: #3a3f47; }
      .pos--3 { background: #d98e5f; color: #4a2a12; }
      .fila-alias { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fila-pct { font-size: 14px; font-weight: 700; }
      .fila-ac { font-size: 12px; color: var(--text-muted); min-width: 46px; text-align: right; }
      .miembro {
        display: flex; align-items: center; gap: 10px;
        padding: 9px 4px; border-bottom: 1px solid var(--border);
      }
      .ava {
        width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        background: var(--accent-bg); color: var(--accent-text); font-weight: 700; font-size: 14px;
      }
      .mi-alias { flex: 1; font-size: 14px; }
      .mi-badge {
        font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
        color: var(--tipo-elim-text, #0c447c); background: var(--tipo-elim-bg, rgba(55,138,221,0.14));
      }

      .empty { color: var(--text-muted); font-size: 14px; text-align: center; padding: 40px 0; }

      .overlay {
        position: fixed; inset: 0; z-index: 50; background: rgba(0, 0, 0, 0.45);
        display: flex; align-items: center; justify-content: center; padding: 24px;
      }
      .dialogo {
        width: 100%; max-width: 360px; background: var(--surface-2);
        border-radius: 16px; padding: 20px; max-height: 80vh; overflow-y: auto;
      }
      .dialogo h3 { margin: 0 0 14px; font-size: 17px; font-weight: 700; }
      .campo { display: block; margin-bottom: 12px; }
      .campo span { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; }
      .campo input {
        width: 100%; padding: 11px 12px; border: 1px solid var(--border);
        border-radius: var(--radius); background: var(--surface-1);
        color: var(--text-primary); font-size: 15px;
      }
      .hint { font-size: 13px; color: var(--text-secondary); margin: 4px 0 12px; }
      .res {
        display: flex; align-items: center; justify-content: space-between;
        padding: 9px 0; border-bottom: 1px solid var(--border);
      }
      .res span { font-size: 14px; }
      .dialogo-acciones { display: flex; gap: 8px; margin-top: 14px; }
    `,
  ],
})
export class GrupoDetalleComponent {
  private readonly gruposSrv = inject(GruposService);
  private readonly users = inject(UserService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';

  private readonly me = toSignal(this.users.me$, { initialValue: null });
  readonly miUid = computed(() => this.me()?.id ?? '');

  private readonly grupoRaw = toSignal(this.gruposSrv.grupo(this.id), { initialValue: undefined });
  readonly grupo = computed(() => this.grupoRaw());
  readonly cargando = computed(() => this.grupoRaw() === undefined);

  readonly miembros = toSignal(this.gruposSrv.miembros(this.id), { initialValue: [] as MiembroGrupo[] });
  readonly otrosMiembros = computed(() => this.miembros().filter((m) => m.uid !== this.miUid()));

  private readonly tablaRaw = toSignal(this.gruposSrv.tabla(this.id), { initialValue: [] as FilaTablaGrupo[] });
  /** Tabla del grupo ordenada por % (y por aciertos como desempate). */
  readonly tabla = computed(() =>
    [...this.tablaRaw()].sort((a, b) => b.porcentaje - a.porcentaje || b.aciertos - a.aciertos),
  );

  // Diálogos y búsqueda.
  readonly dialogo = signal<'ninguno' | 'agregar' | 'transferir'>('ninguno');
  readonly ocupado = signal(false);
  readonly buscando = signal(false);
  readonly resultados = signal<{ uid: string; alias: string }[]>([]);
  busqueda = '';
  private timerBusqueda: ReturnType<typeof setTimeout> | null = null;

  soyAdmin(g: Grupo): boolean {
    return g.adminUid === this.miUid();
  }

  /** Va al formulario de crear torneo con este grupo precargado. */
  crearTorneo(): void {
    this.router.navigate(['/admin/torneos/crear'], { queryParams: { grupo: this.id } });
  }

  /** Va al formulario de crear eliminatoria con este grupo precargado. */
  crearEliminatoria(): void {
    this.router.navigate(['/admin/brackets/crear'], { queryParams: { grupo: this.id } });
  }

  /** Va al formulario de crear partido con este grupo precargado. */
  crearPartido(): void {
    this.router.navigate(['/admin/partidos/crear'], { queryParams: { grupo: this.id } });
  }
  inicial(alias: string): string {
    return (alias?.trim()?.[0] ?? '?').toUpperCase();
  }

  copiar(codigo: string): void {
    navigator.clipboard?.writeText(codigo).then(
      () => this.toast.exito('Código copiado.'),
      () => this.toast.error('No se pudo copiar.'),
    );
  }

  abrirAgregar(): void {
    this.busqueda = '';
    this.resultados.set([]);
    this.dialogo.set('agregar');
  }
  cerrar(): void {
    this.dialogo.set('ninguno');
  }

  /** Busca con un pequeño retraso para no llamar en cada tecla. */
  buscar(): void {
    if (this.timerBusqueda) clearTimeout(this.timerBusqueda);
    const texto = this.busqueda.trim();
    if (texto.length < 2) {
      this.resultados.set([]);
      return;
    }
    this.timerBusqueda = setTimeout(async () => {
      this.buscando.set(true);
      try {
        const yaEstan = new Set(this.miembros().map((m) => m.uid));
        const r = await this.gruposSrv.buscarUsuarios(texto);
        this.resultados.set(r.filter((u) => !yaEstan.has(u.uid)));
      } catch {
        this.resultados.set([]);
      } finally {
        this.buscando.set(false);
      }
    }, 350);
  }

  async agregar(uid: string): Promise<void> {
    this.ocupado.set(true);
    try {
      await this.gruposSrv.agregarMiembro(this.id, uid);
      this.toast.exito('Miembro agregado.');
      this.resultados.update((lista) => lista.filter((u) => u.uid !== uid));
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo agregar.');
    } finally {
      this.ocupado.set(false);
    }
  }

  intentarSalir(g: Grupo): void {
    // Si soy admin y hay más gente, debo transferir primero.
    if (this.soyAdmin(g) && this.miembros().length > 1) {
      this.dialogo.set('transferir');
      return;
    }
    this.salir();
  }

  private async salir(nuevoAdminUid?: string): Promise<void> {
    this.ocupado.set(true);
    try {
      const r = await this.gruposSrv.salir(this.id, nuevoAdminUid);
      this.toast.exito(r.eliminado ? 'Saliste. El grupo quedó vacío y se eliminó.' : 'Saliste del grupo.');
      this.router.navigate(['/grupos']);
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo salir.');
    } finally {
      this.ocupado.set(false);
    }
  }

  salirTransfiriendo(nuevoAdminUid: string): void {
    this.cerrar();
    this.salir(nuevoAdminUid);
  }
}