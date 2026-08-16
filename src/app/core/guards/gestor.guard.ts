import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth, user } from '@angular/fire/auth';
import {
  Firestore,
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from '@angular/fire/firestore';
import { from, of } from 'rxjs';
import { switchMap, map, take, catchError } from 'rxjs/operators';

/**
 * Permite el acceso si el usuario es admin global (documento en `admins`)
 * o si es gestor de al menos una competición (su UID está en el array
 * `gestores` de alguna). El gestor de liga usa esto para llegar a la
 * captura de resultados, sin ser admin completo.
 */
export const gestorGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const db = inject(Firestore);
  const router = inject(Router);

  return user(auth).pipe(
    take(1),
    switchMap((u) => {
      if (!u) return of(router.createUrlTree(['/login']));

      // Primero: ¿es admin global?
      return from(getDoc(doc(db, 'admins', u.uid))).pipe(
        switchMap((adminSnap) => {
          if (adminSnap.exists()) return of(true as const);

          // Si no, ¿es gestor de alguna competición?
          const q = query(
            collection(db, 'competiciones'),
            where('gestores', 'array-contains', u.uid),
          );
          return from(getDocs(q)).pipe(
            map((snap) => (snap.empty ? router.createUrlTree(['/partidos']) : true)),
          );
        }),
        catchError(() => of(router.createUrlTree(['/partidos']))),
      );
    }),
  );
};