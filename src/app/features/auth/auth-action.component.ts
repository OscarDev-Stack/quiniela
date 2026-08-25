import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * Despachador de las acciones de correo de Firebase.
 *
 * Firebase manda los enlaces de sus correos a /__/auth/action con un
 * parámetro ?mode=... que indica la acción (resetPassword, verifyEmail,
 * recoverEmail) y un ?oobCode=... con el código de un solo uso.
 *
 * Este componente lee el modo y redirige a NUESTRA pantalla correspondiente,
 * conservando el oobCode. Así usamos nuestra propia interfaz en vez de la
 * página genérica de Firebase, sin depender de la "Action URL" de la consola
 * (que en proyectos con Identity Platform queda bloqueada).
 *
 * Para que Firebase Hosting deje que esta ruta llegue a la app (y no sirva
 * su propia página), hay que agregar un rewrite en firebase.json (ver notas).
 */
@Component({
    selector: 'app-auth-action',
    standalone: true,
    template: `
    <div class="cargando-accion">
      <p>Un momento…</p>
    </div>
  `,
    styles: [
        `
      .cargando-accion {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary);
        font-size: 14px;
      }
    `,
    ],
})
export class AuthActionComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);

    constructor() {
        const q = this.route.snapshot.queryParamMap;
        const mode = q.get('mode') ?? '';
        const oobCode = q.get('oobCode') ?? '';

        // Sin código no hay nada que hacer: al login.
        if (!oobCode) {
            this.router.navigate(['/login']);
            return;
        }

        switch (mode) {
            case 'resetPassword':
                // A nuestra pantalla de cambio de contraseña, con el código.
                this.router.navigate(['/cambiar-contrasena'], { queryParams: { oobCode } });
                break;
            // Espacio para el futuro: verificar correo, recuperar correo, etc.
            // case 'verifyEmail':
            //   this.router.navigate(['/verificar-correo'], { queryParams: { oobCode } });
            //   break;
            default:
                // Modo desconocido: al login para no dejar al usuario atorado.
                this.router.navigate(['/login']);
        }
    }
}