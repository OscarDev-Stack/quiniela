import { Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { SwUpdate, VersionReadyEvent, UnrecoverableStateEvent } from '@angular/service-worker';
import { combineLatest } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConfirmarDialogComponent } from './shared/confirmar-dialog.component';
import { NovedadesComponent } from './shared/novedades.component';
import { ToastsComponent } from './shared/toasts.component';
import { CargandoComponent } from './shared/cargando.component';
import { NovedadesService } from './shared/novedades.service';
import { limpiarInvitacion } from './shared/invitacion.util';
import { UserService } from './core/services/user.service';
import { StatsService } from './shared/stats.service';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    ConfirmarDialogComponent,
    NovedadesComponent,
    ToastsComponent,
    CargandoComponent,
  ],
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

  /** Estamos aplicando la versión nueva: mostramos el overlay "Actualizando". */
  readonly actualizando = signal(false);

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

    // Cuando Angular termina de descargar la versión nueva en segundo plano
    // (VERSION_READY), la aplicamos y recargamos SOLOS, sin esperar a que el
    // usuario toque un botón. En iOS/Android con la PWA instalada casi nadie
    // ve (ni toca) el banner, así que se quedaban pegados en la versión vieja.
    //
    // El banner se mantiene como respaldo visible: si por lo que sea la recarga
    // automática no ocurre (storage no confiable, anti-bucle activo), el
    // usuario todavía puede forzarla a mano.
    const subVersion = this.updates.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => {
        this.hayActualizacion.set(true);
        this.aplicarActualizacion();
      });

    // Estado irrecuperable del SW (cache corrupta, frecuente en iOS): la única
    // salida es recargar para que el navegador reinstale el SW desde cero.
    const subUnrec = this.updates.unrecoverable
      .pipe(filter((e): e is UnrecoverableStateEvent => !!e))
      .subscribe(() => {
        if (this.puedeRecargarSinCiclar('sw-unrecoverable')) {
          location.reload();
        }
      });

    // Busca actualizaciones al abrir, al volver el foco a la app y de forma
    // periódica (cada 30 min). El check por foco no es confiable en iOS cuando
    // la PWA se congela en segundo plano; el intervalo cubre ese hueco.
    const buscar = () => {
      if (document.visibilityState === 'visible') {
        this.updates.checkForUpdate().catch(() => undefined);
      }
    };
    buscar();
    document.addEventListener('visibilitychange', buscar);

    // iOS en modo standalone restaura la PWA desde el bfcache: la página vuelve
    // tal cual estaba, sin re-ejecutar el arranque de Angular y sin disparar
    // visibilitychange. Con eso, ni el buscar() inicial ni el del foco llegan a
    // correr, y el dispositivo se queda pegado en la versión vieja aunque el
    // servidor ya tenga una nueva. El evento pageshow SÍ llega en esa
    // restauración, con persisted en true (en una carga normal viene en false),
    // así que es el único momento fiable para volver a preguntar por la versión.
    const alRestaurar = (e: PageTransitionEvent) => {
      if (e.persisted) buscar();
    };
    window.addEventListener('pageshow', alRestaurar);

    const intervalo = setInterval(buscar, 30 * 60 * 1000);

    inject(DestroyRef).onDestroy(() => {
      subVersion.unsubscribe();
      subUnrec.unsubscribe();
      document.removeEventListener('visibilitychange', buscar);
      window.removeEventListener('pageshow', alRestaurar);
      clearInterval(intervalo);
    });
  }

  /**
   * Aplica la versión nueva y recarga la app automáticamente. Usa el guardián
   * anti-bucle para no entrar en un ciclo de recargas si algo sale mal (p. ej.
   * el SW reporta VERSION_READY una y otra vez sin llegar a activarse).
   */
  private aplicarActualizacion(): void {
    if (!this.puedeRecargarSinCiclar('sw-version-aplicada')) return;
    this.recargarConOverlay();
  }

  /** Activa la versión nueva y reinicia la app (invocado desde el fallback). */
  recargar(): void {
    this.recargarConOverlay();
  }

  /** Duración mínima del overlay "Actualizando" para que no sea un parpadeo. */
  private static readonly OVERLAY_MIN_MS = 800;

  /**
   * Muestra el overlay "Actualizando", activa la versión nueva y recarga.
   * Garantiza que el overlay se vea al menos OVERLAY_MIN_MS aunque la
   * activación termine antes, para que la animación no aparezca y desaparezca
   * de golpe. Si algo falla, recarga igual (el SW se resuelve al reiniciar).
   */
  private recargarConOverlay(): void {
    if (this.actualizando()) return; // Ya en curso: no dispares dos veces.
    this.actualizando.set(true);

    const inicio = Date.now();
    const recargarTrasMinimo = () => {
      const restante = App.OVERLAY_MIN_MS - (Date.now() - inicio);
      setTimeout(() => location.reload(), Math.max(0, restante));
    };

    this.updates.activateUpdate().then(recargarTrasMinimo).catch(recargarTrasMinimo);
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
        if (desregistrado && this.puedeRecargarSinCiclar('sw-messaging-limpiado')) {
          location.reload();
        }
      })
      .catch(() => undefined);
  }

  /**
   * Decide si es seguro recargar sin riesgo de bucle, para la `clave` dada.
   * Devuelve true SOLO si no hubo otra recarga con esa clave en los últimos
   * VENTANA_MS. En vez de bloquear para siempre, guarda una marca de tiempo:
   * así una actualización legítima más tarde en la misma sesión sí puede
   * recargar, pero dos recargas seguidas (síntoma de bucle) se cortan.
   *
   * Si el storage no es confiable (modo privado, etc.), devuelve false:
   * preferimos NO recargar automáticamente antes que arriesgar un ciclo. El
   * usuario se recupera igual con el banner manual o al reabrir la app.
   */
  private puedeRecargarSinCiclar(clave: string): boolean {
    const VENTANA_MS = 60 * 1000; // 1 minuto de guarda entre recargas por clave.
    const ahora = Date.now();
    try {
      const previo = Number(sessionStorage.getItem(clave));
      if (previo && ahora - previo < VENTANA_MS) return false;
      sessionStorage.setItem(clave, String(ahora));
      // Confirmamos que de verdad quedó escrito (algunos navegadores en modo
      // privado aceptan setItem pero no persisten).
      return sessionStorage.getItem(clave) === String(ahora);
    } catch {
      // Sin storage confiable, no arriesgamos recarga automática.
      return false;
    }
  }
}
