import { Injectable, inject } from '@angular/core';
import { Auth, user } from '@angular/fire/auth';
import {
    Firestore,
    collection,
    collectionData,
    doc,
    docData,
    addDoc,
    updateDoc,
    query,
    where,
    orderBy,
    arrayUnion,
    arrayRemove,
    serverTimestamp,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { Competicion, Jornada } from '../models/competicion.model';

@Injectable({ providedIn: 'root' })
export class CompeticionesService {
    private readonly db = inject(Firestore);
    private readonly auth = inject(Auth);
    private readonly fns = inject(Functions);

    // ---------- Lectura ----------

    competiciones(): Observable<Competicion[]> {
        return collectionData(collection(this.db, 'competiciones'), {
            idField: 'id',
        }) as Observable<Competicion[]>;
    }

    competicion(id: string): Observable<Competicion | null> {
        return docData(doc(this.db, 'competiciones', id), {
            idField: 'id',
        }) as Observable<Competicion | null>;
    }

    jornadas(competicionId: string): Observable<Jornada[]> {
        const q = query(
            collection(this.db, `competiciones/${competicionId}/jornadas`),
            orderBy('numero', 'asc'),
        );
        return collectionData(q, { idField: 'id' }) as Observable<Jornada[]>;
    }

    /** Jornada concreta por número. */
    jornadaPorNumero(competicionId: string, numero: number): Observable<Jornada | null> {
        const q = query(
            collection(this.db, `competiciones/${competicionId}/jornadas`),
            where('numero', '==', numero),
        );
        return (collectionData(q, { idField: 'id' }) as Observable<Jornada[]>).pipe(
            map((lista) => lista[0] ?? null),
        );
    }

    /** ¿Puedo gestionar esta competición? */
    soyGestor(competicionId: string): Observable<boolean> {
        return user(this.auth).pipe(
            switchMap((u) => {
                if (!u) return of(false);
                return this.competicion(competicionId).pipe(
                    map((c) => (c?.gestores ?? []).includes(u.uid)),
                );
            }),
        );
    }

    // ---------- Escritura ----------

    crear(nombre: string) {
        return addDoc(collection(this.db, 'competiciones'), {
            nombre: nombre.trim(),
            gestores: [],
            createdAt: serverTimestamp(),
        });
    }

    /** Guarda el catálogo de equipos, ordenado y sin repetidos. */
    guardarEquipos(competicionId: string, equipos: string[]) {
        const limpios = [...new Set(equipos.map((e) => e.trim()).filter(Boolean))].sort((a, b) =>
            a.localeCompare(b, 'es'),
        );
        return updateDoc(doc(this.db, 'competiciones', competicionId), { equipos: limpios });
    }

    /** Vincula la competición con una liga/temporada de TheSportsDB. */
    guardarConfigApi(competicionId: string, apiLigaId: number, apiTemporada: string) {
        return updateDoc(doc(this.db, 'competiciones', competicionId), {
            apiLigaId,
            apiTemporada: apiTemporada.trim(),
        });
    }

    /**
     * Trae de la API los enfrentamientos de una jornada, con equipos ya
     * normalizados y la hora del primer partido. Solo devuelve datos; el
     * admin los revisa y guarda con el flujo normal.
     */
    async traerJornadaApi(
        competicionId: string,
        numeroJornada: number,
    ): Promise<{
        numeroJornada: number;
        primeraHora: string;
        partidos: Array<{ local: string; visitante: string }>;
    }> {
        const fn = httpsCallable<
            { competicionId: string; numeroJornada: number },
            {
                ok: boolean;
                numeroJornada: number;
                primeraHora: string;
                partidos: Array<{ local: string; visitante: string }>;
            }
        >(this.fns, 'traerJornadaApi');
        const res = await fn({ competicionId, numeroJornada });
        return res.data;
    }

    /**
     * Trae de la API los marcadores de una jornada ya guardada. Devuelve los
     * partidos con su resultado precargado; el admin confirma y publica.
     */
    async traerResultadosApi(
        competicionId: string,
        jornadaId: string,
    ): Promise<{
        numero: number;
        conResultado: number;
        partidos: Jornada['partidos'];
    }> {
        const fn = httpsCallable<
            { competicionId: string; jornadaId: string },
            { ok: boolean; numero: number; conResultado: number; partidos: Jornada['partidos'] }
        >(this.fns, 'traerResultadosApi');
        const res = await fn({ competicionId, jornadaId });
        return res.data;
    }

    cambiarGestor(competicionId: string, uid: string, agregar: boolean) {
        return updateDoc(doc(this.db, 'competiciones', competicionId), {
            gestores: agregar ? arrayUnion(uid) : arrayRemove(uid),
        });
    }

    crearJornada(
        competicionId: string,
        numero: number,
        cierraAt: Date,
        partidos: Array<{ local: string; visitante: string }>,
    ) {
        return addDoc(collection(this.db, `competiciones/${competicionId}/jornadas`), {
            numero,
            cierraAt,
            estado: 'abierta',
            partidos: partidos.map((p) => ({ ...p, resultado: null })),
        });
    }

    guardarResultados(competicionId: string, jornadaId: string, partidos: Jornada['partidos']) {
        return updateDoc(doc(this.db, `competiciones/${competicionId}/jornadas`, jornadaId), {
            partidos,
        });
    }

    /**
     * Calcula la previa de puntos de las quinielas con los resultados
     * capturados hasta ahora (aunque falten partidos). Escribe en campos
     * separados (puntosPrevia), sin tocar el puntaje oficial ni resolver la
     * jornada. Alimenta la vista en vivo de los jugadores.
     */
    async previsualizarQuiniela(
        competicionId: string,
        jornadaId: string,
    ): Promise<{ cartones: number }> {
        const fn = httpsCallable<
            { competicionId: string; jornadaId: string },
            { ok: boolean; cartones: number }
        >(this.fns, 'previsualizarQuiniela');
        const res = await fn({ competicionId, jornadaId });
        return res.data;
    }

    /**
     * Publica el resultado oficial y lo aplica a todos los torneos
     * que estén jugando esa jornada.
     */
    async resolver(
        competicionId: string,
        jornadaId: string,
    ): Promise<{
        torneos: number;
        sobreviven: number;
        eliminados: number;
        pendientes: number;
        cerrados: string[];
    }> {
        const fn = httpsCallable<
            { competicionId: string; jornadaId: string },
            {
                ok: boolean;
                torneos: number;
                sobreviven: number;
                eliminados: number;
                pendientes: number;
                cerrados: string[];
            }
        >(this.fns, 'resolverJornadaCompeticion');
        const res = await fn({ competicionId, jornadaId });
        return res.data;
    }

    /** Define las elecciones que quedaron en espera por un aplazamiento. */
    async resolverPendientes(
        competicionId: string,
        jornadaId: string,
    ): Promise<{ resueltos: number; eliminados: number; cerrados: string[] }> {
        const fn = httpsCallable<
            { competicionId: string; jornadaId: string },
            { ok: boolean; resueltos: number; eliminados: number; cerrados: string[] }
        >(this.fns, 'resolverPendientes');
        const res = await fn({ competicionId, jornadaId });
        return res.data;
    }
}