import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    collectionData,
    addDoc,
    doc,
    updateDoc,
    docData,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of, combineLatest } from 'rxjs';
import { switchMap, map, shareReplay } from 'rxjs/operators';
import { UserService } from './user.service';
import { Partido } from '../models/partido.model';
import { Bolsa } from '../models/bolsa.model';
import { AppUser } from '../models/user.model';

export interface ResultadoLiquidacion {
    ok: boolean;
    participantes: number;
    ganadores: number;
    bolsa: number;
    sobrante: number;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
    private readonly db = inject(Firestore);
    private readonly fns = inject(Functions);
    private readonly userSvc = inject(UserService);

    // ---------- Partidos ----------

    getPartidos(): Observable<Partido[]> {
        return collectionData(collection(this.db, 'partidos'), {
            idField: 'id',
        }) as Observable<Partido[]>;
    }

    /** Acumulados globales: reserva, puntos repartidos y partidos liquidados. */
    getSistema(): Observable<{ total?: number; repartido?: number; liquidados?: number } | null> {
        return docData(doc(this.db, 'sistema', 'reserva')) as Observable<{
            total?: number;
            repartido?: number;
            liquidados?: number;
        } | null>;
    }

    /**
     * Número de asuntos que requieren atención del administrador:
     * resultados precargados por la API y alertas de partidos.
     * Solo consulta si el usuario es administrador.
     */
    readonly pendientes$: Observable<number> = this.userSvc.isAdmin$.pipe(
        switchMap((esAdmin) => {
            if (!esAdmin) return of([0, 0] as [number, number]);
            return combineLatest([this.getPartidos(), this.getUsers()]).pipe(
                map(([partidos, usuarios]): [number, number] => [
                    partidos.filter((p) => !p.liquidado && (!!p.resultadoPropuesto || !!p.alertaApi))
                        .length,
                    usuarios.filter((u) => !u.validada).length,
                ]),
            );
        }),
        map(([resultados, sinValidar]) => resultados + sinValidar),
        // Se recuerda el último valor para que la barra no parpadee al navegar.
        shareReplay({ bufferSize: 1, refCount: false }),
    );

    /**
     * Solo los usuarios sin validar. Sirve para el badge de "Usuarios", que
     * antes reutilizaba pendientes$ (API + usuarios) y podía mostrar un número
     * que no correspondía a ningún usuario por validar.
     */
    readonly usuariosPendientes$: Observable<number> = this.userSvc.isAdmin$.pipe(
        switchMap((esAdmin) =>
            esAdmin
                ? this.getUsers().pipe(map((usuarios) => usuarios.filter((u) => !u.validada).length))
                : of(0),
        ),
        shareReplay({ bufferSize: 1, refCount: false }),
    );

    /** Solo los partidos con resultado por confirmar o alertas de la API. */
    readonly partidosPendientes$: Observable<number> = this.userSvc.isAdmin$.pipe(
        switchMap((esAdmin) =>
            esAdmin
                ? this.getPartidos().pipe(
                      map(
                          (partidos) =>
                              partidos.filter(
                                  (p) => !p.liquidado && (!!p.resultadoPropuesto || !!p.alertaApi),
                              ).length,
                      ),
                  )
                : of(0),
        ),
        shareReplay({ bufferSize: 1, refCount: false }),
    );

    /** Totales apostados por partido (colección privada). */
    getBolsas(): Observable<Bolsa[]> {
        return collectionData(collection(this.db, 'bolsas'), {
            idField: 'id',
        }) as Observable<Bolsa[]>;
    }

    crearPartido(data: Omit<Partido, 'id'>) {
        return addDoc(collection(this.db, 'partidos'), data);
    }

    /**
     * Crea un partido de grupo vía Cloud Function (valida que seas admin del
     * grupo en el servidor). Sirve para manuales y de API.
     */
    async crearPartidoGrupo(data: {
        grupoId: string;
        competition: string;
        homeTeam: string;
        awayTeam: string;
        type: string;
        closesAtMs: number;
        porcentajeBote?: number;
        apiFixtureId?: number;
        apiEventId?: string;
        apiLigaId?: number;
    }): Promise<{ id: string }> {
        const fn = httpsCallable<typeof data, { ok: boolean; id: string }>(
            this.fns,
            'crearPartidoGrupo',
        );
        const r = await fn(data);
        return { id: r.data.id };
    }

    /** Liquida un partido de grupo (valida admin de grupo en el servidor). */
    async liquidarPartidoGrupo(
        partidoId: string,
        resultadoOficial: string,
    ): Promise<ResultadoLiquidacion> {
        const fn = httpsCallable<{ partidoId: string; resultadoOficial: string }, ResultadoLiquidacion>(
            this.fns,
            'liquidarPartidoGrupo',
        );
        const res = await fn({ partidoId, resultadoOficial });
        return res.data;
    }

    /** Cancela el partido y devuelve los puntos a cada participante. */
    async cancelarPartido(partidoId: string): Promise<{ devoluciones: number; puntosDevueltos: number }> {
        const fn = httpsCallable<
            { partidoId: string },
            { ok: boolean; devoluciones: number; puntosDevueltos: number }
        >(this.fns, 'cancelarPartido');
        const res = await fn({ partidoId });
        return res.data;
    }

    /** Busca partidos reales en football-data.org. */
    async buscarFixtures(competicion: string, desde: string, hasta: string) {
        const fn = httpsCallable<
            { competicion: string; desde: string; hasta: string },
            {
                ok: boolean;
                partidos: Array<{
                    apiFixtureId: number;
                    fecha: string;
                    homeTeam: string;
                    awayTeam: string;
                    homeTeamId: number | null;
                    awayTeamId: number | null;
                    competition: string;
                }>;
            }
        >(this.fns, 'buscarFixtures');
        const res = await fn({ competicion, desde, hasta });
        return res.data.partidos;
    }

    /**
     * Trae la forma reciente (últimos 5) de dos equipos de football-data. Se
     * llama UNA vez al crear el partido para guardarla; no cambia después.
     */
    async formaEquipos(
        homeTeamId: number | null,
        awayTeamId: number | null,
    ): Promise<{ formaLocal: string; formaVisitante: string }> {
        if (!homeTeamId && !awayTeamId) return { formaLocal: '', formaVisitante: '' };
        const fn = httpsCallable<
            { homeTeamId: number | null; awayTeamId: number | null },
            { ok: boolean; formaLocal: string; formaVisitante: string }
        >(this.fns, 'formaEquiposApi');
        const res = await fn({ homeTeamId, awayTeamId });
        return { formaLocal: res.data.formaLocal, formaVisitante: res.data.formaVisitante };
    }

    /** Busca próximos partidos de una liga en TheSportsDB. */
    async buscarFixturesSportsDb(liga: string) {
        const fn = httpsCallable<
            { liga: string },
            {
                ok: boolean;
                liga: string;
                partidos: Array<{
                    apiEventId: string;
                    fecha: string;
                    homeTeam: string;
                    awayTeam: string;
                    homeTeamId: string | null;
                    awayTeamId: string | null;
                    ronda: string;
                    competition: string;
                    apiLigaId: number;
                }>;
            }
        >(this.fns, 'buscarFixturesSportsDb');
        const res = await fn({ liga });
        return res.data.partidos;
    }

    /** Reconstruye las bolsas desde los pronósticos reales. */
    async recalcularBolsas(): Promise<{ partidos: number }> {
        const fn = httpsCallable<Record<string, never>, { ok: boolean; partidos: number }>(
            this.fns,
            'recalcularBolsas',
        );
        const res = await fn({} as Record<string, never>);
        return res.data;
    }

    /** Regenera la colección pública del ranking. */
    /** Iguala los puntos históricos con el saldo. Uso excepcional. */
    async sincronizarHistoricos(): Promise<{ corregidos: number }> {
        const fn = httpsCallable<Record<string, never>, { ok: boolean; corregidos: number }>(
            this.fns,
            'sincronizarHistoricos',
        );
        const res = await fn({} as Record<string, never>);
        return res.data;
    }

    async recalcularRanking(): Promise<{ jugadores: number }> {
        const fn = httpsCallable<Record<string, never>, { ok: boolean; jugadores: number }>(
            this.fns,
            'recalcularRanking',
        );
        const res = await fn({} as Record<string, never>);
        return res.data;
    }

    /**
     * Reconstruye totalGastado/totalGanado de todos los usuarios desde el
     * ledger. Se corre una sola vez para las cuentas anteriores a estos
     * campos; de ahí en adelante se mantienen solos con cada movimiento.
     */
    async backfillTotales(): Promise<{ usuarios: number }> {
        const fn = httpsCallable<Record<string, never>, { ok: boolean; usuarios: number }>(
            this.fns,
            'backfillTotales',
        );
        const res = await fn({} as Record<string, never>);
        return res.data;
    }

    /**
     * Registra el resultado y liquida el partido.
     * Toda la lógica corre en Cloud Functions: reparto proporcional,
     * redondeo hacia abajo, sobrante a la reserva y devoluciones.
     */
    async liquidar(partidoId: string, resultadoOficial: string): Promise<ResultadoLiquidacion> {
        const fn = httpsCallable<
            { partidoId: string; resultadoOficial: string },
            ResultadoLiquidacion
        >(this.fns, 'liquidarPartido');
        const res = await fn({ partidoId, resultadoOficial });
        return res.data;
    }

    // ---------- Usuarios ----------

    getUsers(): Observable<AppUser[]> {
        return collectionData(collection(this.db, 'users'), {
            idField: 'id',
        }) as Observable<AppUser[]>;
    }

    async validarUsuario(uid: string): Promise<void> {
        await updateDoc(doc(this.db, 'users', uid), { validada: true });
        await this.recalcularRanking();
    }

    /** Activa o desactiva el rol de administrador de grupo. */
    async setAdminGrupo(uid: string, esAdminGrupo: boolean): Promise<void> {
        await updateDoc(doc(this.db, 'users', uid), { esAdminGrupo });
    }

    /** Elimina cuentas sin validar (Authentication + documentos). */
    async eliminarUsuarios(uids: string[]): Promise<{ borrados: number; omitidos: string[] }> {
        const fn = httpsCallable<
            { uids: string[] },
            { ok: boolean; borrados: number; omitidos: string[] }
        >(this.fns, 'eliminarUsuarios');
        const res = await fn({ uids });
        return res.data;
    }

    async reiniciarPuntos(uid: string): Promise<void> {
        // Pasa por la Cloud Function: pone el saldo en 0 y registra el ajuste
        // en el ledger, todo en una transacción auditable.
        const fn = httpsCallable(this.fns, 'reiniciarPuntos');
        await fn({ uid });
        await this.recalcularRanking();
    }

}