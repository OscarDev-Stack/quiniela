import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    collectionData,
    doc,
    docData,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { UserService } from './user.service';
import { Observable, of, combineLatest } from 'rxjs';
import { map, switchMap, distinctUntilChanged } from 'rxjs/operators';
import {
    Bracket,
    ConfigBracket,
    PuntajeBracket,
    EquipoBracket,
    PronosticoBracket,
} from '../models/bracket.model';

/**
 * Acceso a los brackets. La lectura sale directo de Firestore; toda
 * escritura (crear, armar, capturar, resolver) pasa por funciones de
 * servidor, para que la calificación y el reparto no dependan del
 * cliente.
 */
@Injectable({ providedIn: 'root' })
export class BracketsService {
    private readonly db = inject(Firestore);
    private readonly fns = inject(Functions);
    private readonly users = inject(UserService);

    // ---------- Lectura ----------

    /** Todos los brackets. Uso administrativo. */
    brackets(): Observable<Bracket[]> {
        return collectionData(collection(this.db, 'brackets'), { idField: 'id' }) as Observable<
            Bracket[]
        >;
    }

    /**
     * Eliminatorias en las que participo. Como los torneos, solo se ven
     * las que uní con el código de invitación — nunca todas.
     */
    misBrackets(): Observable<Bracket[]> {
        return this.users.me$.pipe(
            map((me) => me?.brackets ?? []),
            distinctUntilChanged((a, b) => a.join('|') === b.join('|')),
            switchMap((ids) =>
                ids.length === 0
                    ? of([] as Bracket[])
                    : combineLatest(ids.map((id) => this.bracket(id))).pipe(
                        map((lista) => lista.filter((b): b is Bracket => !!b)),
                    ),
            ),
        );
    }

    /** Un bracket por id, en vivo. */
    bracket(id: string): Observable<Bracket | null> {
        if (!id) return of(null);
        return docData(doc(this.db, 'brackets', id), { idField: 'id' }) as Observable<Bracket | null>;
    }

    // ---------- Escritura (vía servidor) ----------

    /** Crea el bracket con su configuración y equipos. */
    async crear(datos: {
        nombre: string;
        config: ConfigBracket;
        puntaje: PuntajeBracket;
        equipos: EquipoBracket[];
        costoEntrada: number;
        cierraAt: Date | null;
    }): Promise<{ id: string }> {
        const fn = httpsCallable<typeof datos, { ok: boolean; id: string }>(
            this.fns,
            'crearBracket',
        );
        const res = await fn(datos);
        return { id: res.data.id };
    }

    /** En modo manual, asigna los dos equipos de una llave. */
    async asignarLlave(
        bracketId: string,
        idLlave: string,
        local: EquipoBracket | null,
        visitante: EquipoBracket | null,
    ): Promise<void> {
        const fn = httpsCallable(this.fns, 'asignarLlaveBracket');
        await fn({ bracketId, idLlave, local, visitante });
    }

    /** Captura el marcador de un partido y, si se completa, resuelve la llave. */
    async capturar(
        bracketId: string,
        idLlave: string,
        indicePartido: number,
        golesLocal: number,
        golesVisitante: number,
        ganaPenales: 'local' | 'visitante' | null,
    ): Promise<void> {
        const fn = httpsCallable(this.fns, 'capturarPartidoBracket');
        await fn({ bracketId, idLlave, indicePartido, golesLocal, golesVisitante, ganaPenales });
    }

    /** Mi pronóstico de un bracket, en vivo. */
    miPronostico(bracketId: string, uid: string): Observable<PronosticoBracket | null> {
        if (!bracketId || !uid) return of(null);
        return docData(doc(this.db, `brackets/${bracketId}/pronosticos/${uid}`), {
            idField: 'id',
        }) as Observable<PronosticoBracket | null>;
    }

    /** Todos los pronósticos de un bracket (para la tabla, una vez cerrado). */
    pronosticos(bracketId: string): Observable<PronosticoBracket[]> {
        if (!bracketId) return of([]);
        return collectionData(collection(this.db, `brackets/${bracketId}/pronosticos`), {
            idField: 'id',
        }) as Observable<PronosticoBracket[]>;
    }

    /** Se une a un bracket con su código. */
    async unirse(codigo: string): Promise<{ id: string }> {
        const fn = httpsCallable<{ codigo: string }, { ok: boolean; id: string }>(
            this.fns,
            'unirseBracket',
        );
        const res = await fn({ codigo });
        return { id: res.data.id };
    }

    /** Guarda mi pronóstico del cuadro. */
    async guardarPronostico(
        bracketId: string,
        avances: Record<string, string>,
        marcadores: Record<string, { local: number; visitante: number }> | null,
    ): Promise<void> {
        const fn = httpsCallable(this.fns, 'guardarPronosticoBracket');
        await fn({ bracketId, avances, marcadores });
    }

    /** Califica y reparte una eliminatoria terminada. Solo admin. */
    async calificar(bracketId: string): Promise<{ calificados: number }> {
        const fn = httpsCallable<{ bracketId: string }, { ok: boolean; calificados: number }>(
            this.fns,
            'calificarBracket',
        );
        const res = await fn({ bracketId });
        return { calificados: res.data.calificados };
    }
}