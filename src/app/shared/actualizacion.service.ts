import { Injectable, signal } from '@angular/core';
import { APP_VERSION } from '../core/version';

/**
 * Detecta si el servidor ya tiene una versión más nueva que la que corre en
 * este dispositivo, SIN depender del Service Worker.
 *
 * El porqué: `APP_VERSION` viaja dentro del bundle, así que la app instalada
 * solo conoce la versión con la que se compiló. Para saber la versión REAL del
 * servidor había que esperar a que el SW descargara el bundle nuevo, y en iOS
 * (PWA en standalone) el SW se queda atorado y el usuario nunca se entera.
 *
 * Aquí leemos `/version.json` directo con fetch y `cache: 'no-store'`. Ese
 * archivo se sirve fuera del bundle y con cabecera no-store (ver firebase.json),
 * así que siempre trae el número real del servidor. Si difiere del local, hay
 * actualización disponible y se puede avisar al usuario aunque el SW falle.
 *
 * El JSON se autogenera en el build desde APP_VERSION (ver scripts/generar-sw.js),
 * por lo que local y servidor comparan el mismo formato "MAYOR.MENOR.PARCHE".
 */
@Injectable({ providedIn: 'root' })
export class ActualizacionService {
    /** true cuando /version.json reporta una versión distinta a la local. */
    private readonly _hayNueva = signal(false);
    readonly hayNueva = this._hayNueva.asReadonly();

    /**
     * Consulta /version.json y actualiza `hayNueva`. Es defensivo: cualquier
     * fallo de red se ignora (dejamos el estado como estaba) para no molestar
     * al usuario por un check fallido. Una vez detectada una versión nueva, no
     * la "desmarcamos": lo lógico es que el usuario recargue para tomarla.
     */
    async revisar(): Promise<void> {
        if (this._hayNueva()) return; // Ya avisamos: no hace falta seguir consultando.
        try {
            const resp = await fetch('/version.json', { cache: 'no-store' });
            if (!resp.ok) return;
            const datos = (await resp.json()) as { version?: string };
            const remota = (datos.version ?? '').trim();
            if (remota && remota !== APP_VERSION) {
                this._hayNueva.set(true);
            }
        } catch {
            // Sin red o respuesta inválida: no cambiamos el estado.
        }
    }
}
