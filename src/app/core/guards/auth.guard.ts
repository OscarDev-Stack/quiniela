import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth, user } from '@angular/fire/auth';
import { map, take } from 'rxjs/operators';

/**
 * Permite el acceso solo si hay un usuario con sesión iniciada.
 * Si no, redirige al login.
 */
export const authGuard: CanActivateFn = () => {
    const auth = inject(Auth);
    const router = inject(Router);

    return user(auth).pipe(
        take(1),
        map((u) => (u ? true : router.createUrlTree(['/login']))),
    );
};