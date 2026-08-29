import { Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { Bracket } from '../../core/models/bracket.model';
import { BracketsService } from '../../core/services/brackets.service';
import { AdminService } from '../../core/services/admin.service';
import { GruposService } from '../../core/services/grupos.service';
import { ToastService } from '../../shared/toast.service';
import { ConfirmarService } from '../../shared/confirmar.service';
import { EscudoComponent } from '../../shared/escudo.component';
import { AppUser } from '../../core/models/user.model';

/**
 * Modo dueños: el admin asigna cada equipo del cuadro a un participante.
 * Como puede haber +100 usuarios, la elección de registrado tiene buscador.
 * La asignación NO es automática: se elige, se revisa, y con "Guardar" se
 * confirma (con un aviso, porque una vez enviada ya no se puede cambiar y
 * le llega notificación al participante).
 */
@Component({
    selector: 'app-asignar-duenos',
    standalone: true,
    imports: [CommonModule, FormsModule, EscudoComponent],
    template: `
    <div class="asignar">
      <p class="intro">
        Asigna cada equipo a un participante. Si eliges a alguien registrado, le
        llegará el aviso con las reglas y se le cobrará al aceptar. Un invitado
        externo lo controlas tú (no cobra ni recibe aviso).
        <strong>Una vez guardada una asignación no se puede cambiar.</strong>
      </p>

      @for (eq of equipos(); track eq) {
        <div class="fila">
          <span class="eq">
            <app-escudo [equipo]="eq" [size]="24" />
            <span class="eq-nom">{{ eq }}</span>
          </span>

          @if (duenoDe(eq); as d) {
            <!-- Ya asignado: solo mostramos el estado, no se puede cambiar. -->
            <span class="estado" [class.estado--ok]="d.estado === 'aceptado'">
              @if (d.estado === 'aceptado') {
                <i class="ti ti-check"></i> {{ d.nombre }} (aceptó)
              } @else if (d.estado === 'invitado') {
                <i class="ti ti-clock"></i> {{ d.nombre }} (esperando que acepte)
              } @else {
                <i class="ti ti-user"></i> {{ d.nombre }} (invitado)
              }
            </span>
          } @else {
            <!-- Sin asignar: elegir tipo y participante, luego guardar. -->
            <div class="asig">
              <select [ngModel]="tipoDe(eq)" (ngModelChange)="cambiarTipo(eq, $event)">
                <option value="">Sin asignar</option>
                <option value="registrado">Registrado…</option>
                <option value="invitado">Invitado externo</option>
              </select>

              @if (tipoDe(eq) === 'registrado') {
                <div class="buscador">
                  <input
                    type="text"
                    placeholder="Buscar jugador por nombre…"
                    [ngModel]="busquedaDe(eq)"
                    (ngModelChange)="buscar(eq, $event)"
                  />
                  @if (busquedaDe(eq) && !uidElegidoDe(eq)) {
                    <div class="resultados">
                      @for (u of filtrados(eq); track u.id) {
                        <button class="resultado" (click)="elegirUsuario(eq, u)">
                          {{ u.alias }}
                        </button>
                      } @empty {
                        <span class="sin-res">Sin resultados</span>
                      }
                    </div>
                  }
                  @if (uidElegidoDe(eq); as sel) {
                    <div class="elegido-fila">
                      <span><i class="ti ti-user-check"></i> {{ nombreElegidoDe(eq) }}</span>
                      <button class="btn-guardar" (click)="confirmarRegistrado(eq)" [disabled]="ocupado()">
                        Guardar
                      </button>
                    </div>
                  }
                </div>
              } @else if (tipoDe(eq) === 'invitado') {
                <div class="inv">
                  <input
                    type="text"
                    placeholder="Nombre del invitado"
                    [ngModel]="nombreInvitadoDe(eq)"
                    (ngModelChange)="ponerNombreInvitado(eq, $event)"
                  />
                  <button class="btn-guardar" (click)="confirmarInvitado(eq)" [disabled]="!nombreInvitadoDe(eq) || ocupado()">
                    Guardar
                  </button>
                </div>
              }
            </div>
          }
        </div>
      }

      <p class="resumen">{{ asignados() }} de {{ equipos().length }} equipos asignados.</p>
    </div>
  `,
    styles: [
        `
      .asignar { display: flex; flex-direction: column; gap: 12px; }
      .intro { font-size: 13px; color: var(--text-secondary); margin: 0 0 4px; line-height: 1.5; }

      .fila {
        display: flex; flex-direction: column; gap: 8px;
        padding: 11px; border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-1);
      }
      .eq { display: flex; align-items: center; gap: 8px; }
      .eq-nom { font-size: 14px; font-weight: 600; color: var(--text-primary); }

      .asig { display: flex; flex-direction: column; gap: 8px; }
      .asig select, .buscador input, .inv input {
        width: 100%; padding: 8px; font-size: 13px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-0); color: var(--text-primary);
      }

      .buscador { display: flex; flex-direction: column; gap: 6px; position: relative; }
      .resultados {
        display: flex; flex-direction: column; max-height: 180px; overflow-y: auto;
        border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-0);
      }
      .resultado {
        text-align: left; padding: 9px 11px; cursor: pointer; font-size: 13px;
        background: transparent; border: none; border-bottom: 1px solid var(--border);
        color: var(--text-primary);
      }
      .resultado:last-child { border-bottom: none; }
      .resultado:hover { background: var(--surface-1); }
      .sin-res { padding: 9px 11px; font-size: 12px; color: var(--text-muted); }

      .elegido-fila, .inv { display: flex; align-items: center; gap: 8px; }
      .elegido-fila { justify-content: space-between; }
      .elegido-fila span { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--text-primary); }
      .inv input { flex: 1; }

      .btn-guardar {
        flex-shrink: 0; padding: 8px 14px; cursor: pointer; font-size: 13px; font-weight: 600;
        border: none; border-radius: var(--radius); background: var(--accent-fill); color: #fff;
      }
      .btn-guardar:disabled { opacity: 0.45; cursor: default; }

      .estado {
        display: flex; align-items: center; gap: 6px; font-size: 13px;
        color: var(--text-secondary);
      }
      .estado--ok { color: var(--success-text); font-weight: 600; }

      .resumen { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin: 4px 0 0; }
    `,
    ],
})
export class AsignarDuenosComponent {
    private readonly service = inject(BracketsService);
    private readonly admin = inject(AdminService);
    private readonly grupos = inject(GruposService);
    private readonly toast = inject(ToastService);
    private readonly confirmar = inject(ConfirmarService);

    readonly bracket = input.required<Bracket>();

    private readonly todosLosUsuarios = toSignal(this.admin.getUsers(), {
        initialValue: [] as AppUser[],
    });

    /**
     * uids de los miembros del grupo del bracket, si es de grupo. Para brackets
     * globales queda null (sin restricción). Se recarga cuando cambia el
     * bracket de entrada.
     */
    private readonly miembrosGrupo = toSignal(
        toObservable(computed(() => this.bracket()?.grupoId ?? null)).pipe(
            switchMap((grupoId) =>
                grupoId
                    ? this.grupos.miembros(grupoId).pipe(map((ms) => new Set(ms.map((m) => m.uid))))
                    : of(null),
            ),
        ),
        { initialValue: null as Set<string> | null },
    );

    /**
     * Usuarios candidatos a ser dueños. Si el bracket es de un grupo, solo los
     * miembros del grupo (los de fuera no podrían siquiera ver el bracket).
     */
    readonly usuarios = computed(() => {
        const todos = this.todosLosUsuarios();
        const miembros = this.miembrosGrupo();
        if (!miembros) return todos; // bracket global: todos
        return todos.filter((u) => u.id && miembros.has(u.id));
    });

    private readonly tipos = signal<Record<string, string>>({});
    private readonly nombresInvitado = signal<Record<string, string>>({});
    private readonly busquedas = signal<Record<string, string>>({});
    private readonly elegidos = signal<Record<string, { uid: string; alias: string }>>({});
    readonly ocupado = signal(false);

    readonly equipos = computed(() => (this.bracket().equipos ?? []).map((e) => e.nombre));

    duenoDe(equipo: string) {
        return (this.bracket().duenos ?? []).find((d) => d.equipo === equipo) ?? null;
    }

    tipoDe(equipo: string): string {
        return this.tipos()[equipo] ?? '';
    }
    busquedaDe(equipo: string): string {
        return this.busquedas()[equipo] ?? '';
    }
    uidElegidoDe(equipo: string): string {
        return this.elegidos()[equipo]?.uid ?? '';
    }
    nombreElegidoDe(equipo: string): string {
        return this.elegidos()[equipo]?.alias ?? '';
    }
    nombreInvitadoDe(equipo: string): string {
        return this.nombresInvitado()[equipo] ?? '';
    }

    cambiarTipo(equipo: string, tipo: string): void {
        this.tipos.update((t) => ({ ...t, [equipo]: tipo }));
        // Limpia lo elegido si cambia de tipo.
        this.elegidos.update((e) => { const c = { ...e }; delete c[equipo]; return c; });
        this.busquedas.update((b) => ({ ...b, [equipo]: '' }));
    }

    buscar(equipo: string, texto: string): void {
        this.busquedas.update((b) => ({ ...b, [equipo]: texto }));
        // Si estaba elegido y vuelve a escribir, se deselecciona para buscar de nuevo.
        this.elegidos.update((e) => { const c = { ...e }; delete c[equipo]; return c; });
    }

    ponerNombreInvitado(equipo: string, nombre: string): void {
        this.nombresInvitado.update((n) => ({ ...n, [equipo]: nombre }));
    }

    /** Usuarios que coinciden con la búsqueda y no están ya asignados. */
    filtrados(equipo: string): AppUser[] {
        const q = this.norm(this.busquedaDe(equipo));
        if (!q) return [];
        const yaAsignados = new Set(
            (this.bracket().duenos ?? []).map((d) => d.uid).filter(Boolean) as string[],
        );
        return this.usuarios()
            .filter((u) => u.id && !yaAsignados.has(u.id))
            .filter((u) => this.norm(u.alias ?? '').includes(q))
            .slice(0, 8);
    }

    private norm(s: string): string {
        return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    elegirUsuario(equipo: string, u: AppUser): void {
        this.elegidos.update((e) => ({ ...e, [equipo]: { uid: u.id!, alias: u.alias ?? 'Jugador' } }));
        this.busquedas.update((b) => ({ ...b, [equipo]: u.alias ?? '' }));
    }

    asignados(): number {
        return (this.bracket().duenos ?? []).length;
    }

    async confirmarRegistrado(equipo: string): Promise<void> {
        const sel = this.elegidos()[equipo];
        if (!sel) return;
        const costo = this.bracket().costoEntrada;
        const ok = await this.confirmar.pedir({
            titulo: 'Confirmar asignación',
            mensaje:
                `Vas a asignar ${equipo} a ${sel.alias}. Le llegará una notificación con las reglas` +
                (costo > 0 ? ` y podrá aceptar pagando ${costo} pts.` : '.') +
                ' Una vez asignado no se puede cambiar. ¿Continuar?',
            aceptar: 'Sí, asignar',
            cancelar: 'Cancelar',
        });
        if (!ok) return;

        this.ocupado.set(true);
        try {
            await this.service.asignarDueno(this.bracket().id, equipo, sel.uid, '');
            this.toast.exito('Participante asignado. Le llegará el aviso.');
        } catch (e: unknown) {
            this.toast.error((e as Error)?.message ?? 'No se pudo asignar.');
        } finally {
            this.ocupado.set(false);
        }
    }

    async confirmarInvitado(equipo: string): Promise<void> {
        const nombre = this.nombreInvitadoDe(equipo).trim();
        if (!nombre) return;
        const ok = await this.confirmar.pedir({
            titulo: 'Confirmar invitado',
            mensaje: `Vas a asignar ${equipo} al invitado "${nombre}". Una vez asignado no se puede cambiar. ¿Continuar?`,
            aceptar: 'Sí, asignar',
            cancelar: 'Cancelar',
        });
        if (!ok) return;

        this.ocupado.set(true);
        try {
            await this.service.asignarDueno(this.bracket().id, equipo, null, nombre);
            this.toast.exito('Invitado asignado.');
        } catch (e: unknown) {
            this.toast.error((e as Error)?.message ?? 'No se pudo asignar.');
        } finally {
            this.ocupado.set(false);
        }
    }
}