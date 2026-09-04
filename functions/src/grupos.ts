/* ============================================================
   GRUPOS (competencias privadas)
   Los puntos son globales; el grupo es solo organización.
   ============================================================ */

import { onCall } from 'firebase-functions/v2/https';
import { db, opcionesCall, FieldValue, HttpsError } from './comun';

/** Genera un código corto de invitación (6 letras/números, sin ambiguos). */
function generarCodigoGrupo(): string {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I, O, 0, 1
    let c = '';
    for (let i = 0; i < 6; i++) c += abc[Math.floor(Math.random() * abc.length)];
    return c;
}

/**
 * ¿Es este usuario administrador del grupo? Un grupo puede tener varios
 * admins (adminUids). Se respeta el adminUid antiguo para grupos creados
 * antes de que existiera el array.
 *
 * Exportado: lo usan también torneos, partidos y brackets.
 */
export function esAdminDeGrupo(grupo: Record<string, unknown> | undefined, uid: string): boolean {
    if (!grupo) return false;
    const lista = grupo['adminUids'];
    if (Array.isArray(lista) && lista.length > 0) return lista.includes(uid);
    return grupo['adminUid'] === uid;
}

/** Crea un grupo. Solo lo puede hacer un "admin de grupo". */
export const crearGrupo = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const nombre = String(req.data?.nombre ?? '').trim();
    const icono = String(req.data?.icono ?? '⚽').trim();
    if (nombre.length < 3) {
        throw new HttpsError('invalid-argument', 'El nombre del grupo es muy corto.');
    }

    const userRef = db.doc(`users/${uid}`);
    const userSnap = await userRef.get();
    const u = userSnap.data();
    if (!u) {
        throw new HttpsError('not-found', 'No encontramos tu perfil.');
    }
    if (u['esAdminGrupo'] !== true) {
        throw new HttpsError('permission-denied', 'No tienes permiso para crear grupos.');
    }

    // Genera un código único (reintenta si choca).
    let codigo = generarCodigoGrupo();
    for (let intento = 0; intento < 5; intento++) {
        const existe = await db.collection('grupos').where('codigo', '==', codigo).limit(1).get();
        if (existe.empty) break;
        codigo = generarCodigoGrupo();
    }

    const grupoRef = db.collection('grupos').doc();
    const alias = String(u['alias'] ?? 'Jugador');

    await grupoRef.set({
        nombre,
        icono,
        codigo,
        adminUid: uid,
        adminUids: [uid],
        miembrosCount: 1,
        createdAt: FieldValue.serverTimestamp(),
    });
    // El creador es el primer miembro, con rol admin.
    await grupoRef.collection('miembros').doc(uid).set({
        uid,
        alias,
        rol: 'admin',
        entradaAt: FieldValue.serverTimestamp(),
    });
    // Índice inverso en el usuario.
    await userRef.update({ grupos: FieldValue.arrayUnion(grupoRef.id) });

    return { ok: true, grupoId: grupoRef.id, codigo };
});

/** Une al usuario a un grupo usando su código de invitación. */
export const unirseAGrupo = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const codigo = String(req.data?.codigo ?? '').trim().toUpperCase();
    if (!codigo) {
        throw new HttpsError('invalid-argument', 'Falta el código.');
    }

    const encontrados = await db.collection('grupos').where('codigo', '==', codigo).limit(1).get();
    if (encontrados.empty) {
        throw new HttpsError('not-found', 'No hay ningún grupo con ese código.');
    }
    const grupoDoc = encontrados.docs[0];
    const grupoRef = grupoDoc.ref;

    const miembroRef = grupoRef.collection('miembros').doc(uid);
    if ((await miembroRef.get()).exists) {
        throw new HttpsError('already-exists', 'Ya perteneces a este grupo.');
    }

    const userRef = db.doc(`users/${uid}`);
    const u = (await userRef.get()).data();
    const alias = String(u?.['alias'] ?? 'Jugador');

    await miembroRef.set({
        uid,
        alias,
        rol: 'miembro',
        entradaAt: FieldValue.serverTimestamp(),
    });
    await grupoRef.update({ miembrosCount: FieldValue.increment(1) });
    await userRef.update({ grupos: FieldValue.arrayUnion(grupoRef.id) });

    return {
        ok: true,
        grupoId: grupoRef.id,
        nombre: grupoDoc.data()['nombre'],
        icono: grupoDoc.data()['icono'] ?? '⚽',
    };
});

/** El admin de un grupo agrega manualmente a un usuario por su uid. */
export const agregarMiembroGrupo = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const grupoId = String(req.data?.grupoId ?? '');
    const nuevoUid = String(req.data?.uid ?? '');
    if (!grupoId || !nuevoUid) {
        throw new HttpsError('invalid-argument', 'Faltan datos.');
    }

    const grupoRef = db.doc(`grupos/${grupoId}`);
    const grupo = (await grupoRef.get()).data();
    if (!grupo) {
        throw new HttpsError('not-found', 'El grupo no existe.');
    }
    if (!esAdminDeGrupo(grupo, uid)) {
        throw new HttpsError('permission-denied', 'Solo un administrador del grupo puede agregar miembros.');
    }

    const miembroRef = grupoRef.collection('miembros').doc(nuevoUid);
    if ((await miembroRef.get()).exists) {
        throw new HttpsError('already-exists', 'Esa persona ya está en el grupo.');
    }
    const nuevoUser = (await db.doc(`users/${nuevoUid}`).get()).data();
    if (!nuevoUser) {
        throw new HttpsError('not-found', 'No encontramos a esa persona.');
    }

    await miembroRef.set({
        uid: nuevoUid,
        alias: String(nuevoUser['alias'] ?? 'Jugador'),
        rol: 'miembro',
        entradaAt: FieldValue.serverTimestamp(),
    });
    await grupoRef.update({ miembrosCount: FieldValue.increment(1) });
    await db.doc(`users/${nuevoUid}`).update({ grupos: FieldValue.arrayUnion(grupoId) });

    return { ok: true };
});

/**
 * Saca al usuario de un grupo. Si es el admin, debe pasar el uid de quien
 * hereda el rol (nuevoAdminUid); si es el único miembro, el grupo se elimina.
 */
export const salirDeGrupo = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const grupoId = String(req.data?.grupoId ?? '');
    const nuevoAdminUid = String(req.data?.nuevoAdminUid ?? '');
    if (!grupoId) {
        throw new HttpsError('invalid-argument', 'Falta el grupo.');
    }

    const grupoRef = db.doc(`grupos/${grupoId}`);
    const grupo = (await grupoRef.get()).data();
    if (!grupo) {
        throw new HttpsError('not-found', 'El grupo no existe.');
    }
    const miembroRef = grupoRef.collection('miembros').doc(uid);
    if (!(await miembroRef.get()).exists) {
        throw new HttpsError('not-found', 'No perteneces a este grupo.');
    }

    const soyAdmin = esAdminDeGrupo(grupo, uid);
    const total = Number(grupo['miembrosCount'] ?? 1);
    const adminsActuales: string[] = Array.isArray(grupo['adminUids'])
        ? (grupo['adminUids'] as string[])
        : grupo['adminUid']
          ? [String(grupo['adminUid'])]
          : [];
    const otrosAdmins = adminsActuales.filter((a) => a !== uid);

    // Si soy el único miembro, el grupo se elimina.
    if (total <= 1) {
        await miembroRef.delete();
        await grupoRef.delete();
        await db.doc(`users/${uid}`).update({
            grupos: FieldValue.arrayRemove(grupoId),
            gruposFavoritos: FieldValue.arrayRemove(grupoId),
        });
        return { ok: true, eliminado: true };
    }

    // Si soy admin y NO queda ningún otro admin, hay que transferir el rol
    // antes de salir. Si ya hay otros admins, puedo salir sin más.
    if (soyAdmin && otrosAdmins.length === 0) {
        if (!nuevoAdminUid) {
            throw new HttpsError('failed-precondition', 'Debes dejar a alguien a cargo antes de salir.');
        }
        const nuevoRef = grupoRef.collection('miembros').doc(nuevoAdminUid);
        if (!(await nuevoRef.get()).exists) {
            throw new HttpsError('not-found', 'La persona que elegiste no está en el grupo.');
        }
        await nuevoRef.update({ rol: 'admin' });
        await grupoRef.update({
            adminUid: nuevoAdminUid,
            adminUids: FieldValue.arrayUnion(nuevoAdminUid),
        });
    }

    await miembroRef.delete();
    await grupoRef.update({
        miembrosCount: FieldValue.increment(-1),
        // Me quito de la lista de admins. Si yo era el adminUid principal,
        // lo paso a otro admin que quede (o al sucesor recién nombrado).
        adminUids: FieldValue.arrayRemove(uid),
        ...(grupo['adminUid'] === uid && otrosAdmins.length > 0
            ? { adminUid: otrosAdmins[0] }
            : {}),
    });
    await db.doc(`users/${uid}`).update({
        grupos: FieldValue.arrayRemove(grupoId),
        gruposFavoritos: FieldValue.arrayRemove(grupoId),
    });

    return { ok: true, eliminado: false };
});

/**
 * Nombra administrador a otro miembro del grupo. Solo un admin actual puede
 * hacerlo. Suma al array de admins y marca su rol como 'admin' (para el badge).
 */
export const hacerAdminGrupo = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const grupoId = String(req.data?.grupoId ?? '');
    const nuevoUid = String(req.data?.uid ?? '');
    if (!grupoId || !nuevoUid) throw new HttpsError('invalid-argument', 'Faltan datos.');

    const grupoRef = db.doc(`grupos/${grupoId}`);
    const grupo = (await grupoRef.get()).data();
    if (!grupo) throw new HttpsError('not-found', 'El grupo no existe.');
    if (!esAdminDeGrupo(grupo, uid)) {
        throw new HttpsError('permission-denied', 'Solo un administrador del grupo puede nombrar a otros.');
    }

    const miembroRef = grupoRef.collection('miembros').doc(nuevoUid);
    if (!(await miembroRef.get()).exists) {
        throw new HttpsError('not-found', 'Esa persona no está en el grupo.');
    }

    await miembroRef.update({ rol: 'admin' });
    await grupoRef.update({ adminUids: FieldValue.arrayUnion(nuevoUid) });
    return { ok: true };
});

/**
 * Le quita el rol de administrador a un miembro. Solo un admin actual puede
 * hacerlo. No se permite dejar al grupo sin ningún administrador.
 */
export const quitarAdminGrupo = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');

    const grupoId = String(req.data?.grupoId ?? '');
    const quitarUid = String(req.data?.uid ?? '');
    if (!grupoId || !quitarUid) throw new HttpsError('invalid-argument', 'Faltan datos.');

    const grupoRef = db.doc(`grupos/${grupoId}`);
    const grupo = (await grupoRef.get()).data();
    if (!grupo) throw new HttpsError('not-found', 'El grupo no existe.');
    if (!esAdminDeGrupo(grupo, uid)) {
        throw new HttpsError('permission-denied', 'Solo un administrador del grupo puede quitar el rol.');
    }

    const adminsActuales: string[] = Array.isArray(grupo['adminUids'])
        ? (grupo['adminUids'] as string[])
        : grupo['adminUid']
          ? [String(grupo['adminUid'])]
          : [];
    if (!adminsActuales.includes(quitarUid)) {
        throw new HttpsError('failed-precondition', 'Esa persona no es administradora.');
    }
    if (adminsActuales.length <= 1) {
        throw new HttpsError('failed-precondition', 'El grupo debe tener al menos un administrador.');
    }

    const miembroRef = grupoRef.collection('miembros').doc(quitarUid);
    await miembroRef.update({ rol: 'miembro' });
    const patch: Record<string, unknown> = { adminUids: FieldValue.arrayRemove(quitarUid) };
    // Si quitamos al admin principal, pasamos ese puesto a otro que quede.
    if (grupo['adminUid'] === quitarUid) {
        patch['adminUid'] = adminsActuales.find((a) => a !== quitarUid) ?? uid;
    }
    await grupoRef.update(patch);
    return { ok: true };
});

/** Marca o desmarca un grupo como favorito para el usuario. */
export const marcarGrupoFavorito = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const grupoId = String(req.data?.grupoId ?? '');
    const favorito = req.data?.favorito === true;
    if (!grupoId) {
        throw new HttpsError('invalid-argument', 'Falta el grupo.');
    }

    const userRef = db.doc(`users/${uid}`);
    await userRef.update({
        gruposFavoritos: favorito ? FieldValue.arrayUnion(grupoId) : FieldValue.arrayRemove(grupoId),
    });

    return { ok: true };
});

/**
 * Busca usuarios por alias para que un admin de grupo pueda agregarlos.
 * Devuelve SOLO datos públicos (uid + alias), nunca el correo, para no
 * exponer información privada. Requiere que el llamante sea admin de grupo.
 */
export const buscarUsuariosPorAlias = onCall(opcionesCall, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
        throw new HttpsError('unauthenticated', 'Necesitas iniciar sesión.');
    }
    const texto = String(req.data?.texto ?? '').trim();
    if (texto.length < 2) {
        throw new HttpsError('invalid-argument', 'Escribe al menos 2 letras.');
    }

    // Solo un admin de grupo puede buscar personas.
    const yo = (await db.doc(`users/${uid}`).get()).data();
    if (yo?.['esAdminGrupo'] !== true) {
        throw new HttpsError('permission-denied', 'No tienes permiso para buscar usuarios.');
    }

    // Búsqueda case-insensitive por "contiene". Firestore no soporta
    // búsquedas insensibles a mayúsculas de forma nativa, así que traemos los
    // usuarios validados y filtramos en memoria con el texto en minúsculas.
    // El volumen es bajo (solo lo usa un admin de grupo para agregar gente),
    // así que un límite generoso es suficiente y evita migrar datos.
    const buscado = texto.toLowerCase();
    const snap = await db
        .collection('users')
        .where('validada', '==', true)
        .limit(500)
        .get();

    const resultados = snap.docs
        .map((d) => ({ uid: d.id, alias: String(d.data()['alias'] ?? '') }))
        .filter((r) => r.uid !== uid && r.alias.toLowerCase().includes(buscado))
        // Primero los que empiezan con el texto, luego el resto; ambos por alias.
        .sort((a, b) => {
            const aEmpieza = a.alias.toLowerCase().startsWith(buscado) ? 0 : 1;
            const bEmpieza = b.alias.toLowerCase().startsWith(buscado) ? 0 : 1;
            if (aEmpieza !== bEmpieza) return aEmpieza - bEmpieza;
            return a.alias.localeCompare(b.alias, 'es');
        })
        .slice(0, 10);

    return { usuarios: resultados };
});
