import { Injectable, inject } from '@angular/core';
import { Auth, user } from '@angular/fire/auth';
import {
    Firestore,
    collection,
    collectionData,
    doc,
    docData,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of, combineLatest } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { Grupo, MiembroGrupo, FilaTablaGrupo } from '../models/grupo.model';
import { UserService } from './user.service';

@Injectable({ providedIn: 'root' })
export class GruposService {
    private readonly db = inject(Firestore);
    private readonly auth = inject(Auth);
    private readonly fns = inject(Functions);
    private readonly users = inject(UserService);

    /** Los grupos a los que pertenezco (según el array del usuario). */
    misGrupos(): Observable<Grupo[]> {
        return this.users.me$.pipe(
            switchMap((me) => {
                const ids = me?.grupos ?? [];
                if (ids.length === 0) return of([] as Grupo[]);
                // Leemos cada grupo por su id.
                const lecturas = ids.map(
                    (id) => docData(doc(this.db, 'grupos', id), { idField: 'id' }) as Observable<Grupo>,
                );
                // combineLatest emite la lista completa; filtramos ids inexistentes.
                return combineLatest(lecturas).pipe(
                    map((lista) => lista.filter((g): g is Grupo => !!g)),
                );
            }),
        );
    }

    /** Un grupo por id (en vivo). */
    grupo(grupoId: string): Observable<Grupo | undefined> {
        return docData(doc(this.db, 'grupos', grupoId), { idField: 'id' }) as Observable<Grupo | undefined>;
    }

    /** Miembros de un grupo. */
    miembros(grupoId: string): Observable<MiembroGrupo[]> {
        return collectionData(collection(this.db, `grupos/${grupoId}/miembros`)) as Observable<MiembroGrupo[]>;
    }

    /** Tabla (ranking) de un grupo. */
    tabla(grupoId: string): Observable<FilaTablaGrupo[]> {
        return collectionData(collection(this.db, `grupos/${grupoId}/tabla`)) as Observable<FilaTablaGrupo[]>;
    }

    // ── Acciones (Cloud Functions) ─────────────────────────────────────

    async crear(nombre: string, icono: string): Promise<{ grupoId: string; codigo: string }> {
        const fn = httpsCallable(this.fns, 'crearGrupo');
        const r = await fn({ nombre, icono });
        return r.data as { grupoId: string; codigo: string };
    }

    async unirse(codigo: string): Promise<{ grupoId: string; nombre: string }> {
        const fn = httpsCallable(this.fns, 'unirseAGrupo');
        const r = await fn({ codigo });
        return r.data as { grupoId: string; nombre: string };
    }

    async agregarMiembro(grupoId: string, uid: string): Promise<void> {
        const fn = httpsCallable(this.fns, 'agregarMiembroGrupo');
        await fn({ grupoId, uid });
    }

    async salir(grupoId: string, nuevoAdminUid?: string): Promise<{ eliminado: boolean }> {
        const fn = httpsCallable(this.fns, 'salirDeGrupo');
        const r = await fn({ grupoId, nuevoAdminUid: nuevoAdminUid ?? '' });
        return r.data as { eliminado: boolean };
    }

    async marcarFavorito(grupoId: string, favorito: boolean): Promise<void> {
        const fn = httpsCallable(this.fns, 'marcarGrupoFavorito');
        await fn({ grupoId, favorito });
    }
}