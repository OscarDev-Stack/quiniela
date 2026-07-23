import { Injectable, inject } from '@angular/core';
import {
    Firestore,
    collection,
    collectionData,
    query,
    where,
    orderBy,
    limit,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Trofeo } from '../models/trofeo.model';

export interface ResumenMovimientos {
    totalApostado: number;
    mejorPremio: number;
    movimientos: number;
}

@Injectable({ providedIn: 'root' })
export class PerfilService {
    private readonly db = inject(Firestore);
    private readonly fns = inject(Functions);

    /** Torneos ganados por alguien. Público: sirve para perfiles ajenos. */
    trofeos(uid: string): Observable<Trofeo[]> {
        const q = query(collection(this.db, 'trofeos'), where('uid', '==', uid));
        return collectionData(q, { idField: 'id' }) as Observable<Trofeo[]>;
    }

    /**
     * Resumen de mis movimientos. Solo funciona con la propia cuenta,
     * porque el ledger es privado por reglas de Firestore.
     */
    resumen(uid: string): Observable<ResumenMovimientos> {
        const q = query(
            collection(this.db, 'ledger'),
            where('uid', '==', uid),
            orderBy('createdAt', 'desc'),
            limit(300),
        );

        return (collectionData(q) as Observable<Array<{ monto?: number; tipo?: string }>>).pipe(
            map((movs) => {
                let totalApostado = 0;
                let mejorPremio = 0;

                for (const m of movs) {
                    const monto = Number(m.monto ?? 0);
                    if (monto < 0) totalApostado += Math.abs(monto);
                    if (monto > mejorPremio) mejorPremio = monto;
                }

                return { totalApostado, mejorPremio, movimientos: movs.length };
            }),
        );
    }

    /** Pide el enlace para conectar Telegram con un toque. */
    async vincularTelegram(): Promise<string> {
        const fn = httpsCallable<Record<string, never>, { ok: boolean; enlace: string }>(
            this.fns,
            'vincularTelegram',
        );
        const res = await fn({} as Record<string, never>);
        return res.data.enlace;
    }

    /** Activa o desactiva los avisos sin tocar la conexión. */
    async guardarTelegram(chatId: string, activo: boolean): Promise<{ prueba: boolean }> {
        const fn = httpsCallable<
            { chatId: string; activo: boolean },
            { ok: boolean; activo: boolean; prueba: boolean }
        >(this.fns, 'guardarTelegram');
        const res = await fn({ chatId, activo });
        return { prueba: res.data.prueba };
    }

    /** Pide que le reinicien el saldo. */
    async solicitarReinicio(): Promise<void> {
        const fn = httpsCallable<Record<string, never>, { ok: boolean }>(
            this.fns,
            'solicitarReinicio',
        );
        await fn({} as Record<string, never>);
    }
}