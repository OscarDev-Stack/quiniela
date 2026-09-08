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
import { ActualizacionService } from './shared/actualizacion.service';
import { limpiarInvitacion } from './shared/invitacion.util';
import {
  puedeRecargarSinCiclar as puedeRecargarSinCiclarHelper,
  CLAVE_OVERLAY_ACTUALIZANDO,
} from './shared/recarga.util';
import { UserService } from './core/services/user.service';
import { StatsService } from './shared/stats.service';
import { APP_VERSION } from './core/version';

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
  private readonly actualizacion = inject(ActualizacionService);
  private readonly novedades = inject(NovedadesService);
  private readonly router = inject(Router);
  private readonly users = inject(UserService);
  private readonly stats = inject(StatsService);

  /** Hay una versión nueva descargada y lista para usarse. */
  readonly hayActualizacion = signal(false);

  /** Estamos aplicando la versión nueva: mostramos el overlay "Actualizando". */
  readonly actualizando = signal(false);

  constructor() {
    // "Sello de arranque": marcamos en localStorage la versión que REALMENTE
    // está corriendo (APP_VERSION del bundle). El auto-reparador inline de
    // index.html lee esta marca para decidir si una recarga logró promover el
    // bundle nuevo o si el SW sigue atorado sirviendo el viejo. Solo aquí, ya
    // dentro de Angular, sabemos con certeza qué versión arrancó; por eso la
    // escribe el bundle y no el script inline (que lo haría de forma optimista
    // y rompería la detección de "recargó pero no cambió"). Es defensivo:
    // cualquier fallo de storage se ignora.
    try {
      localStorage.setItem('appVersionArrancada', APP_VERSION);
    } catch {
      // Sin storage confiable (modo privado, etc.): no pasa nada, el
      // auto-reparador simplemente no intervendrá.
    }

    // Si esta carga viene de recuperarnos de un chunk lazy que ya no existía
    // (index.html viejo tras un deploy), el manejador del router dejó esta
    // marca antes de recargar. Mostramos el overlay "Actualizando" un instante
    // para que el usuario entienda qué pasó, en vez de un salto seco. La marca
    // se consume (se borra) para que no reaparezca en cargas posteriores.
    try {
      if (sessionStorage.getItem(CLAVE_OVERLAY_ACTUALIZANDO)) {
        sessionStorage.removeItem(CLAVE_OVERLAY_ACTUALIZANDO);
        this.hayActualizacion.set(true);
        this.actualizando.set(true);
        setTimeout(() => this.actualizando.set(false), App.OVERLAY_MIN_MS);
      }
    } catch {
      // Sin storage: no mostramos overlay, la app ya cargó bien de todos modos.
    }

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
    //
    // TODO (limpieza técnica): esta reparación se introdujo el 2026-09-05.
    // Cuando haya pasado suficiente tiempo para que casi ningún dispositivo
    // conserve el registro huérfano (revisar ~después de 2026-11), este método
    // se puede eliminar por completo.
    this.limpiarSwMessagingEnRaiz();

    // Arranca la única maquinaria de detección de actualizaciones (SwUpdate +
    // version.json), toda enrutada al mismo punto de recarga.
    this.iniciarDeteccionDeActualizaciones();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Detección de actualizaciones (Capa A: dentro del bundle)
  //
  // Dos fuentes de señal, UN solo destino:
  //   1. SwUpdate      → mecanismo nativo de Angular (funciona en el 95% de
  //                      navegadores por sí solo).
  //   2. /version.json → respaldo independiente del SW, imprescindible en iOS
  //                      PWA en standalone, donde SwUpdate a veces no detecta
  //                      nada y el bfcache restaura la app sin re-arrancar.
  //
  // Ambas encienden el banner (hayActualizacion) y llaman a la MISMA función
  // recargarPorActualizacion(), que centraliza overlay, activación del SW,
  // recarga y guarda anti-bucle. Antes cada señal tenía su propia ruta de
  // recarga y su propia clave anti-bucle; eso era la fuente de los ciclos.
  // ─────────────────────────────────────────────────────────────────────────
  private iniciarDeteccionDeActualizaciones(): void {
    const destroyRef = inject(DestroyRef);

    // Un único "revisar todo": pregunta al SW y a version.json. Solo corre con
    // la pestaña visible (evita trabajo en segundo plano y checks inútiles).
    const revisar = () => {
      if (document.visibilityState !== 'visible') return;

      // version.json: respaldo que no depende del SW.
      this.actualizacion.revisar().then(() => {
        if (this.actualizacion.hayNueva()) {
          this.hayActualizacion.set(true);
          this.recargarPorActualizacion('version-json');
        }
      });

      // SwUpdate: mecanismo nativo. checkForUpdate dispara VERSION_READY si hay
      // algo nuevo (ver suscripción abajo).
      if (this.updates.isEnabled) {
        this.updates.checkForUpdate().catch(() => undefined);
      }
    };

    // VERSION_READY: Angular ya descargó la versión nueva en segundo plano.
    // Encendemos el banner (respaldo visible) y recargamos solos.
    if (this.updates.isEnabled) {
      this.updates.versionUpdates
        .pipe(
          filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'),
          takeUntilDestroyed(destroyRef),
        )
        .subscribe(() => {
          this.hayActualizacion.set(true);
          this.recargarPorActualizacion('sw-version-ready');
        });

      // Estado irrecuperable (cache del SW corrupta, frecuente en iOS): la
      // única salida es recargar para que el navegador reinstale el SW.
      this.updates.unrecoverable
        .pipe(
          filter((e): e is UnrecoverableStateEvent => !!e),
          takeUntilDestroyed(destroyRef),
        )
        .subscribe(() => this.recargarPorActualizacion('sw-unrecoverable'));
    }

    // Momentos en que volvemos a revisar: al abrir, al recuperar el foco y de
    // forma periódica. En iOS standalone el foco no siempre dispara
    // visibilitychange; pageshow con persisted=true es el único evento fiable
    // cuando la PWA se restaura desde el bfcache.
    revisar();
    const alRestaurar = (e: PageTransitionEvent) => {
      if (e.persisted) revisar();
    };
    document.addEventListener('visibilitychange', revisar);
    window.addEventListener('pageshow', alRestaurar);
    const intervalo = setInterval(revisar, 30 * 60 * 1000);

    destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', revisar);
      window.removeEventListener('pageshow', alRestaurar);
      clearInterval(intervalo);
    });
  }

  /** Activa la versión nueva y reinicia la app (invocado desde el banner). */
  recargar(): void {
    // El botón manual del banner es una acción explícita del usuario, así que
    // se salta la guarda anti-bucle: si lo tocó, quiere recargar ya.
    this.recargarConOverlay();
  }

  /** Duración mínima del overlay "Actualizando" para que no sea un parpadeo. */
  private static readonly OVERLAY_MIN_MS = 800;

  /**
   * ÚNICO punto de recarga automática. Cualquier señal (VERSION_READY,
   * version.json, estado irrecuperable) pasa por aquí. Consulta la guarda
   * anti-bucle una sola vez y, si autoriza, muestra el overlay y recarga.
   *
   * El `motivo` solo sirve para trazabilidad/depuración; la decisión de
   * recargar es la misma para todos, con un único tope global de recargas.
   */
  private recargarPorActualizacion(motivo: string): void {
    if (!this.puedeRecargarSinCiclar()) return;
    void motivo; // Reservado para logging futuro; no afecta la decisión.
    this.recargarConOverlay();
  }

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

    // Antes de activar, forzamos un checkForUpdate(): si la versión nueva la
    // detectó /version.json pero el SW todavía no la había descargado (caso
    // típico en iOS), este check la baja para que activateUpdate() tenga algo
    // real que aplicar. Si el SW está deshabilitado o falla, recargamos igual:
    // una recarga limpia suele bastar para que el navegador re-traiga assets.
    const activarYRecargar = () =>
      this.updates.activateUpdate().then(recargarTrasMinimo).catch(recargarTrasMinimo);

    if (this.updates.isEnabled) {
      this.updates.checkForUpdate().then(activarYRecargar).catch(activarYRecargar);
    } else {
      recargarTrasMinimo();
    }
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
        // que el usuario cierre todas las pestañas). Pasa por el mismo punto
        // de recarga y la misma guarda anti-bucle que el resto.
        if (desregistrado) {
          this.recargarPorActualizacion('sw-messaging-limpiado');
        }
      })
      .catch(() => undefined);
  }

  /**
   * Guarda anti-bucle ÚNICA para toda recarga automática. Delega en el helper
   * compartido (shared/recarga.util) para que ESTE componente y el manejador
   * de fallo de chunks del router usen el MISMO contador global. Ver ese
   * archivo para el detalle de la ventana y el tope de recargas.
   */
  private puedeRecargarSinCiclar(): boolean {
    return puedeRecargarSinCiclarHelper();
  }
}
