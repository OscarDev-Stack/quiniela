import { Component, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EscudoComponent } from './escudo.component';
import { EQUIPOS_LIGA_MX } from '../core/models/equipos-liga-mx';

/**
 * Selector visual de equipos: muestra los escudos del catálogo en una
 * cuadrícula. Al tocar uno, emite el nombre oficial del equipo. Garantiza
 * que el nombre guardado coincida con el catálogo (y por tanto tenga su
 * escudo), sin depender de que se escriba bien a mano.
 *
 * Uso:
 *   <app-selector-equipo (elegido)="ponerLocal($event)" />
 */
@Component({
    selector: 'app-selector-equipo',
    standalone: true,
    imports: [CommonModule, EscudoComponent],
    template: `
    <div class="selector">
      <input
        class="buscar"
        type="text"
        placeholder="Buscar equipo…"
        [value]="filtro()"
        (input)="filtro.set($any($event.target).value)"
      />

      @for (grupo of gruposVisibles(); track grupo.liga) {
        <div class="grupo">
          <div class="grupo-tit">{{ grupo.liga }} <span class="cuenta">{{ grupo.equipos.length }}</span></div>
          <div class="grid">
            @for (eq of grupo.equipos; track eq.nombre) {
              <button type="button" class="opcion" (click)="elegir(eq.nombre)">
                <app-escudo [equipo]="eq.nombre" [size]="34" />
                <span class="nom">{{ eq.nombre }}</span>
              </button>
            }
          </div>
        </div>
      }
      @if (gruposVisibles().length === 0) {
        <p class="sin">Ningún equipo coincide.</p>
      }
    </div>
  `,
    styles: [
        `
      .selector { display: flex; flex-direction: column; gap: 10px; }
      .grupo { display: flex; flex-direction: column; gap: 8px; }
      .grupo-tit {
        display: flex; align-items: center; gap: 8px;
        font-size: 12px; font-weight: 700; color: var(--text-secondary);
        text-transform: uppercase; letter-spacing: 0.03em;
      }
      .grupo-tit .cuenta {
        font-size: 11px; background: var(--surface-1); color: var(--text-muted);
        padding: 1px 7px; border-radius: 999px; letter-spacing: 0;
      }
      .buscar {
        width: 100%; padding: 9px 11px; font-size: 14px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-1); color: var(--text-primary);
      }
      .grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
        gap: 8px;
      }
      .opcion {
        display: flex; flex-direction: column; align-items: center; gap: 6px;
        padding: 10px 6px; cursor: pointer;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface-1); color: var(--text-primary);
      }
      .opcion:hover { border-color: var(--accent-fill); background: var(--accent-bg); }
      .opcion .nom {
        font-size: 11px; font-weight: 600; text-align: center; line-height: 1.2;
      }
      .sin { grid-column: 1 / -1; text-align: center; color: var(--text-muted); font-size: 13px; padding: 16px; }
    `,
    ],
})
export class SelectorEquipoComponent {
    /** Emite el nombre oficial del equipo elegido. */
    readonly elegido = output<string>();

    readonly filtro = signal('');

    readonly equipos = EQUIPOS_LIGA_MX;

    /** Equipos filtrados por el buscador, agrupados por liga. */
    gruposVisibles(): Array<{ liga: string; equipos: typeof EQUIPOS_LIGA_MX }> {
        const f = this.filtro().trim().toLowerCase();
        const lista = f
            ? this.equipos.filter((eq) => eq.nombre.toLowerCase().includes(f))
            : this.equipos;

        const porLiga = new Map<string, typeof EQUIPOS_LIGA_MX>();
        for (const eq of lista) {
            if (!porLiga.has(eq.liga)) porLiga.set(eq.liga, []);
            porLiga.get(eq.liga)!.push(eq);
        }
        return [...porLiga.entries()].map(([liga, equipos]) => ({ liga, equipos }));
    }

    elegir(nombre: string): void {
        this.elegido.emit(nombre);
        this.filtro.set('');
    }
}