import { Injectable, inject } from '@angular/core';
import { Auth, user } from '@angular/fire/auth';
import { Firestore, collection, collectionData, query, where } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { Partido } from '../models/partido.model';
import { Pronostico, ResultadoPronostico } from '../models/pronostico.model';

/** Puntos que cuesta un pronóstico con multiplicador x1. */
export const APUESTA_BASE = 100;
/** Piso duro del marcador. */
export const TOPE_INFERIOR = -1000;
/** Multiplicador máximo permitido. */
export const MULTIPLICADOR_MAX = 5;

@Injectable({ providedIn: 'root' })
export class PronosticosService {
    private readonly db = inject(Firestore);
    private readonly auth = inject(Auth);
    private readonly fns = inject(Functions);

    /** Pronósticos del usuario con sesión iniciada. */
    misPronosticos(): Observable<Pronostico[]> {
        return user(this.auth).pipe(
            switchMap((u) => {
                if (!u) return of([] as Pronostico[]);
                const q = query(collection(this.db, 'pronosticos'), where('uid', '==', u.uid));
                return collectionData(q, { idField: 'id' }) as Observable<Pronostico[]>;
            }),
        );
    }

    /**
     * Coloca un pronóstico. Toda la validación y el descuento de puntos
     * ocurren en Cloud Functions: el cliente nunca escribe el saldo.
     */
    async crear(
        partido: Partido,
        resultado: ResultadoPronostico,
        multiplicador: number,
    ): Promise<void> {
        const fn = httpsCallable<
            { partidoId: string; resultado: string; multiplicador: number },
            { ok: boolean; apuesta: number }
        >(this.fns, 'crearPronostico');

        await fn({ partidoId: partido.id, resultado, multiplicador });
    }
}