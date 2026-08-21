import { Injectable, inject } from '@angular/core';
import { Analytics, logEvent } from '@angular/fire/analytics';

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
}