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
};
