import { Component, inject, signal } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { NavComponent } from '../../shared/nav.component';

/**
 * Contenedor de las vistas de administración. Ya no usa tabs: cada sección
 * se abre por separado desde el menú de tres puntos (⋮) de la barra superior.
 * El título de la barra refleja la sección activa.
 */
@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [RouterOutlet, NavComponent],
  template: `
    <div class="admin screen">
      <app-nav [minimal]="true" [title]="titulo()" />
      <router-outlet />
    </div>
  `,
  styles: [
    `
      .admin { max-width: 460px; }
    `,
  ],
})
export class AdminLayoutComponent {
  private readonly router = inject(Router);
  readonly titulo = signal('Administración');

  private readonly nombres: Record<string, string> = {
    partidos: 'Partidos',
    usuarios: 'Usuarios',
    torneos: 'Torneos',
    crear: 'Crear',
    competiciones: 'Ligas',
    brackets: 'Eliminatorias',
  };

  constructor() {
    // El título sigue a la sección activa (última parte de la URL).
    this.actualizarTitulo(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.actualizarTitulo(e.urlAfterRedirects));
  }

  private actualizarTitulo(url: string): void {
    const seg = url.split('?')[0].split('/').filter(Boolean).pop() ?? '';
    this.titulo.set(this.nombres[seg] ?? 'Administración');
  }
}