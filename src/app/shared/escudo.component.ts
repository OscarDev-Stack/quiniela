import { Component, computed, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { escudoDe } from '../core/models/equipos-liga-mx';

/**
 * Muestra el escudo de un equipo por su nombre. Si el equipo no está en
 * el catálogo (o falta el archivo), muestra un círculo con su inicial,
 * para que nunca quede un hueco roto.
 *
 * Uso: <app-escudo [equipo]="m.homeTeam" />
 *      <app-escudo [equipo]="m.awayTeam" size="28" />
 */
@Component({
  selector: 'app-escudo',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (src(); as s) {
      <img
        class="escudo"
        [src]="s"
        [alt]="equipo()"
        [style.width.px]="size()"
        [style.height.px]="size()"
        (error)="falla()"
      />
    } @else {
      <span
        class="inicial"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [style.fontSize.px]="size() * 0.42"
        >{{ inicial() }}</span
      >
    }
  `,
  styles: [
    `
      .escudo {
        object-fit: contain;
        vertical-align: middle;
        flex-shrink: 0;
      }
      .inicial {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: var(--surface-1);
        color: var(--text-secondary);
        font-weight: 700;
        flex-shrink: 0;
        vertical-align: middle;
      }
    `,
  ],
})
export class EscudoComponent {
  /** Nombre del equipo (se busca en el catálogo). */
  readonly equipo = input('');
  /** Tamaño en píxeles (ancho y alto). */
  readonly size = input(24);

  /** Se enciende si la imagen no carga, para caer a la inicial. */
  private readonly fallado = signal(false);

  readonly src = computed(() => (this.fallado() ? null : escudoDe(this.equipo())));

  inicial(): string {
    return (this.equipo().trim()[0] ?? '?').toUpperCase();
  }

  falla(): void {
    this.fallado.set(true);
  }
}