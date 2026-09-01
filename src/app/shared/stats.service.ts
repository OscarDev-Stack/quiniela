import { Injectable, inject } from '@angular/core';
import { Analytics, logEvent, setUserProperties } from '@angular/fire/analytics';

/**
 * Registra eventos de uso en Firebase Analytics. Los datos son agregados
 * y anónimos: sirven para ver CUÁNTA gente hace qué (cuántos pronósticos,
 * cuántos torneos creados, etc.), no para rastrear a personas concretas.
 *
 * Uso: this.stats.evento('pronostico_hecho', { tipo: 'quiniela' });
 *
 * Está envuelto en try/catch porque Analytics puede no estar disponible
 * (bloqueadores, modo incógnito, sin measurementId configurado) y nunca
 * debe tumbar la app por un evento de medición.
 */
@Injectable({ providedIn: 'root' })
export class StatsService {
    private readonly analytics = inject(Analytics);

    /** Registra un evento de uso. Ignora cualquier fallo silenciosamente. */
    evento(nombre: string, datos: Record<string, string | number | boolean> = {}): void {
        try {
            logEvent(this.analytics, nombre, datos);
        } catch {
            // Analytics no disponible: no pasa nada, seguimos.
        }
    }

    /**
     * Marca propiedades categóricas del usuario (rol, validado, etc.) para
     * poder segmentar los reportes de Analytics. NO se guarda PII (nada de
     * correos ni alias reales), solo categorías. Igual que evento(), ignora
     * cualquier fallo en silencio.
     *
     * Uso: this.stats.propiedades({ rol: 'jugador', validado: 'si' });
     */
    propiedades(props: Record<string, string>): void {
        try {
            setUserProperties(this.analytics, props);
        } catch {
            // Analytics no disponible: no pasa nada, seguimos.
        }
    }
}