import { Injectable, inject } from '@angular/core';
import { Auth, user } from '@angular/fire/auth';
import {
    Firestore,
    doc,
    docData,
    collection,
    collectionData,
    query,
    where,
} from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { switchMap, map, catchError, shareReplay } from 'rxjs/operators';
import { AppUser } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class UserService {
    private readonly auth = inject(Auth);
    private readonly db = inject(Firestore);

    /** Documento del usuario con sesión iniciada (o null). */
    readonly me$: Observable<AppUser | null> = user(this.auth).pipe(
        switchMap((u) => {
            if (!u) return of(null);
            return docData(doc(this.db, 'users', u.uid), { idField: 'id' }).pipe(
                map((d) => (d as AppUser) ?? null),
                catchError(() => of(null)),
            );
        }),
        // Una sola consulta compartida entre todos los componentes.
        shareReplay({ bufferSize: 1, refCount: false }),
    );

    /** True si el usuario tiene documento en la colección `admins`. */
    readonly isAdmin$: Observable<boolean> = user(this.auth).pipe(
        switchMap((u) => {
            if (!u) return of(false);
            return docData(doc(this.db, 'admins', u.uid)).pipe(
                map((d) => !!d),
                catchError(() => of(false)),
            );
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
    );

    /** Competiciones donde el usuario es gestor de liga. */
    readonly misLigas$: Observable<Array<{ id: string; nombre: string }>> = user(this.auth).pipe(
        switchMap((u) => {
            if (!u) return of([] as Array<{ id: string; nombre: string }>);
            const q = query(
                collection(this.db, 'competiciones'),
                where('gestores', 'array-contains', u.uid),
            );
            return (
                collectionData(q, { idField: 'id' }) as Observable<Array<{ id: string; nombre: string }>>
            ).pipe(catchError(() => of([])));
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
    );

    /** True si el usuario gestiona al menos una liga (aunque no sea admin global). */
    readonly esGestor$: Observable<boolean> = this.misLigas$.pipe(map((ligas) => ligas.length > 0));
}