import { Injectable, inject } from '@angular/core';
import { Auth, user } from '@angular/fire/auth';
import { Firestore, doc, docData } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { switchMap, map, catchError, shareReplay } from 'rxjs/operators';
import { AppUser } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class UserService {
    private readonly auth = inject(Auth);
    private readonly db = inject(Firestore);

    readonly me$: Observable<AppUser | null> = user(this.auth).pipe(
        switchMap((u) => {
            if (!u) return of(null);
            return docData(doc(this.db, 'users', u.uid), { idField: 'id' }).pipe(
                map((d) => (d as AppUser) ?? null),
                catchError(() => of(null)),
            );
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
    );

    readonly isAdmin$: Observable<boolean> = user(this.auth).pipe(
        switchMap((u) => {
            if (!u) return of(false);
            return docData(doc(this.db, 'admins', u.uid)).pipe(
                map((d) => !!d),
                catchError(() => of(false)),
            );
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
    );
}