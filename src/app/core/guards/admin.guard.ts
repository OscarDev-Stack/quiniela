import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth, user } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { from, of } from 'rxjs';
import { switchMap, map, take, catchError } from 'rxjs/operators';

/**
 * Permite el acceso solo si el usuario tiene un documento en la
 * colección `admins` con su UID. Si no, lo manda a /partidos.
 */
export const adminGuard: CanActivateFn = () => {
    const auth = inject(Auth);
    const db = inject(Firestore);
    const router = inject(Router);

    return user(auth).pipe(
        take(1),
        switchMap((u) => {
            if (!u) return of(router.createUrlTree(['/login']));
            return from(getDoc(doc(db, 'admins', u.uid))).pipe(
                map((snap) => (snap.exists() ? true : router.createUrlTree(['/partidos']))),
                catchError(() => of(router.createUrlTree(['/partidos']))),
            );
        }),
    );
};