import {
  ApplicationConfig,
  LOCALE_ID,
  isDevMode,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEsMx from '@angular/common/locales/es-MX';
import { provideRouter, withNavigationErrorHandler } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { puedeRecargarSinCiclar, CLAVE_OVERLAY_ACTUALIZANDO } from './shared/recarga.util';

import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import {
  provideAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
} from '@angular/fire/auth';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { provideFunctions, getFunctions } from '@angular/fire/functions';
import { provideMessaging, getMessaging } from '@angular/fire/messaging';
import { provideAnalytics, getAnalytics, ScreenTrackingService, UserTrackingService } from '@angular/fire/analytics';

import { routes } from './app.routes';
import { environment } from '../environments/environment';

// Fechas, números y monedas en español de México.
registerLocaleData(localeEsMx, 'es-MX');

/**
 * Devuelve la config de Firebase con el `authDomain` ajustado al dominio real
 * desde el que corre la app, si ese dominio es un hosting de Firebase. Esto
 * hace que el login con Google sea first-party (mismo dominio) y funcione en
 * la PWA instalada de iOS/Safari. Ver comentario en `provideFirebaseApp`.
 */
function resolverConfigFirebase() {
  const base = environment.firebase;
  try {
    const host = window.location.hostname;
    // Solo confiamos en dominios de Firebase Hosting del propio proyecto.
    const esHostingFirebase = host.endsWith('.web.app') || host.endsWith('.firebaseapp.com');
    if (esHostingFirebase && host !== base.authDomain) {
      return { ...base, authDomain: host };
    }
  } catch {
    // Sin window (SSR/prerender) o cualquier fallo: usamos el authDomain base.
  }
  return base;
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: LOCALE_ID, useValue: 'es-MX' },
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      /**
       * Red de seguridad para el fallo más común tras un deploy: el navegador
       * tiene un index.html viejo (en caché o en memoria) que apunta a chunks
       * lazy con hashes que Firebase ya borró. Al navegar a una ruta lazy,
       * Angular intenta bajar ese chunk y falla con "Failed to fetch
       * dynamically imported module". Ese error gana la carrera contra la
       * detección de versión (SwUpdate / version.json), así que aquí lo
       * atrapamos directamente y recargamos: la recarga trae el index.html
       * nuevo con los hashes correctos.
       *
       * Pasa por la MISMA guarda anti-bucle global que el resto de recargas
       * automáticas, por si el CDN de Firebase aún está propagando y el HTML
       * nuevo tampoco está listo (evita recargar en círculos). Y deja una marca
       * para que, tras recargar, el componente App muestre el overlay
       * "Actualizando" en vez de un salto seco.
       */
      withNavigationErrorHandler((event) => {
        const err = (event as { error?: unknown }).error;
        const msg = String((err as { message?: string })?.message ?? err ?? '');
        const esFalloDeChunk =
          msg.includes('Failed to fetch dynamically imported module') ||
          msg.includes('error loading dynamically imported module') ||
          msg.includes('Importing a module script failed');

        if (esFalloDeChunk && puedeRecargarSinCiclar()) {
          try {
            sessionStorage.setItem(CLAVE_OVERLAY_ACTUALIZANDO, '1');
          } catch {
            // Sin storage: recargamos igual, solo que sin overlay.
          }
          location.reload();
        }
      }),
    ),

    /**
     * Inicializa Firebase usando como `authDomain` el MISMO dominio desde el
     * que se abrió la app, cuando ese dominio es un hosting de Firebase
     * (*.web.app / *.firebaseapp.com). Motivo: el login con Google en la PWA
     * instalada de iOS/Safari falla si el `authDomain` es cross-domain
     * (el storage particionado de WebKit pierde el estado entre ida y vuelta).
     * Al forzar el authDomain al propio dominio de hosting, el flujo queda
     * first-party y funciona. Firebase Hosting sirve /__/auth/ en ambos
     * dominios, así que cualquiera de los dos es válido.
     *
     * En local o en un dominio no reconocido, se conserva el authDomain del
     * environment.
     */
    provideFirebaseApp(() => initializeApp(resolverConfigFirebase())),

    /**
     * Lista de almacenamientos en orden de preferencia.
     * En modo incógnito IndexedDB suele estar bloqueado, así que
     * Firebase baja al siguiente disponible en vez de fallar.
     */
    provideAuth(() =>
      initializeAuth(getApp(), {
        persistence: [
          indexedDBLocalPersistence,
          browserLocalPersistence,
          browserSessionPersistence,
          inMemoryPersistence,
        ],
        popupRedirectResolver: browserPopupRedirectResolver,
      }),
    ),

    provideFirestore(() => getFirestore()),
    provideFunctions(() => getFunctions()),
    provideMessaging(() => getMessaging()),
    provideAnalytics(() => getAnalytics()),
    ScreenTrackingService,
    UserTrackingService,

    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};