/**
 * Helpers compartidos por los scripts de prueba de flujo
 * (prueba-survivor.js, prueba-quiniela.js, prueba-bracket-pronostico.js,
 * prueba-bracket-duenos.js).
 *
 * Igual que prueba-partido.js: usa el Admin SDK para preparar datos y leer
 * saldos, y el SDK cliente para llamar a las Cloud Functions autenticándose
 * como cada usuario (como lo hace la app real).
 *
 * REQUISITOS (mismos que prueba-partido.js):
 *   scripts/service-account-dev.json  (Admin SDK)
 *   scripts/config-dev.json           ({ apiKey, projectId })
 *   Usuarios de prueba creados: node scripts/seed-dev.js seed
 *
 * SEGURIDAD: se niega a correr si el projectId no contiene 'dev'.
 */

const { initializeApp: initializeAdminApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const path = require('path');

const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { getFunctions, httpsCallable } = require('firebase/functions');

// ── Credenciales ─────────────────────────────────────────────────────
let serviceAccount, configPublica;
try {
  serviceAccount = require(path.join(__dirname, 'service-account-dev.json'));
  configPublica = require(path.join(__dirname, 'config-dev.json'));
} catch (e) {
  console.error('\n❌ Falta service-account-dev.json o config-dev.json en scripts/.');
  console.error('   Revisa las instrucciones al inicio de prueba-partido.js.\n');
  process.exit(1);
}

// ── Candado anti-producción ──────────────────────────────────────────
const projectId = serviceAccount.project_id || '';
if (!projectId.includes('dev')) {
  console.error(`\n🛑 ALTO: projectId "${projectId}" no parece DEV. Abortando.\n`);
  process.exit(1);
}

// Admin SDK (una sola vez aunque varios scripts lo requieran).
if (getApps().length === 0) {
  initializeAdminApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();
const authAdmin = getAdminAuth();

// SDK cliente (login + llamar funciones como usuario).
const appCliente = initializeApp(configPublica);
const authCliente = getAuth(appCliente);
const functions = getFunctions(appCliente); // us-central1 por defecto (igual que las functions)

const PASSWORD = 'prueba1234';

// ── Helpers ──────────────────────────────────────────────────────────

/** Lee saldo y uid de un usuario por email (Admin SDK). */
async function saldoDe(email) {
  const u = await authAdmin.getUserByEmail(email);
  const snap = await db.doc(`users/${u.uid}`).get();
  return { uid: u.uid, puntos: Number(snap.data()?.['puntos'] ?? 0) };
}

/** uid de un usuario por email. */
async function uidDe(email) {
  return (await authAdmin.getUserByEmail(email)).uid;
}

/** Llama a una función autenticándose como el usuario dado. */
async function comoUsuario(email, nombreFn, datos) {
  await signInWithEmailAndPassword(authCliente, email, PASSWORD);
  try {
    const fn = httpsCallable(functions, nombreFn);
    const res = await fn(datos);
    return res.data;
  } finally {
    await signOut(authCliente);
  }
}

/** Aserción con log. Devuelve el booleano para poder acumular. */
function ok(cond, msg) {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`);
  return cond;
}

/**
 * Crea una competición de prueba con UNA jornada abierta lista para picks/
 * quiniela. Devuelve { competicionId, jornadaId, partidos }.
 * Los partidos van SIN resultado (se capturan luego con resolverJornada()).
 * cierraAt en el futuro para que guardarPick/guardarQuiniela lo acepten.
 */
async function crearCompeticionConJornada(partidos, { numero = 1 } = {}) {
  const compRef = await db.collection('competiciones').add({
    nombre: 'Liga de Prueba (auto)',
    gestores: [],
    esPrueba: true,
  });
  const jornadaRef = await compRef.collection('jornadas').add({
    numero,
    estado: 'abierta',
    cierraAt: Timestamp.fromMillis(Date.now() + 3 * 60 * 60 * 1000), // futuro
    partidos: partidos.map((p) => ({
      local: p.local,
      visitante: p.visitante,
      resultado: null,
      golesLocal: null,
      golesVisitante: null,
    })),
    esPrueba: true,
  });
  return { competicionId: compRef.id, jornadaId: jornadaRef.id, jornadaRef };
}

/**
 * Captura los resultados de la jornada (Admin SDK) dejándola lista para que
 * resolverJornadaCompeticion la procese. `resultados` es un array paralelo a
 * los partidos: [{ resultado:'local'|'empate'|'visitante', golesLocal, golesVisitante }].
 */
async function capturarResultadosJornada(jornadaRef, resultados) {
  const snap = await jornadaRef.get();
  const partidos = (snap.data()?.partidos ?? []).map((p, i) => ({
    ...p,
    resultado: resultados[i].resultado,
    golesLocal: resultados[i].golesLocal ?? null,
    golesVisitante: resultados[i].golesVisitante ?? null,
  }));
  await jornadaRef.update({ partidos });
}

/** Fuerza un torneo a 'en-curso' (evita esperar el scheduler cerrarInscripciones). */
async function arrancarTorneo(torneoId) {
  await db.doc(`torneos/${torneoId}`).update({ estado: 'en-curso' });
}

/** Fuerza un bracket a 'en-curso' (evita esperar el scheduler cerrarBrackets). */
async function arrancarBracket(bracketId) {
  await db.doc(`brackets/${bracketId}`).update({ estado: 'en-curso' });
}

/** Marca como esPrueba lo que se creó vía función (para que el limpiar lo borre). */
async function marcarPrueba(coleccion, id) {
  await db.doc(`${coleccion}/${id}`).set({ esPrueba: true }, { merge: true });
}

// ── Helpers para pruebas AVANZADAS (casos difíciles / negativos) ───────

/**
 * Espera que `fn()` LANCE un HttpsError con el código dado (p. ej.
 * 'failed-precondition', 'permission-denied', 'invalid-argument',
 * 'not-found', 'unauthenticated'). Devuelve true si el error llegó con
 * el código correcto; false si no hubo error o el código no coincide.
 *
 * El SDK cliente envuelve el error de la función: el código llega como
 * `functions/<codigo>` en err.code, así que comparamos por sufijo.
 */
async function esperarError(fn, codigoEsperado, etiqueta) {
  try {
    await fn();
    console.log(`  ❌ ${etiqueta}: se esperaba error "${codigoEsperado}" pero NO falló.`);
    return false;
  } catch (e) {
    const code = String(e?.code ?? '');
    // httpsCallable devuelve p.ej. 'functions/failed-precondition'.
    const coincide = code === codigoEsperado || code.endsWith(`/${codigoEsperado}`);
    if (coincide) {
      console.log(`  ✅ ${etiqueta}: falló como se esperaba (${codigoEsperado}).`);
    } else {
      console.log(
        `  ❌ ${etiqueta}: falló pero con código "${code}" (esperaba "${codigoEsperado}"). ` +
        `Mensaje: ${e?.message ?? e}`,
      );
    }
    return coincide;
  }
}

/** Crea un partido individual de prueba directamente (Admin SDK), abierto. */
async function crearPartido({
  local = 'América',
  visitante = 'Guadalajara',
  porcentajeBote = 0,
  minutosParaCerrar = 60,
  type = '1x2',
} = {}) {
  const ref = await db.collection('partidos').add({
    competition: 'Prueba Avanzada (auto)',
    homeTeam: local,
    awayTeam: visitante,
    type,
    status: 'abierto',
    closesAt: Timestamp.fromMillis(Date.now() + minutosParaCerrar * 60 * 1000),
    porcentajeBote,
    liquidado: false,
    createdAt: FieldValue.serverTimestamp(),
    esPrueba: true,
  });
  return ref.id;
}

/** Fija el saldo (puntos y puntosHistoricos) de un usuario por email. Útil para
 *  probar el tope inferior sin depender del saldo con el que quedó de otra prueba. */
async function fijarSaldo(email, puntos) {
  const uid = await uidDe(email);
  await db.doc(`users/${uid}`).set(
    { puntos, puntosHistoricos: puntos, bloqueado: puntos - 100 < -1000 },
    { merge: true },
  );
  return uid;
}

/** Fuerza el estado / hora de cierre de un partido (para simular cierre o liquidado). */
async function ajustarPartido(partidoId, campos) {
  await db.doc(`partidos/${partidoId}`).set(campos, { merge: true });
}

/** Total acumulado en el bote del sistema (sistema/reserva.total). */
async function leerReserva() {
  const snap = await db.doc('sistema/reserva').get();
  return Number(snap.data()?.['total'] ?? 0);
}

/** Cuenta cuántos movimientos de un tipo tiene un usuario en el ledger. */
async function contarLedger(uid, tipo) {
  const snap = await db
    .collection('ledger')
    .where('uid', '==', uid)
    .where('tipo', '==', tipo)
    .get();
  return snap.size;
}

/** Lee el documento de participante de un torneo. */
async function participanteDe(torneoId, uid) {
  const snap = await db.doc(`torneos/${torneoId}/participantes/${uid}`).get();
  return snap.exists ? snap.data() : null;
}

/** Fuerza la jornada actual de un torneo (para simular la ventana de revivir). */
async function fijarJornadaTorneo(torneoId, jornadaActual) {
  await db.doc(`torneos/${torneoId}`).update({ jornadaActual });
}

/** Crea un bracket de prueba directamente (Admin SDK). Devuelve su id.
 *  Pensado para pruebas de modo dueños: llaves mínimas de 2 equipos. */
async function crearBracketDuenos({
  nombre = 'Bracket Dueños (auto)',
  costoEntrada = 100,
  porcentajeBote = 0,
  equipos = ['América', 'Guadalajara'],
} = {}) {
  // Un cuadro mínimo: una sola llave (final) con dos equipos.
  const llaves = [
    {
      id: 'r0p0',
      ronda: 0,
      posicion: 0,
      local: { nombre: equipos[0] },
      visitante: { nombre: equipos[1] },
      partidos: [{ golesLocal: null, golesVisitante: null }],
      ganador: null,
    },
  ];
  const ref = await db.collection('brackets').add({
    nombre,
    modo: 'duenos',
    estado: 'inscripcion',
    config: { equipos: 2, avance: 'fijo', reparto: [100], armado: 'manual', desempateFinal: 'penales', desempateRondas: 'penales' },
    puntaje: { avanzaPorRonda: [10], campeon: 20, finalista: 10, marcadorExacto: 5, marcadorResultado: 3 },
    llaves,
    equipos: equipos.map((n) => ({ nombre: n })),
    duenos: [],
    costoEntrada,
    porcentajeBote,
    bolsa: 0,
    gestores: [],
    codigo: Math.random().toString(36).slice(2, 8).toUpperCase(),
    creadoPor: 'seed-prueba',
    cierraAt: Timestamp.fromMillis(Date.now() + 3 * 60 * 60 * 1000),
    createdAt: FieldValue.serverTimestamp(),
    esPrueba: true,
  });
  return ref.id;
}

/** Lee un bracket. */
async function leerBracket(bracketId) {
  const snap = await db.doc(`brackets/${bracketId}`).get();
  return snap.exists ? snap.data() : null;
}

/**
 * Crea (o reusa) un usuario de Auth de prueba SIN validar (validada:false),
 * con la contraseña estándar, para probar la guarda de cuenta no validada.
 * Marcado esPrueba para que el limpiar lo borre. Devuelve { uid, email }.
 */
async function crearUsuarioSinValidar(sufijo = 'sinvalidar') {
  const email = `prueba_${sufijo}@quiniela.test`;
  let uid;
  try {
    const u = await authAdmin.createUser({ email, password: PASSWORD, displayName: `Prueba ${sufijo}` });
    uid = u.uid;
  } catch (e) {
    if (e.code === 'auth/email-already-exists') {
      uid = (await authAdmin.getUserByEmail(email)).uid;
    } else {
      throw e;
    }
  }
  await db.doc(`users/${uid}`).set(
    {
      email,
      alias: `Prueba ${sufijo}`,
      rol: 'user',
      validada: false, // <- la clave de esta prueba
      bloqueado: false,
      puntos: 5000,
      puntosHistoricos: 5000,
      esPrueba: true,
    },
    { merge: true },
  );
  return { uid, email };
}

module.exports = {
  projectId,
  db,
  FieldValue,
  Timestamp,
  saldoDe,
  uidDe,
  comoUsuario,
  ok,
  crearCompeticionConJornada,
  capturarResultadosJornada,
  arrancarTorneo,
  arrancarBracket,
  marcarPrueba,
  // Helpers de pruebas avanzadas:
  esperarError,
  crearPartido,
  fijarSaldo,
  ajustarPartido,
  leerReserva,
  contarLedger,
  participanteDe,
  fijarJornadaTorneo,
  crearBracketDuenos,
  leerBracket,
  crearUsuarioSinValidar,
  PASSWORD,
};
