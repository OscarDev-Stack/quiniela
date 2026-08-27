import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavComponent } from '../../shared/nav.component';
import { CargandoComponent } from '../../shared/cargando.component';
import { GruposService } from '../../core/services/grupos.service';
import { UserService } from '../../core/services/user.service';
import { ToastService } from '../../shared/toast.service';
import { ContextoService } from '../../shared/contexto.service';
import { Grupo } from '../../core/models/grupo.model';

/** Emojis que el usuario puede elegir como ícono del grupo. */
const EMOJIS = ['⚽', '🏆', '🔥', '🎯', '🥅', '🏅', '🎮', '👑', '💪', '🚀', '⭐', '🍺'];

@Component({
  selector: 'app-grupos',
  standalone: true,
  imports: [CommonModule, FormsModule, NavComponent, CargandoComponent],
  template: `
    <div class="screen">
      <app-nav [back]="true" title="Mis grupos" />

      @if (cargando()) {
        <app-cargando texto="Cargando tus grupos" />
      } @else {
        <!-- Acciones -->
        <div class="acciones">
          @if (esAdminGrupo()) {
            <button class="btn btn--primary" (click)="abrirCrear()">
              <i class="ti ti-plus"></i> Crear grupo
            </button>
          }
          <button class="btn" (click)="abrirUnirse()">
            <i class="ti ti-ticket"></i> Unirme con código
          </button>
        </div>

        <!-- Lista de grupos -->
        @if (grupos().length === 0) {
          <div class="vacio">
            <i class="ti ti-users-group"></i>
            <p>Todavía no perteneces a ningún grupo.</p>
            <p class="pista">
              @if (esAdminGrupo()) {
                Crea uno o únete con un código de invitación.
              } @else {
                Pide un código a quien administra un grupo para unirte.
              }
            </p>
          </div>
        } @else {
          @for (g of grupos(); track g.id) {
            <div class="grupo" (click)="entrar(g)">
              <div class="grupo-ico">{{ g.icono }}</div>
              <div class="grupo-txt">
                <div class="grupo-nom">{{ g.nombre }}</div>
                <div class="grupo-sub">{{ g.miembrosCount ?? 1 }} miembros · {{ g.codigo }}</div>
              </div>
              <div class="grupo-der">
                <span class="badge" [class.badge--admin]="esAdminDe(g)">
                  {{ esAdminDe(g) ? 'ADMIN' : 'MIEMBRO' }}
                </span>
                <button
                  class="estrella"
                  [class.estrella--on]="esFavorito(g.id)"
                  (click)="toggleFavorito(g, $event)"
                  aria-label="Favorito"
                >
                  <i class="ti" [class.ti-star-filled]="esFavorito(g.id)" [class.ti-star]="!esFavorito(g.id)"></i>
                </button>
              </div>
            </div>
          }
        }
      }

      <!-- Diálogo: crear grupo -->
      @if (modo() === 'crear') {
        <div class="overlay" (click)="cerrar()">
          <div class="dialogo" (click)="$event.stopPropagation()">
            <h3>Crear grupo</h3>
            <label class="campo">
              <span>Nombre</span>
              <input [(ngModel)]="nombre" placeholder="Los Cracks del Barrio" maxlength="30" />
            </label>
            <span class="campo-label">Ícono</span>
            <div class="emojis">
              @for (e of emojis; track e) {
                <button class="emoji" [class.emoji--on]="icono === e" (click)="icono = e">{{ e }}</button>
              }
            </div>
            <div class="dialogo-acciones">
              <button class="btn" (click)="cerrar()">Cancelar</button>
              <button class="btn btn--primary" [disabled]="ocupado() || nombre.trim().length < 3" (click)="crear()">
                {{ ocupado() ? 'Creando…' : 'Crear' }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Diálogo: unirse -->
      @if (modo() === 'unirse') {
        <div class="overlay" (click)="cerrar()">
          <div class="dialogo" (click)="$event.stopPropagation()">
            <h3>Unirme a un grupo</h3>
            <label class="campo">
              <span>Código de invitación</span>
              <input [(ngModel)]="codigo" placeholder="BARRIO7" maxlength="8" style="text-transform:uppercase" />
            </label>
            <div class="dialogo-acciones">
              <button class="btn" (click)="cerrar()">Cancelar</button>
              <button class="btn btn--primary" [disabled]="ocupado() || !codigo.trim()" (click)="unirse()">
                {{ ocupado() ? 'Uniéndome…' : 'Unirme' }}
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .acciones { display: flex; gap: 8px; margin-bottom: 18px; }
      .btn {
        flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        padding: 11px; font-size: 14px; font-weight: 600; cursor: pointer;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-2); color: var(--text-primary);
      }
      .btn--primary { background: var(--accent-fill); color: #fff; border-color: var(--accent-fill); }
      .btn:disabled { opacity: 0.6; cursor: default; }

      .vacio { text-align: center; padding: 44px 24px; color: var(--text-muted); }
      .vacio i { font-size: 42px; opacity: 0.5; }
      .vacio p { margin: 10px 0 0; font-size: 14px; }
      .vacio .pista { font-size: 12px; }

      .grupo {
        display: flex; align-items: center; gap: 12px; cursor: pointer;
        background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px;
        padding: 13px 14px; margin-bottom: 10px;
      }
      .grupo-ico {
        width: 44px; height: 44px; border-radius: 11px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        font-size: 22px; background: var(--surface-1);
      }
      .grupo-txt { flex: 1; min-width: 0; }
      .grupo-nom { font-size: 15px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .grupo-sub { font-size: 12px; color: var(--text-secondary); }
      .grupo-der { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
      .badge {
        font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 999px;
        background: var(--surface-1); color: var(--text-secondary);
      }
      .badge--admin { color: var(--tipo-elim-text, #0c447c); background: var(--tipo-elim-bg, rgba(55,138,221,0.14)); }
      .estrella {
        background: transparent; border: none; cursor: pointer; padding: 0;
        font-size: 18px; color: var(--text-muted);
      }
      .estrella--on { color: #f1c40f; }

      /* Diálogos */
      .overlay {
        position: fixed; inset: 0; z-index: 50; background: rgba(0, 0, 0, 0.45);
        display: flex; align-items: center; justify-content: center; padding: 24px;
      }
      .dialogo {
        width: 100%; max-width: 340px; background: var(--surface-2);
        border-radius: 16px; padding: 20px;
      }
      .dialogo h3 { margin: 0 0 16px; font-size: 17px; font-weight: 700; }
      .campo { display: block; margin-bottom: 14px; }
      .campo span { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; }
      .campo input {
        width: 100%; padding: 11px 12px; border: 1px solid var(--border);
        border-radius: var(--radius); background: var(--surface-1);
        color: var(--text-primary); font-size: 15px;
      }
      .campo-label { display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; }
      .emojis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-bottom: 18px; }
      .emoji {
        aspect-ratio: 1; font-size: 20px; cursor: pointer;
        border: 1px solid var(--border); border-radius: 10px; background: var(--surface-1);
      }
      .emoji--on { border-color: var(--accent-fill); box-shadow: 0 0 0 2px var(--accent-fill); }
      .dialogo-acciones { display: flex; gap: 8px; }
    `,
  ],
})
export class GruposComponent {
  private readonly gruposSrv = inject(GruposService);
  private readonly contexto = inject(ContextoService);
  private readonly users = inject(UserService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly emojis = EMOJIS;

  private readonly me = toSignal(this.users.me$, { initialValue: null });
  readonly esAdminGrupo = computed(() => this.me()?.esAdminGrupo === true);
  readonly miUid = computed(() => this.me()?.id ?? '');
  private readonly favoritos = computed(() => new Set(this.me()?.gruposFavoritos ?? []));

  private readonly gruposRaw = toSignal(this.gruposSrv.misGrupos(), { initialValue: null });
  readonly cargando = computed(() => this.gruposRaw() === null);
  readonly grupos = computed(() => this.gruposRaw() ?? []);

  // Estado de los diálogos.
  readonly modo = signal<'ninguno' | 'crear' | 'unirse'>('ninguno');
  readonly ocupado = signal(false);
  nombre = '';
  icono = EMOJIS[0];
  codigo = '';

  esAdminDe(g: Grupo): boolean {
    return g.adminUid === this.miUid();
  }
  esFavorito(grupoId: string): boolean {
    return this.favoritos().has(grupoId);
  }

  abrirCrear(): void {
    this.nombre = '';
    this.icono = EMOJIS[0];
    this.modo.set('crear');
  }
  abrirUnirse(): void {
    this.codigo = '';
    this.modo.set('unirse');
  }
  cerrar(): void {
    this.modo.set('ninguno');
  }

  async crear(): Promise<void> {
    this.ocupado.set(true);
    // Guardamos nombre e icono antes de que se resetee el formulario.
    const nombre = this.nombre.trim();
    const icono = this.icono;
    try {
      const r = await this.gruposSrv.crear(nombre, icono);
      this.toast.exito(`Grupo creado. Código: ${r.codigo}`);
      // El grupo recién creado se vuelve el contexto activo.
      this.contexto.cambiar({ grupoId: r.grupoId, nombre, icono });
      this.cerrar();
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo crear el grupo.');
    } finally {
      this.ocupado.set(false);
    }
  }

  async unirse(): Promise<void> {
    this.ocupado.set(true);
    try {
      const r = await this.gruposSrv.unirse(this.codigo.trim().toUpperCase());
      this.toast.exito(`Te uniste a ${r.nombre}.`);
      // El grupo al que te unes se vuelve el contexto activo.
      this.contexto.cambiar({ grupoId: r.grupoId, nombre: r.nombre, icono: r.icono });
      this.cerrar();
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo unir al grupo.');
    } finally {
      this.ocupado.set(false);
    }
  }

  async toggleFavorito(g: Grupo, ev: Event): Promise<void> {
    ev.stopPropagation();
    const nuevo = !this.esFavorito(g.id);
    try {
      await this.gruposSrv.marcarFavorito(g.id, nuevo);
    } catch {
      this.toast.error('No se pudo actualizar el favorito.');
    }
  }

  entrar(g: Grupo): void {
    this.router.navigate(['/grupos', g.id]);
  }
}