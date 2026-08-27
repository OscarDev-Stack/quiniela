import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AccesoService } from '../services/acceso.service';

/**
 * Exige haber pasado el portón de Cloudflare Turnstile antes de entrar a
 * cualquier ruta protegida. Si el dispositivo no ha sido validado, redirige
 * a la pantalla de acceso.
 */
export const accesoGuard: CanActivateFn = () => {
    const acceso = inject(AccesoService);
    const router = inject(Router);
    return acceso.yaValidado() ? true : router.createUrlTree(['/acceso']);
};