import { Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, take } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConfirmarDialogComponent } from './shared/confirmar-dialog.component';
import { NovedadesComponent } from './shared/novedades.component';
import { ToastsComponent } from './shared/toasts.component';
import { NovedadesService } from './shared/novedades.service';

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

  /** Hay una versión nueva descargada y lista para usarse. */
  readonly hayActualizacion = signal(false);

  constructor() {
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