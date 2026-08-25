import { Routes } from '@angular/router';
import { gestorGuard } from './core/guards/gestor.guard';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

/**
 * Rutas con carga diferida (lazy loading): cada pantalla se descarga solo
 * cuando el usuario entra a ella, no toda de golpe al abrir la app. Esto
 * mantiene el paquete inicial pequeño (carga más rápida), sobre todo para
 * los jugadores que nunca entran al panel de admin.
 */
export const routes: Routes = [
    { path: '', redirectTo: 'login', pathMatch: 'full' },
    {
        path: 'login',
        loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
    },
    {
        path: 'registro',
        loadComponent: () => import('./features/auth/register.component').then((m) => m.RegisterComponent),
    },
    {
        path: 'recuperar',
        loadComponent: () => import('./features/auth/recuperar.component').then((m) => m.RecuperarComponent),
    },
    {
        path: 'cambiar-contrasena',
        loadComponent: () =>
            import('./features/auth/cambiar-contrasena.component').then((m) => m.CambiarContrasenaComponent),
    },
    {
        // Despachador de las acciones de correo de Firebase (/__/auth/action).
        // El rewrite de firebase.json manda esa ruta aquí.
        path: 'auth/action',
        loadComponent: () =>
            import('./features/auth/auth-action.component').then((m) => m.AuthActionComponent),
    },

    {
        path: 'inicio',
        loadComponent: () => import('./features/inicio/inicio.component').then((m) => m.InicioComponent),
        canActivate: [authGuard],
    },
    {
        path: 'partidos',
        loadComponent: () => import('./features/partidos/partidos-list.component').then((m) => m.PartidosListComponent),
        canActivate: [authGuard],
    },
    {
        path: 'pronosticar/:id',
        loadComponent: () => import('./features/partidos/pronostico.component').then((m) => m.PronosticoComponent),
        canActivate: [authGuard],
    },
    {
        path: 'mis-pronosticos',
        loadComponent: () =>
            import('./features/pronosticos/mis-pronosticos.component').then((m) => m.MisPronosticosComponent),
        canActivate: [authGuard],
    },
    {
        path: 'ranking',
        loadComponent: () => import('./features/ranking/ranking.component').then((m) => m.RankingComponent),
        canActivate: [authGuard],
    },

    {
        path: 'perfil',
        loadComponent: () => import('./features/perfil/perfil.component').then((m) => m.PerfilComponent),
        canActivate: [authGuard],
    },
    {
        path: 'movimientos',
        loadComponent: () => import('./features/perfil/movimientos.component').then((m) => m.MovimientosComponent),
        canActivate: [authGuard],
    },
    {
        path: 'liga',
        loadComponent: () => import('./features/liga/liga-panel.component').then((m) => m.LigaPanelComponent),
        canActivate: [authGuard, gestorGuard],
    },
    {
        path: 'perfil/:uid',
        loadComponent: () => import('./features/perfil/perfil.component').then((m) => m.PerfilComponent),
        canActivate: [authGuard],
    },

    {
        path: 'unirse/:codigo',
        loadComponent: () => import('./features/torneos/unirse.component').then((m) => m.UnirseComponent),
    },
    {
        path: 'torneos',
        loadComponent: () => import('./features/torneos/torneos-list.component').then((m) => m.TorneosListComponent),
        canActivate: [authGuard],
    },
    {
        path: 'torneos/:id',
        loadComponent: () => import('./features/torneos/torneo-detalle.component').then((m) => m.TorneoDetalleComponent),
        canActivate: [authGuard],
    },

    {
        path: 'eliminatorias/:id',
        loadComponent: () => import('./features/brackets/bracket-detalle.component').then((m) => m.BracketDetalleComponent),
        canActivate: [authGuard],
    },

    {
        path: 'admin',
        loadComponent: () => import('./features/admin/admin-layout.component').then((m) => m.AdminLayoutComponent),
        canActivate: [authGuard, adminGuard],
        children: [
            { path: '', redirectTo: 'partidos', pathMatch: 'full' },
            {
                path: 'partidos',
                loadComponent: () => import('./features/admin/admin-partidos.component').then((m) => m.AdminPartidosComponent),
            },
            {
                path: 'usuarios',
                loadComponent: () => import('./features/admin/admin-usuarios.component').then((m) => m.AdminUsuariosComponent),
            },
            {
                path: 'torneos',
                loadComponent: () => import('./features/admin/admin-torneos.component').then((m) => m.AdminTorneosComponent),
            },
            {
                path: 'competiciones',
                loadComponent: () =>
                    import('./features/admin/admin-competiciones.component').then((m) => m.AdminCompeticionesComponent),
            },
            {
                path: 'brackets',
                loadComponent: () => import('./features/brackets/admin-brackets.component').then((m) => m.AdminBracketsComponent),
            },
        ],
    },

    { path: '**', redirectTo: 'login' },
];