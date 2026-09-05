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

    // Limpieza de un SW de messaging registrado por error en la raíz '/'
    // (versiones previas lo hacían). Ese registro compite con ngsw-worker.js
    // por el control de la página y rompe la detección de versiones. Lo
    // desregistramos si su scope es exactamente el origen '/', sin tocar el
    // registro de Angular ni el de messaging en su scope aislado.
    this.limpiarSwMessagingEnRaiz();

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

  /**
   * Desregistra el SW de messaging si quedó registrado en el scope raíz '/'
   * (bug de versiones anteriores). Ese registro le disputaba el control de la
   * página a ngsw-worker.js de Angular, dejando SwUpdate sin detectar
   * versiones. El SW de Angular y el de messaging en su scope propio no se
   * tocan. Es defensivo: cualquier fallo se ignora.
   */
  private limpiarSwMessagingEnRaiz(): void {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then(async (regs) => {
        let desregistrado = false;
        for (const r of regs) {
          const url = r.active?.scriptURL ?? r.installing?.scriptURL ?? r.waiting?.scriptURL ?? '';
          const scopeRaiz = r.scope === location.origin + '/';
          if (url.includes('firebase-messaging-sw.js') && scopeRaiz) {
            const ok = await r.unregister().catch(() => false);
            desregistrado = desregistrado || ok;
          }
        }

        // Si limpiamos un registro roto, recargamos UNA sola vez para que el
        // SW de Angular retome el control de inmediato (si no, tardaría hasta
        // que el usuario cierre todas las pestañas).
        //
        // Anti-bucle: solo recargamos si puedeRecargarSinCiclar() confirma que
        // logró dejar (y releer) una marca en sessionStorage. Si el storage no
        // es confiable, NO recargamos, para no arriesgar un ciclo.
        if (desregistrado && this.puedeRecargarSinCiclar()) {
          location.reload();
        }
      })
      .catch(() => undefined);
  }

  /**
   * Decide si es seguro recargar tras limpiar el SW roto, sin riesgo de bucle.
   * Devuelve true SOLO si logramos dejar la marca en sessionStorage (y no
   * estaba ya puesta). Si el storage falla o ya recargamos antes, devuelve
   * false: preferimos NO recargar (el usuario se recupera igual al reabrir)
   * antes que arriesgar un ciclo de recargas.
   */
  private puedeRecargarSinCiclar(): boolean {
    const YA = 'sw-messaging-limpiado';
    try {
      if (sessionStorage.getItem(YA)) return false;
      sessionStorage.setItem(YA, '1');
      // Verificamos que de verdad quedó escrito (algunos navegadores en modo
      // privado aceptan setItem pero no persisten).
      return sessionStorage.getItem(YA) === '1';
    } catch {
      // Sin storage confiable, no arriesgamos recarga automática.
      return false;
    }
  }
}