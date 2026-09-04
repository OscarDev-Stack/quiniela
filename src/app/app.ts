import { Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { combineLatest } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConfirmarDialogComponent } from './shared/confirmar-dialog.component';
import { NovedadesComponent } from './shared/novedades.component';
import { ToastsComponent } from './shared/toasts.component';
import { NovedadesService } from './shared/novedades.service';
import { limpiarInvitacion } from './shared/invitacion.util';
import { UserService } from './core/services/user.service';
import { StatsService } from './shared/stats.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ConfirmarDialogComponent, NovedadesComponent, ToastsComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = signal('quiniela');

  private readonly updates = inject(SwUpdate);
  private readonly novedades = inject(NovedadesService);
  private readonly router = inject(Router);
  private readonly users = inject(UserService);
  private readonly stats = inject(StatsService);

  /** Hay una versión nueva descargada y lista para usarse. */
  readonly hayActualizacion = signal(false);

  constructor() {
    // Propiedades categóricas del usuario para segmentar Analytics (sin PII):
    // rol (super admin / admin de grupo / jugador) y si está validado. Se
    // actualizan solas cuando cambia la sesión o el documento del usuario.
    combineLatest([this.users.me$, this.users.isAdmin$])
      .pipe(takeUntilDestroyed())
      .subscribe(([me, esSuperAdmin]) => {
        if (!me) return;
        const rol = esSuperAdmin ? 'super_admin' : me.esAdminGrupo ? 'admin_grupo' : 'jugador';
        this.stats.propiedades({ rol, validado: me.validada ? 'si' : 'no' });
      });

    // Limpieza defensiva: una invitación pendiente en localStorage solo tiene
    // sentido en el flujo "sin sesión → login → retomar /unirse". Al resolver
    // la primera navegación, si NO aterrizamos en una pantalla de invitación
    // (ni login/registro), cualquier código guardado es residuo y se borra; si
    // no, reenviaba a "unirse" en cada login o al abrir una pestaña nueva.
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        take(1),
        takeUntilDestroyed(),
      )
      .subscribe((e) => {
        const url = e.urlAfterRedirects;
        // /unirse cubre /unirse, /unirse-grupo y /unirse-elim.
        const enFlujoInvitacion =
          url.startsWith('/unirse') || url.startsWith('/login') || url.startsWith('/registro');
        if (!enFlujoInvitacion) {
          limpiarInvitacion();
        }
      });

    // Las novedades NO deben aparecer sobre el portón de acceso (Turnstile).
    // Esperamos a la primera navegación que salga de /acceso (login o dentro)
    // y ahí sí revisamos si hay novedades que mostrar.
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        filter((e) => !e.urlAfterRedirects.startsWith('/acceso')),
        take(1),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.novedades.revisarAlEntrar());

    if (!this.updates.isEnabled) return;

    const sub = this.updates.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => this.hayActualizacion.set(true));

    // Busca actualizaciones al abrir y cada vez que se vuelve a la app.
    const buscar = () => {
      if (document.visibilityState === 'visible') {
        this.updates.checkForUpdate().catch(() => undefined);
      }
    };
    buscar();
    document.addEventListener('visibilitychange', buscar);

    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      document.removeEventListener('visibilitychange', buscar);
    });
  }

  /** Activa la versión nueva y reinicia la app. */
  recargar(): void {
    this.updates.activateUpdate().then(() => location.reload());
  }
}