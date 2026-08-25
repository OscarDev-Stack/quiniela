import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { NavComponent } from '../../shared/nav.component';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NavComponent],
  template: `
    <div class="admin screen">
      <app-nav title="Administración" />
      <header class="admin-top">
        <nav class="admin-nav">
          <a routerLink="partidos" routerLinkActive="active">Partidos</a>
          <a routerLink="usuarios" routerLinkActive="active">Usuarios</a>
          <a routerLink="torneos" routerLinkActive="active">Torneos</a>
          <a routerLink="competiciones" routerLinkActive="active">Ligas</a>
          <a routerLink="brackets" routerLinkActive="active">Eliminatorias</a>
        </nav>
      </header>
      <router-outlet />
    </div>
  `,
  styles: [
    `
      .admin { max-width: 780px; }
      .admin-top {
        display: flex; align-items: center; justify-content: space-between;
        flex-wrap: wrap; gap: 12px; margin-bottom: 20px;
      }
      .admin-title { font-size: 18px; font-weight: 600; }
      .admin-nav { display: flex; gap: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .admin-nav a { white-space: nowrap; }
      .admin-nav a {
        font-size: 14px; text-decoration: none; color: var(--text-secondary);
        padding: 6px 14px; border-radius: 999px; border: 1px solid var(--border);
      }
      @media (max-width: 620px) {
        .admin-top { margin-bottom: 14px; }
        .admin-nav { width: 100%; }
        .admin-nav a { flex: 1; text-align: center; }
      }
      .admin-nav a.active {
        background: var(--text-primary); color: var(--surface-2);
        border-color: var(--text-primary);
      }
    `,
  ],
})
export class AdminLayoutComponent { }