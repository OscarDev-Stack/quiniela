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
  serverTimestamp,
  arrayUnion,
  arrayRemove,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, of, combineLatest } from 'rxjs';
import { switchMap, map, distinctUntilChanged, shareReplay } from 'rxjs/operators';
import { Torneo, Participante, Pick, Quiniela, ModoTorneo } from '../models/torneo.model';
import { fechaJornada } from '../models/competicion.model';
import { CompeticionesService } from './competiciones.service';
import { UserService } from './user.service';

@Injectable({ providedIn: 'root' })
export class TorneosService {
  private readonly db = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly fns = inject(Functions);
  private readonly competiciones = inject(CompeticionesService);
  private readonly users = inject(UserService);

  // ---------- Lectura ----------

  /** Solo los torneos en los que participo. Es lo que ve el jugador. */
  readonly misTorneos$: Observable<Torneo[]> = this.users.me$.pipe(
    map((me): string[] => me?.torneos ?? []),
    distinctUntilChanged((a: string[], b: string[]) => a.join('|') === b.join('|')),
    switchMap((ids: string[]) =>
      ids.length === 0
        ? of([] as Torneo[])
        : combineLatest(ids.map((id: string) => this.torneo(id))).pipe(
          map((lista: Array<Torneo | null>) => lista.filter((t): t is Torneo => !!t)),
        ),
    ),
  );

  /** Todos los torneos. Uso administrativo. */
  torneos(): Observable<Torneo[]> {
    return collectionData(collection(this.db, 'torneos'), {
      idField: 'id',
    }) as Observable<Torneo[]>;
  }

  torneo(id: string): Observable<Torneo | null> {
    return docData(doc(this.db, 'torneos', id), { idField: 'id' }) as Observable<Torneo | null>;
  }

  participantes(torneoId: string): Observable<Participante[]> {
    return collectionData(collection(this.db, `torneos/${torneoId}/participantes`), {
      idField: 'id',
    }) as Observable<Participante[]>;
  }

  /** Mi elección de la jornada indicada. */
  miPick(torneoId: string, jornada: number): Observable<Pick | null> {
    return user(this.auth).pipe(
      switchMap((u) => {
        if (!u) return of(null);
        return docData(doc(this.db, `torneos/${torneoId}/picks`, `${u.uid}_${jornada}`), {
          idField: 'id',
        }) as Observable<Pick | null>;
      }),
    );
  }

  /** Mis elecciones que siguen en espera por un partido aplazado. */
  misPicksPendientes(torneoId: string): Observable<Pick[]> {
    return this.misPicks(torneoId).pipe(
      map((lista) => lista.filter((p) => p.estado === 'pendiente')),
    );
  }

  /** Todos mis picks del torneo, con su jornada. Para el historial propio. */
  misPicks(torneoId: string): Observable<Pick[]> {
    return user(this.auth).pipe(
      switchMap((u) => {
        if (!u) return of([] as Pick[]);
        const q = query(
          collection(this.db, `torneos/${torneoId}/picks`),
          where('uid', '==', u.uid),
        );
        return collectionData(q, { idField: 'id' }) as Observable<Pick[]>;
      }),
    );
  }

  /**
   * Elecciones de todos los participantes en una jornada.
   * Solo debe consultarse cuando la jornada ya cerró: antes,
   * revelar los picks permitiría copiarse.
   */
  picksJornada(torneoId: string, jornada: number): Observable<Pick[]> {
    return collectionData(
      query(
        collection(this.db, `torneos/${torneoId}/picks`),
        where('jornada', '==', jornada),
      ),
      { idField: 'id' },
    ) as Observable<Pick[]>;
  }

  /**
   * Pronósticos de todos en una jornada. Igual que con los picks,
   * solo debe consultarse cuando la jornada ya cerró.
   */
  quinielasJornada(torneoId: string, jornada: number): Observable<Quiniela[]> {
    return collectionData(
      query(
        collection(this.db, `torneos/${torneoId}/quinielas`),
        where('jornada', '==', jornada),
      ),
      { idField: 'id' },
    ) as Observable<Quiniela[]>;
  }

  /** Mi quiniela de la jornada indicada. */
  miQuiniela(torneoId: string, jornada: number): Observable<Quiniela | null> {
    return user(this.auth).pipe(
      switchMap((u) => {
        if (!u) return of(null);
        return docData(doc(this.db, `torneos/${torneoId}/quinielas`, `${u.uid}_${jornada}`), {
          idField: 'id',
        }) as Observable<Quiniela | null>;
      }),
    );
  }

  /** Mi ficha de participante. */
  miParticipacion(torneoId: string): Observable<Participante | null> {
    return user(this.auth).pipe(
      switchMap((u) => {
        if (!u) return of(null);
        return docData(doc(this.db, `torneos/${torneoId}/participantes`, u.uid), {
          idField: 'id',
        }) as Observable<Participante | null>;
      }),
    );
  }

  /**
   * Cuántos torneos esperan mi elección: estoy vivo, la jornada está
   * abierta y todavía no elijo equipo. Alimenta el aviso de la pestaña.
   */
  readonly pendientes$: Observable<number> = user(this.auth).pipe(
    switchMap((u) => {
      if (!u) return of(0);

      return this.misTorneos$.pipe(
        switchMap((lista) => {
          const enCurso = lista.filter((t) => t.estado === 'en-curso');
          if (enCurso.length === 0) return of(0);

          const consultas = enCurso.map((t) =>
            combineLatest([
              this.miParticipacion(t.id),
              this.miPick(t.id, t.jornadaActual),
              this.competiciones.jornadaPorNumero(t.competicionId, t.jornadaActual),
            ]).pipe(
              map(([yo, pick, j]): number => {
                if (!yo?.vivo || pick) return 0;
                if (!j || j.estado !== 'abierta') return 0;
                const cierra = fechaJornada(j);
                return !cierra || cierra.getTime() > Date.now() ? 1 : 0;
              }),
            ),
          );

          return combineLatest(consultas).pipe(
            map((n: number[]) => n.reduce((a: number, b: number) => a + b, 0)),
          );
        }),
      );
    }),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  // ---------- Administración (escritura directa, protegida por reglas) ----------

  crearTorneo(datos: {
    nombre: string;
    competicionId: string;
    competicionNombre: string;
    jornadaInicial: number;
    vidas: number;
    costoEntrada: number;
    porcentajeBote: number;
    cierreInscripcion: Date;
    modo: ModoTorneo;
    jornadas: number;
    vidaCubre: 'empate' | 'tropiezo';
    permiteRevivir: boolean;
  }): Promise<unknown> {
    const codigo = this.generarCodigo();
    return addDoc(collection(this.db, 'torneos'), {
      ...datos,
      codigo,
      estado: 'inscripcion',
      jornadaActual: datos.jornadaInicial,
      bolsa: 0,
      gestores: [],
      createdAt: serverTimestamp(),
    });
  }

  /** Da o quita permisos de gestión sobre un torneo. */
  cambiarGestor(torneoId: string, uid: string, agregar: boolean) {
    return updateDoc(doc(this.db, 'torneos', torneoId), {
      gestores: agregar ? arrayUnion(uid) : arrayRemove(uid),
    });
  }

  cambiarEstado(torneoId: string, estado: Torneo['estado']) {
    return updateDoc(doc(this.db, 'torneos', torneoId), { estado });
  }

  // ---------- Acciones del servidor ----------

  /** Datos básicos del torneo detrás de un código de invitación. */
  async consultar(codigo: string): Promise<{
    nombre: string;
    modo: ModoTorneo;
    competicionNombre: string;
    costoEntrada: number;
    jornadaInicial: number;
    jornadas: number;
    vidas: number;
    vidaCubre: 'empate' | 'tropiezo';
    permiteRevivir: boolean;
    estado: string;
    inscritos: number;
  }> {
    const fn = httpsCallable<
      { codigo: string },
      {
        ok: boolean;
        nombre: string;
        modo: ModoTorneo;
        competicionNombre: string;
        costoEntrada: number;
        jornadaInicial: number;
        jornadas: number;
        vidas: number;
        vidaCubre: 'empate' | 'tropiezo';
        permiteRevivir: boolean;
        estado: string;
        inscritos: number;
      }
    >(this.fns, 'consultarTorneo');
    const res = await fn({ codigo });
    return res.data;
  }

  async unirse(codigo: string): Promise<{ torneoId: string; yaEstaba: boolean; costo: number }> {
    const fn = httpsCallable<
      { codigo: string },
      { ok: boolean; torneoId: string; yaEstaba: boolean; costo: number }
    >(this.fns, 'unirseTorneo');
    const res = await fn({ codigo });
    return res.data;
  }

  /** Envía los marcadores pronosticados de toda la jornada. */
  async guardarQuiniela(
    torneoId: string,
    marcadores: Array<{ local: number; visitante: number }>,
  ): Promise<void> {
    const fn = httpsCallable<
      { torneoId: string; marcadores: Array<{ local: number; visitante: number }> },
      { ok: boolean }
    >(this.fns, 'guardarQuiniela');
    await fn({ torneoId, marcadores });
  }

  async elegir(torneoId: string, equipo: string): Promise<void> {
    const fn = httpsCallable<{ torneoId: string; equipo: string }, { ok: boolean }>(
      this.fns,
      'guardarPick',
    );
    await fn({ torneoId, equipo });
  }

  /** Cierra el torneo repartiendo la bolsa entre quienes sigan vivos. */
  async finalizar(torneoId: string): Promise<{ ganadores: number; premioPorCabeza: number }> {
    const fn = httpsCallable<
      { torneoId: string },
      { ok: boolean; ganadores: number; premioPorCabeza: number }
    >(this.fns, 'finalizarTorneo');
    const res = await fn({ torneoId });
    return res.data;
  }

  private generarCodigo(): string {
    const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () =>
      letras.charAt(Math.floor(Math.random() * letras.length)),
    ).join('');
  }

  /** Revive en un torneo de supervivencia que lo permita. */
  async revivir(torneoId: string): Promise<{ costo: number; jornada: number }> {
    const fn = httpsCallable<
      { torneoId: string },
      { ok: boolean; costo: number; jornada: number }
    >(this.fns, 'revivir');
    const res = await fn({ torneoId });
    return { costo: res.data.costo, jornada: res.data.jornada };
  }
}