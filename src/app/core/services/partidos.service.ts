import { Injectable, inject } from '@angular/core';
import { Firestore, collection, collectionData } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { Partido } from '../models/partido.model';

@Injectable({ providedIn: 'root' })
export class PartidosService {
    private readonly db = inject(Firestore);

    /** Stream en tiempo real de la colección `partidos`. */
    getPartidos(): Observable<Partido[]> {
        const ref = collection(this.db, 'partidos');
        return collectionData(ref, { idField: 'id' }) as Observable<Partido[]>;
    }
}