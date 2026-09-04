/* ============================================================
   USUARIOS y RANKING (administración de cuentas y tabla global)
   Funciones onCall extraídas del index.ts. El helper transversal
   actualizarRanking vive en ./comun (lo usan muchos dominios).
   ============================================================ */

import { onCall } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import {
    db,
    opcionesCall,
    MIN_RESUELTOS,
    FieldValue,
    HttpsError,
    actualizarRanking,
} from './comun';

/* Regenera todo el ranking de una vez (útil la primera vez). */
export const recalcularRanking = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) {
        throw new HttpsError('permission-denied', 'Solo un administrador.');
    }

    const users = await db.collection('users').get();
    let escritos = 0;
    const batch = db.batch();

    users.docs.forEach((d) => {
        const u = d.data();
        // Mismo criterio que actualizarRanking: fuera los no validados
        // y las cuentas de puro administrador que no compiten.
        if (u['validada'] !== true || u['noParticipa'] === true) {
            batch.delete(db.doc(`ranking/${d.id}`));
            return;
        }
        const resueltos = Number(u['resueltos'] ?? 0);
        const aciertos = Number(u['aciertos'] ?? 0);
        const email = String(u['email'] ?? '');
        const totalGastado = Number(u['totalGastado'] ?? 0);
        const totalGanado = Number(u['totalGanado'] ?? 0);
        batch.set(db.doc(`ranking/${d.id}`), {
            alias: String(u['alias'] ?? '').trim() || email.split('@')[0] || 'jugador',
            puntos: Number(u['puntosHistoricos'] ?? u['puntos'] ?? 0),
            saldo: Number(u['puntos'] ?? 0),
            torneosGanados: Number(u['torneosGanados'] ?? 0),
            aciertos,
            resueltos,
            porcentaje: resueltos > 0 ? Math.round((aciertos / resueltos) * 100) : 0,
            calificado: resueltos >= MIN_RESUELTOS,
            racha: Number(u['racha'] ?? 0),
            mejorRacha: Number(u['mejorRacha'] ?? 0),
            totalGastado,
            totalGanado,
            balance: totalGanado - totalGastado,
            actualizado: FieldValue.serverTimestamp(),
        });
        escritos++;
    });

    await batch.commit();
    return { ok: true, jugadores: escritos };
});

/* ============================================================
   BACKFILL de totales gastado/ganado (admin, una sola vez)
   Recorre TODO el ledger y reconstruye totalGastado y totalGanado
   por usuario, para las cuentas que ya existían antes de que se
   empezaran a acumular estos campos. Luego regenera el ranking.
   Idempotente: siempre parte de cero y reescribe el total exacto.
   ============================================================ */
export const backfillTotales = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) throw new HttpsError('permission-denied', 'Solo un administrador.');

    // Tipos que cuentan como GANANCIA (premios reales).
    const TIPOS_GANADO = new Set(['premio', 'torneo-premio', 'bracket-premio']);
    // Tipos que afectan el GASTO. El signo del monto ya lo resuelve la fórmula
    // (gasto = -monto): en apuestas/entradas el monto es negativo (suma gasto),
    // en devoluciones el monto es positivo (resta gasto).
    const TIPOS_GASTO = new Set([
        'apuesta',
        'apuesta-edicion',
        'torneo-entrada',
        'torneo-revivir',
        'bracket-entrada',
        'devolucion',
        'devolucion-cancelacion',
        'torneo-devolucion',
    ]);

    const totales = new Map<string, { gastado: number; ganado: number }>();
    const acc = (u: string) => {
        let t = totales.get(u);
        if (!t) {
            t = { gastado: 0, ganado: 0 };
            totales.set(u, t);
        }
        return t;
    };

    // Recorre el ledger por páginas para no cargar todo en memoria de golpe.
    const PAGINA = 2000;
    let ultimo: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    for (;;) {
        let q = db.collection('ledger').orderBy('__name__').limit(PAGINA);
        if (ultimo) q = q.startAfter(ultimo);
        const snap = await q.get();
        if (snap.empty) break;

        for (const d of snap.docs) {
            const m = d.data() as Record<string, unknown>;
            const u = String(m['uid'] ?? '');
            // Movimientos del sistema (reserva) y ajustes de admin no cuentan.
            if (!u || u === 'reserva') continue;
            const tipo = String(m['tipo'] ?? '');
            const monto = Number(m['monto'] ?? 0);

            if (TIPOS_GANADO.has(tipo)) {
                acc(u).ganado += monto;
            } else if (TIPOS_GASTO.has(tipo)) {
                // gasto = -monto (monto negativo suma; positivo/devolución resta)
                acc(u).gastado += -monto;
            }
            // 'reinicio', 'bote', 'sobrante' y otros se ignoran.
        }

        ultimo = snap.docs[snap.docs.length - 1];
        if (snap.size < PAGINA) break;
    }

    // Escribe los totales en cada usuario, en lotes.
    const entradas = [...totales.entries()];
    let escritos = 0;
    for (let i = 0; i < entradas.length; i += 400) {
        const batch = db.batch();
        for (const [u, t] of entradas.slice(i, i + 400)) {
            batch.set(
                db.doc(`users/${u}`),
                { totalGastado: Math.max(0, t.gastado), totalGanado: Math.max(0, t.ganado) },
                { merge: true },
            );
            escritos++;
        }
        await batch.commit();
    }

    // Regenera el ranking para que las nuevas columnas queden reflejadas.
    const users = await db.collection('users').get();
    const rank = db.batch();
    users.docs.forEach((d) => {
        const uu = d.data();
        if (uu['validada'] !== true || uu['noParticipa'] === true) {
            rank.delete(db.doc(`ranking/${d.id}`));
            return;
        }
        const resueltos = Number(uu['resueltos'] ?? 0);
        const aciertos = Number(uu['aciertos'] ?? 0);
        const email = String(uu['email'] ?? '');
        const totalGastado = Number(uu['totalGastado'] ?? 0);
        const totalGanado = Number(uu['totalGanado'] ?? 0);
        rank.set(db.doc(`ranking/${d.id}`), {
            alias: String(uu['alias'] ?? '').trim() || email.split('@')[0] || 'jugador',
            puntos: Number(uu['puntosHistoricos'] ?? uu['puntos'] ?? 0),
            saldo: Number(uu['puntos'] ?? 0),
            torneosGanados: Number(uu['torneosGanados'] ?? 0),
            aciertos,
            resueltos,
            porcentaje: resueltos > 0 ? Math.round((aciertos / resueltos) * 100) : 0,
            calificado: resueltos >= MIN_RESUELTOS,
            racha: Number(uu['racha'] ?? 0),
            mejorRacha: Number(uu['mejorRacha'] ?? 0),
            totalGastado,
            totalGanado,
            balance: totalGanado - totalGastado,
            actualizado: FieldValue.serverTimestamp(),
        });
    });
    await rank.commit();

    return { ok: true, usuarios: escritos };
});

/* ============================================================
   REINICIO DE SALDO (admin)
   Pone el saldo del jugador en 0 y DEJA CONSTANCIA en el ledger
   del ajuste, para que el historial no tenga huecos. Todo en una
   transacción: o se hacen las dos cosas o ninguna.
   ============================================================ */
export const reiniciarPuntos = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) {
        throw new HttpsError('permission-denied', 'Solo un administrador.');
    }

    const objetivo = String((req.data as { uid?: string })?.uid ?? '');
    if (!objetivo) {
        throw new HttpsError('invalid-argument', 'Falta el jugador a reiniciar.');
    }

    const ajuste = await db.runTransaction(async (tx) => {
        const userRef = db.doc(`users/${objetivo}`);
        const snap = await tx.get(userRef);
        if (!snap.exists) {
            throw new HttpsError('not-found', 'No existe ese jugador.');
        }
        const saldoAntes = Number(snap.data()?.['puntos'] ?? 0);

        // El ajuste es lo que se suma/resta para llegar a 0. Si tenía -300,
        // el ajuste es +300; si tenía +500, es -500.
        const delta = -saldoAntes;

        tx.update(userRef, { puntos: 0, bloqueado: false });

        // Solo se registra si de verdad hubo cambio de saldo.
        if (delta !== 0) {
            tx.set(db.collection('ledger').doc(), {
                uid: objetivo,
                tipo: 'reinicio',
                monto: delta,
                saldoAntes,
                detalle: 'Reinicio de saldo por administrador',
                porAdmin: uid,
                createdAt: FieldValue.serverTimestamp(),
            });
        }

        return { saldoAntes, delta };
    });

    return { ok: true, ...ajuste };
});

/* ============================================================
   Eliminar usuarios sin validar
   Borra la cuenta de Authentication y sus documentos.
   Por seguridad, solo permite borrar cuentas NO validadas
   y nunca a un administrador.
   ============================================================ */
export const eliminarUsuarios = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) throw new HttpsError('permission-denied', 'Solo un administrador.');

    const uids: string[] = Array.isArray(req.data?.uids) ? req.data.uids : [];
    if (uids.length === 0) {
        throw new HttpsError('invalid-argument', 'No se indicó ningún usuario.');
    }

    let borrados = 0;
    const omitidos: string[] = [];

    for (const destino of uids) {
        if (destino === uid) {
            omitidos.push('tu propia cuenta');
            continue;
        }

        const esAdmin = await db.doc(`admins/${destino}`).get();
        if (esAdmin.exists) {
            omitidos.push('una cuenta de administrador');
            continue;
        }

        const userSnap = await db.doc(`users/${destino}`).get();
        if (userSnap.exists && userSnap.data()?.['validada'] === true) {
            omitidos.push(String(userSnap.data()?.['alias'] ?? destino));
            continue;
        }

        // Documentos primero, luego la cuenta de acceso.
        const batch = db.batch();
        batch.delete(db.doc(`users/${destino}`));
        batch.delete(db.doc(`ranking/${destino}`));
        await batch.commit();

        await getAuth()
            .deleteUser(destino)
            .catch((e) => console.warn(`No se pudo borrar en Auth ${destino}:`, e));

        borrados++;
    }

    return { ok: true, borrados, omitidos };
});

/* ============================================================
   Sincronizar puntos históricos con el saldo
   El campo puntosHistoricos se agregó cuando la app ya llevaba
   actividad, así que a las cuentas viejas les falta lo de antes.
   Esta función los iguala una sola vez. Úsala solo si todavía
   no has reiniciado el saldo de nadie: a partir de ahí los dos
   contadores deben seguir caminos distintos.
   ============================================================ */
export const sincronizarHistoricos = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    const adminSnap = await db.doc(`admins/${uid}`).get();
    if (!adminSnap.exists) throw new HttpsError('permission-denied', 'Solo un administrador.');

    const usuarios = await db.collection('users').get();
    const batch = db.batch();
    const corregidos: string[] = [];

    for (const doc of usuarios.docs) {
        const u = doc.data() as Record<string, unknown>;
        const saldo = Number(u['puntos'] ?? 0);
        const historicos = Number(u['puntosHistoricos'] ?? 0);
        if (saldo === historicos) continue;

        batch.update(doc.ref, { puntosHistoricos: saldo });
        corregidos.push(doc.id);
    }

    await batch.commit();
    if (corregidos.length > 0) await actualizarRanking(corregidos);

    return { ok: true, corregidos: corregidos.length };
});

/* ============================================================
   Cambiar mi alias (nombre público)
   El usuario no puede escribir su propio documento (las reglas solo
   dejan al admin), así que el cambio pasa por aquí. Se propaga al
   ranking para que el nombre nuevo se vea de inmediato.
   ============================================================ */
export const cambiarAlias = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const alias = String(req.data?.alias ?? '').trim();
    if (alias.length < 3) {
        throw new HttpsError('invalid-argument', 'El alias debe tener al menos 3 caracteres.');
    }
    if (alias.length > 20) {
        throw new HttpsError('invalid-argument', 'El alias no puede pasar de 20 caracteres.');
    }

    const userRef = db.doc(`users/${uid}`);
    const snap = await userRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'No encontramos tu perfil.');

    await userRef.update({ alias });
    // Refresca la fila del ranking para que el alias nuevo aparezca ya.
    await actualizarRanking([uid]);

    // Propaga el alias a los grupos del usuario. El alias se copia en cada
    // grupo (miembros y tabla) al inscribirse, así que hay que actualizarlo
    // ahí también; si no, seguiría apareciendo el nombre viejo en los grupos.
    const grupos = (snap.data()?.['grupos'] as string[] | undefined) ?? [];
    for (const grupoId of grupos) {
        // Miembro: siempre existe si el usuario pertenece al grupo. merge para
        // no pisar el resto de sus campos (rol, entradaAt).
        await db
            .doc(`grupos/${grupoId}/miembros/${uid}`)
            .set({ alias }, { merge: true })
            .catch(() => undefined);
        // Tabla: puede no existir aún (si no ha jugado en el grupo). Usamos
        // update para NO crearla vacía; si no existe, el catch lo ignora.
        await db
            .doc(`grupos/${grupoId}/tabla/${uid}`)
            .update({ alias })
            .catch(() => undefined);
    }

    return { ok: true, alias };
});
