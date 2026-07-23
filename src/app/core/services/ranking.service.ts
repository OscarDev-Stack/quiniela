import { Injectable, inject } from '@angular/core';
import { Auth, user } from '@angular/fire/auth';
import {
    Firestore,
    collection,
    collectionData,
    doc,
    docData,
    query,
    where,
    orderBy,
    limit,
    getCountFromServer,
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';

/** Cuántos jugadores se traen en la tabla. */
export const TOP_LIMITE = 50;

/** Documento público del ranking: sin correos ni datos personales. */
export interface RankingDoc {
    id: string;
    alias: string;
    /** Histórico acumulado (el que compite en la tabla). */
    puntos: number;
    /** Saldo disponible actual. */
    saldo?: number;
    /** Torneos de supervivencia ganados. */
    torneosGanados?: number;
    aciertos: number;
    resueltos: number;
    porcentaje: number;
    calificado?: boolean;
    racha?: number;
    mejorRacha?: number;
}

export interface FilaRanking extends RankingDoc {
    posicion: number;
}

@Injectable({ providedIn: 'root' })
export class RankingService {
    private readonly db = inject(Firestore);
    private readonly auth = inject(Auth);

    /** Top por puntos. Solo trae los primeros, no toda la colección. */
    topPuntos(): Observable<RankingDoc[]> {
        const q = query(
            collection(this.db, 'ranking'),
            orderBy('puntos', 'desc'),
            limit(TOP_LIMITE),
        );
        return collectionData(q, { idField: 'id' }) as Observable<RankingDoc[]>;
    }

    /** Top por porcentaje, solo entre quienes califican. */
    topPorcentaje(): Observable<RankingDoc[]> {
        const q = query(
            collection(this.db, 'ranking'),
            where('calificado', '==', true),
            orderBy('porcentaje', 'desc'),
            orderBy('resueltos', 'desc'),
            limit(TOP_LIMITE),
        );
        return collectionData(q, { idField: 'id' }) as Observable<RankingDoc[]>;
    }

    /** Fila de cualquier jugador: sirve para perfiles públicos. */
    fila(uid: string): Observable<RankingDoc | null> {
        return docData(doc(this.db, 'ranking', uid), { idField: 'id' }).pipe(
            switchMap((d) => of((d as RankingDoc) ?? null)),
            catchError(() => of(null)),
        );
    }

    /** Mi propia fila: una sola lectura. */
    miFila(): Observable<RankingDoc | null> {
        return user(this.auth).pipe(
            switchMap((u) => {
                if (!u) return of(null);
                return docData(doc(this.db, 'ranking', u.uid), { idField: 'id' }).pipe(
                    switchMap((d) => of((d as RankingDoc) ?? null)),
                    catchError(() => of(null)),
                );
            }),
        );
    }

    /**
     * Cuenta cuántos jugadores están por encima. El servidor devuelve
     * solo el número, sin traer los documentos.
     */
    async miPosicionPorPuntos(puntos: number): Promise<number> {
        const q = query(collection(this.db, 'ranking'), where('puntos', '>', puntos));
        const snap = await getCountFromServer(q);
        return snap.data().count + 1;
    }

    async miPosicionPorPorcentaje(porcentaje: number): Promise<number> {
        const q = query(
            collection(this.db, 'ranking'),
            where('calificado', '==', true),
            where('porcentaje', '>', porcentaje),
        );
        const snap = await getCountFromServer(q);
        return snap.data().count + 1;
    }
}