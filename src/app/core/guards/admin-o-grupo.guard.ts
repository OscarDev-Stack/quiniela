import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth, user } from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { from, of } from 'rxjs';
import { switchMap, map, take, catchError } from 'rxjs/operators';

/**
 * Permite el acceso a las pantallas de crear torneo/eliminatoria si:
 * - El usuario es super administrador (documento en `admins/{uid}`), o
 * - Viene con `?grupo=ID` en la URL y es el administrador de ese grupo.
 *
 * Es un guard de navegación (UX). La validación real de quién puede crear
 * qué vive en las Cloud Functions (servidor), que es lo que de verdad protege.
 */
export const adminOgrupoGuard: CanActivateFn = (route) => {
    const auth = inject(Auth);
    const db = inject(Firestore);
    const router = inject(Router);

    const grupoId = route.queryParamMap.get('grupo');

    return user(auth).pipe(
        take(1),
        switchMap((u) => {
            if (!u) return of(router.createUrlTree(['/login']));

            // 1) ¿Super admin? Acceso total.
            return from(getDoc(doc(db, 'admins', u.uid))).pipe(
                switchMap((adminSnap) => {
                    if (adminSnap.exists()) return of(true);

                    // 2) ¿Admin del grupo indicado en la URL?
                    if (!grupoId) return of(router.createUrlTree(['/inicio']));
                    return from(getDoc(doc(db, 'grupos', grupoId))).pipe(
                        map((gSnap) => {
                            const esAdminGrupo = gSnap.exists() && gSnap.data()?.['adminUid'] === u.uid;
                            return esAdminGrupo ? true : router.createUrlTree(['/inicio']);
                        }),
                    );
                }),
                catchError(() => of(router.createUrlTree(['/inicio']))),
            );
        }),
    );
};