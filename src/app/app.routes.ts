import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login.component';
import { RegisterComponent } from './features/auth/register.component';
import { PartidosListComponent } from './features/partidos/partidos-list.component';
import { PronosticoComponent } from './features/partidos/pronostico.component';
import { MisPronosticosComponent } from './features/pronosticos/mis-pronosticos.component';
import { RankingComponent } from './features/ranking/ranking.component';
import { TorneosListComponent } from './features/torneos/torneos-list.component';
import { TorneoDetalleComponent } from './features/torneos/torneo-detalle.component';
import { UnirseComponent } from './features/torneos/unirse.component';
import { AdminTorneosComponent } from './features/admin/admin-torneos.component';
import { AdminCompeticionesComponent } from './features/admin/admin-competiciones.component';
import { PerfilComponent } from './features/perfil/perfil.component';
import { AdminLayoutComponent } from './features/admin/admin-layout.component';
import { AdminPartidosComponent } from './features/admin/admin-partidos.component';
import { AdminUsuariosComponent } from './features/admin/admin-usuarios.component';
import { AdminBracketsComponent } from './features/brackets/admin-brackets.component';
import { BracketDetalleComponent } from './features/brackets/bracket-detalle.component';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
    { path: '', redirectTo: 'login', pathMatch: 'full' },
    { path: 'login', component: LoginComponent },
    { path: 'registro', component: RegisterComponent },

    { path: 'partidos', component: PartidosListComponent, canActivate: [authGuard] },
    { path: 'pronosticar/:id', component: PronosticoComponent, canActivate: [authGuard] },
    { path: 'mis-pronosticos', component: MisPronosticosComponent, canActivate: [authGuard] },
    { path: 'ranking', component: RankingComponent, canActivate: [authGuard] },

    { path: 'perfil', component: PerfilComponent, canActivate: [authGuard] },
    { path: 'perfil/:uid', component: PerfilComponent, canActivate: [authGuard] },

    { path: 'unirse/:codigo', component: UnirseComponent },
    { path: 'torneos', component: TorneosListComponent, canActivate: [authGuard] },
    { path: 'torneos/:id', component: TorneoDetalleComponent, canActivate: [authGuard] },

    { path: 'eliminatorias/:id', component: BracketDetalleComponent, canActivate: [authGuard] },

    {
        path: 'admin',
        component: AdminLayoutComponent,
        canActivate: [authGuard, adminGuard],
        children: [
            { path: '', redirectTo: 'partidos', pathMatch: 'full' },
            { path: 'partidos', component: AdminPartidosComponent },
            { path: 'usuarios', component: AdminUsuariosComponent },
            { path: 'torneos', component: AdminTorneosComponent },
            { path: 'competiciones', component: AdminCompeticionesComponent },
            { path: 'brackets', component: AdminBracketsComponent },
        ],
    },

    { path: '**', redirectTo: 'login' },
];