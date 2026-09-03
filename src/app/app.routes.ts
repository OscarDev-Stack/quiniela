import { Routes } from '@angular/router';
import { gestorGuard } from './core/guards/gestor.guard';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';
import { adminOgrupoGuard } from './core/guards/admin-o-grupo.guard';
import { accesoGuard } from './core/guards/acceso.guard';

/**
 * Rutas con carga diferida (lazy loading): cada pantalla se descarga solo
 * cuando el usuario entra a ella, no toda de golpe al abrir la app. Esto
 * mantiene el paquete inicial pequeño (carga más rápida), sobre todo para
 * los jugadores que nunca entran al panel de admin.
 */
export const routes: Routes = [
    { path: '', redirectTo: 'acceso', pathMatch: 'full' },
    {
        path: 'acceso',
        loadComponent: () => import('./features/acceso/acceso.component').then((m) => m.AccesoComponent),
    },
    {
        path: 'login',
        canActivate: [accesoGuard],
        loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
    },
    {
        path: 'registro',
        canActivate: [accesoGuard],
        loadComponent: () => import('./features/auth/register.component').then((m) => m.RegisterComponent),
    },
    {
        path: 'recuperar',
        canActivate: [accesoGuard],
        loadComponent: () => import('./features/auth/recuperar.component').then((m) => m.RecuperarComponent),
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
        path: 'grupos',
        loadComponent: () => import('./features/grupos/grupos.component').then((m) => m.GruposComponent),
        canActivate: [authGuard],
    },
    {
        path: 'grupos/:id',
        loadComponent: () =>
            import('./features/grupos/grupo-detalle.component').then((m) => m.GrupoDetalleComponent),
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
        path: 'unirse-grupo/:codigo',
        loadComponent: () => import('./features/grupos/unirse-grupo.component').then((m) => m.UnirseGrupoComponent),
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
        canActivate: [authGuard],
        children: [
            { path: '', redirectTo: 'partidos', pathMatch: 'full' },
            {
                path: 'partidos',
                canActivate: [adminGuard],
                loadComponent: () => import('./features/admin/gestionar-partidos.component').then((m) => m.GestionarPartidosComponent),
            },
            {
                path: 'partidos/crear',
                canActivate: [adminOgrupoGuard],
                loadComponent: () => import('./features/admin/crear-partido.component').then((m) => m.CrearPartidoComponent),
            },
            {
                path: 'usuarios',
                canActivate: [adminGuard],
                loadComponent: () => import('./features/admin/admin-usuarios.component').then((m) => m.AdminUsuariosComponent),
            },
            {
                path: 'torneos',
                canActivate: [adminGuard],
                loadComponent: () => import('./features/admin/gestionar-torneos.component').then((m) => m.GestionarTorneosComponent),
            },
            {
                path: 'torneos/crear',
                canActivate: [adminOgrupoGuard],
                loadComponent: () => import('./features/admin/crear-torneo.component').then((m) => m.CrearTorneoComponent),
            },
            {
                path: 'competiciones',
                canActivate: [adminGuard],
                loadComponent: () =>
                    import('./features/admin/admin-competiciones.component').then((m) => m.AdminCompeticionesComponent),
            },
            {
                path: 'grupos',
                canActivate: [adminGuard],
                loadComponent: () =>
                    import('./features/admin/admin-grupos.component').then((m) => m.AdminGruposComponent),
            },
            {
                path: 'brackets',
                canActivate: [adminGuard],
                loadComponent: () => import('./features/brackets/gestionar-brackets.component').then((m) => m.GestionarBracketsComponent),
            },
            {
                path: 'brackets/crear',
                canActivate: [adminOgrupoGuard],
                loadComponent: () => import('./features/brackets/crear-bracket.component').then((m) => m.CrearBracketComponent),
            },
        ],
    },

    { path: '**', redirectTo: 'login' },
];