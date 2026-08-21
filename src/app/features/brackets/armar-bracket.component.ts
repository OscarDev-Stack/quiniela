import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Bracket, Llave, EquipoBracket } from '../../core/models/bracket.model';
import { BracketsService } from '../../core/services/brackets.service';
import { ToastService } from '../../shared/toast.service';
import { EscudoComponent } from '../../shared/escudo.component';
import { CuadroBracketComponent } from './cuadro-bracket.component';

/**
 * Armado manual de la primera ronda de un bracket (modo "cruces a mano").
 *
 * El admin define quién juega contra quién en cada llave de la primera
 * ronda. Cada equipo se elige de un dropdown, y los ya usados desaparecen
 * de las demás opciones para no repetir. Al guardar cada llave se manda
 * al servidor; cuando todas están completas, el bracket pasa solo a
 * inscripción.
 */
@Component({
  selector: 'app-armar-bracket',
  standalone: true,
  imports: [CommonModule, FormsModule, EscudoComponent, CuadroBracketComponent],
  template: `
    <div class="armar">
      <p class="intro">
        Define los enfrentamientos de la primera ronda. Cada equipo solo puede ir
        en una llave; los que ya elegiste desaparecen de las demás.
      </p>

      <!-- Previa en vivo: el cuadro se va llenando conforme eliges. -->
      <div class="previa">
        <span class="previa-tit">Vista previa del cuadro</span>
        <app-cuadro-bracket [bracket]="bracketPrevia()" />
      </div>

      @for (fila of filas(); track fila.id; let i = $index) {
        <div class="llave">
          <span class="num">Llave {{ i + 1 }}</span>

          <div class="lados">
            <div class="lado">
              <app-escudo [equipo]="fila.local" [size]="22" />
              <select [ngModel]="fila.local" (ngModelChange)="cambiar(fila.id, 'local', $event)">
                <option value="">Local…</option>
                @for (e of disponibles(fila, 'local'); track e) {
                  <option [value]="e">{{ e }}</option>
                }
              </select>
            </div>

            <span class="vs">vs</span>

            <div class="lado">
              <select [ngModel]="fila.visitante" (ngModelChange)="cambiar(fila.id, 'visitante', $event)">
                <option value="">Visitante…</option>
                @for (e of disponibles(fila, 'visitante'); track e) {
                  <option [value]="e">{{ e }}</option>
                }
              </select>
              <app-escudo [equipo]="fila.visitante" [size]="22" />
            </div>
          </div>

          <button
            class="btn-guardar"
            [disabled]="!fila.local || !fila.visitante || guardando()"
            (click)="guardar(fila)"
          >
            @if (sucios().has(fila.id)) { Guardar } @else { <i class="ti ti-check"></i> }
          </button>
        </div>
      }

      @if (todasListas()) {
        <p class="listo"><i class="ti ti-circle-check"></i> Cuadro completo. Ya se puede abrir la inscripción.</p>
      } @else {
        <p class="falta">
          <i class="ti ti-alert-circle"></i>
          Llevas {{ completas() }} de {{ filas().length }} llaves. Completa todas para abrir la inscripción.
        </p>
      }
    </div>
  `,
  styles: [
    `
      .armar { display: flex; flex-direction: column; gap: 12px; }
      .intro { font-size: 13px; color: var(--text-secondary); margin: 0 0 4px; line-height: 1.4; }

      .previa {
        border: 1px dashed var(--border); border-radius: var(--radius);
        padding: 12px; overflow-x: auto;
      }
      .previa-tit {
        display: block; font-size: 11px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.03em; color: var(--text-muted); margin-bottom: 8px;
      }

      .llave {
        display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        padding: 11px; border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-1);
      }
      .num { font-size: 12px; font-weight: 700; color: var(--text-muted); min-width: 54px; }

      .lados { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
      .lado { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
      .lado select {
        flex: 1; min-width: 0; padding: 8px; font-size: 13px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-0); color: var(--text-primary);
      }
      .vs { font-size: 12px; color: var(--text-muted); flex-shrink: 0; }

      .btn-guardar {
        flex-shrink: 0; padding: 8px 12px; cursor: pointer; font-size: 13px; font-weight: 600;
        border: none; border-radius: var(--radius);
        background: var(--accent-fill); color: #fff; min-width: 44px;
      }
      .btn-guardar:disabled { opacity: 0.45; cursor: default; }

      .listo {
        display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600;
        color: var(--success-text); background: var(--success-bg);
        padding: 10px 12px; border-radius: var(--radius); margin: 4px 0 0;
      }
      .falta {
        display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600;
        color: var(--warning-text); background: var(--warning-bg);
        padding: 10px 12px; border-radius: var(--radius); margin: 4px 0 0;
      }
    `,
  ],
})
export class ArmarBracketComponent {
  private readonly service = inject(BracketsService);
  private readonly toast = inject(ToastService);

  readonly bracket = input.required<Bracket>();

  readonly guardando = signal(false);
  /** Llaves con cambios sin guardar. */
  readonly sucios = signal<Set<string>>(new Set());

  /** Filas editables: una por llave de la primera ronda. */
  readonly filas = signal<Array<{ id: string; local: string; visitante: string }>>([]);

  /**
   * El bracket con la primera ronda reflejando lo que hay en los dropdowns
   * ahora mismo (aunque no se haya guardado). Alimenta el cuadro de previa,
   * para ver en vivo qué llave estás armando.
   */
  readonly bracketPrevia = computed<Bracket>(() => {
    const b = this.bracket();
    const porFila = new Map(this.filas().map((f) => [f.id, f]));
    const equipoDe = (nombre: string): EquipoBracket | undefined =>
      (b.equipos ?? []).find((e) => e.nombre === nombre);

    const llaves = b.llaves.map((l) => {
      if (l.ronda !== 0) return l;
      const f = porFila.get(l.id);
      if (!f) return l;
      return {
        ...l,
        local: f.local ? equipoDe(f.local) : undefined,
        visitante: f.visitante ? equipoDe(f.visitante) : undefined,
      };
    });
    return { ...b, llaves };
  });

  private inicializado = false;

  constructor() {
    // Inicializa las filas desde las llaves de la primera ronda cuando el
    // bracket esté disponible. Solo una vez, para no pisar lo que el admin
    // vaya eligiendo si el bracket se refresca desde Firestore.
    effect(() => {
      const b = this.bracket();
      if (this.inicializado || !b?.llaves) return;
      const primera = b.llaves
        .filter((l) => l.ronda === 0)
        .sort((a, c) => a.posicion - c.posicion)
        .map((l) => ({
          id: l.id,
          local: l.local?.nombre ?? '',
          visitante: l.visitante?.nombre ?? '',
        }));
      this.filas.set(primera);
      this.inicializado = true;
    });
  }

  /** Nombres de todos los equipos del bracket. */
  private nombresEquipos(): string[] {
    return (this.bracket().equipos ?? []).map((e) => e.nombre);
  }

  /** Equipos aún disponibles para un dropdown, quitando los ya usados. */
  disponibles(fila: { id: string; local: string; visitante: string }, lado: 'local' | 'visitante'): string[] {
    const usados = new Set<string>();
    for (const f of this.filas()) {
      if (f.local) usados.add(f.local);
      if (f.visitante) usados.add(f.visitante);
    }
    // El propio valor sigue disponible para que no desaparezca del selector.
    const propio = lado === 'local' ? fila.local : fila.visitante;
    if (propio) usados.delete(propio);

    return this.nombresEquipos().filter((e) => !usados.has(e));
  }

  /**
   * Actualiza el equipo de un lado de una llave. Crea un array NUEVO de
   * filas (no muta el objeto) para que el signal cambie y la previa se
   * recalcule en vivo. También marca la llave como sucia (sin guardar).
   */
  cambiar(id: string, lado: 'local' | 'visitante', valor: string): void {
    this.filas.update((fs) =>
      fs.map((f) => (f.id === id ? { ...f, [lado]: valor } : f)),
    );
    const s = new Set(this.sucios());
    s.add(id);
    this.sucios.set(s);
  }

  todasListas(): boolean {
    const fs = this.filas();
    return fs.length > 0 && fs.every((f) => f.local && f.visitante) && this.sucios().size === 0;
  }

  /** Cuántas llaves están completas y ya guardadas (sin cambios pendientes). */
  completas(): number {
    return this.filas().filter(
      (f) => f.local && f.visitante && !this.sucios().has(f.id),
    ).length;
  }

  private equipoPorNombre(nombre: string): EquipoBracket | null {
    return (this.bracket().equipos ?? []).find((e) => e.nombre === nombre) ?? null;
  }

  async guardar(filaRef: { id: string; local: string; visitante: string }): Promise<void> {
    // Tomamos la versión más reciente de la fila desde el signal.
    const fila = this.filas().find((f) => f.id === filaRef.id) ?? filaRef;
    if (!fila.local || !fila.visitante) return;
    this.guardando.set(true);
    try {
      await this.service.asignarLlave(
        this.bracket().id,
        fila.id,
        this.equipoPorNombre(fila.local),
        this.equipoPorNombre(fila.visitante),
      );
      const s = new Set(this.sucios());
      s.delete(fila.id);
      this.sucios.set(s);
      this.toast.exito('Llave guardada.');
    } catch (e: unknown) {
      this.toast.error((e as Error)?.message ?? 'No se pudo guardar la llave.');
    } finally {
      this.guardando.set(false);
    }
  }
}