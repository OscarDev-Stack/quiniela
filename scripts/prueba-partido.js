/**
 * PRUEBA DE FLUJO — Partido individual (Opción 1B: funciones reales).
 *
 * Simula el ciclo completo SIN navegador, llamando a las Cloud Functions
 * reales autenticándose como cada usuario, igual que lo hace la app:
 *
 *   1. Admin crea un partido.
 *   2. Cinco usuarios pronostican (crearPronostico real, autenticados).
 *   3. Admin cierra y liquida (liquidarPartido real).
 *   4. Se VERIFICA que el reparto de puntos cuadre.
 *
 * Es una prueba de LÓGICA y DINERO: valida las funciones y el reparto,
 * no la interfaz.
 *
 * USO:
 *   node scripts/prueba-partido.js
 *
 * REQUISITOS:
 *   1. scripts/service-account-dev.json   (Admin SDK, para crear el
 *      partido y leer saldos — mismo archivo que el seed).
 *   2. scripts/config-dev.json con la config PÚBLICA de Firebase dev:
 *      { "apiKey": "...", "projectId": "quiniela-dev-d203d" }
 *      (la sacas de environment.ts o de la consola de Firebase).
 *   3. Usuarios de prueba ya creados (corre antes: node scripts/seed-dev.js seed).
 *   4. npm install firebase firebase-admin
 *
 * SEGURIDAD: se niega a correr si el projectId no contiene 'dev'.
 */

const { initializeApp: initializeAdminApp, cert } = require('firebase-admin/app');
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
  console.error('   Revisa las instrucciones al inicio del archivo.\n');
  process.exit(1);
}

// ── Candado anti-producción ──────────────────────────────────────────
const projectId = serviceAccount.project_id || '';
if (!projectId.includes('dev')) {
  console.error(`\n🛑 ALTO: projectId "${projectId}" no parece DEV. Abortando.\n`);
  process.exit(1);
}

// Admin SDK (crear partido, leer saldos).
initializeAdminApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const authAdmin = getAdminAuth();
// SDK cliente (login + llamar funciones como usuario).
const appCliente = initializeApp(configPublica);
const authCliente = getAuth(appCliente);
const functions = getFunctions(appCliente); // us-central1 por defecto

const PASSWORD = 'prueba1234';
const APUESTA_BASE = 100;

// Los 5 jugadores de prueba (creados por el seed) y su pronóstico.
const JUGADORES = [
  { email: 'prueba_a@quiniela.test', resultado: 'local', multiplicador: 1 },
  { email: 'prueba_b@quiniela.test', resultado: 'local', multiplicador: 2 },
  { email: 'prueba_c@quiniela.test', resultado: 'visitante', multiplicador: 1 },
  { email: 'prueba_d@quiniela.test', resultado: 'empate', multiplicador: 1 },
  { email: 'prueba_sinsaldo@quiniela.test', resultado: 'local', multiplicador: 1 },
];

const ADMIN_EMAIL = 'prueba_admin@quiniela.test';
const RESULTADO_OFICIAL = 'local'; // ganan A, B y sinsaldo.

// ── Helpers ──────────────────────────────────────────────────────────

/** Lee el saldo de un usuario por email (vía Admin SDK). */
async function saldoDe(email) {
  const u = await authAdmin.getUserByEmail(email);
  const snap = await db.doc(`users/${u.uid}`).get();
  return { uid: u.uid, puntos: Number(snap.data()?.['puntos'] ?? 0) };
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

function ok(cond, msg) {
  console.log(`  ${cond ? '✅' : '❌'} ${msg}`);
  return cond;
}


// ── La prueba ────────────────────────────────────────────────────────
async function correr() {
  console.log(`\n🧪 Prueba de flujo de partido en ${projectId}\n`);

  // 1. Admin crea el partido (directo a Firestore, como hace la app admin).
  console.log('1) Admin crea el partido...');
  const partRef = await db.collection('partidos').add({
    competition: 'Prueba Automática',
    homeTeam: 'América',
    awayTeam: 'Guadalajara',
    type: '1x2',
    status: 'abierto',
    closesAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
    porcentajeBote: 0, // sin bote para que el reparto sea limpio de verificar.
    liquidado: false,
    createdAt: FieldValue.serverTimestamp(),
    esPrueba: true,
  });
  const partidoId = partRef.id;
  console.log(`   Partido creado: ${partidoId}\n`);

  // Saldos ANTES.
  const antes = {};
  for (const j of JUGADORES) antes[j.email] = (await saldoDe(j.email)).puntos;

  // 2. Cada usuario pronostica (función real).
  console.log('2) Los 5 usuarios pronostican...');
  const apostado = {}; // cuánto apostó cada quien (0 si falló).
  for (const j of JUGADORES) {
    const apuesta = APUESTA_BASE * j.multiplicador;
    try {
      await comoUsuario(j.email, 'crearPronostico', {
        partidoId,
        resultado: j.resultado,
        multiplicador: j.multiplicador,
      });
      apostado[j.email] = apuesta;
      console.log(`   ✓ ${j.email}: ${j.resultado} x${j.multiplicador} (−${apuesta})`);
    } catch (e) {
      apostado[j.email] = 0;
      console.log(`   ⚠ ${j.email}: no pudo pronosticar (${e.message || e})`);
    }
  }
  console.log('');

  // 3. Admin liquida (función real).
  console.log('3) Admin liquida el partido...');
  const resultado = await comoUsuario(ADMIN_EMAIL, 'liquidarPartido', {
    partidoId,
    resultadoOficial: RESULTADO_OFICIAL,
  });
  console.log(`   Resultado: ${JSON.stringify(resultado)}\n`);

  // 4. Verificaciones del reparto.
  console.log('4) Verificando el reparto de puntos...');

  // Guarda contra falso verde: si el seed no dejó a los usuarios validados,
  // todos caen en el catch (apostado=0) y no se verificaría nada.
  const participaron = Object.values(apostado).filter((a) => a > 0).length;
  if (!ok(participaron >= 2, `Al menos 2 usuarios pronosticaron (fueron ${participaron})`)) {
    console.log('\n❌ PRUEBA FALLÓ: casi nadie pudo pronosticar. ¿Corriste el seed y están validados?\n');
    process.exit(1);
  }

  const bolsa = Object.values(apostado).reduce((a, b) => a + b, 0);
  const apostadoGanadores = JUGADORES
    .filter((j) => j.resultado === RESULTADO_OFICIAL && apostado[j.email] > 0)
    .reduce((a, j) => a + apostado[j.email], 0);

  let todoBien = true;
  for (const j of JUGADORES) {
    if (apostado[j.email] === 0) continue; // no participó, se ignora.
    const ahora = (await saldoDe(j.email)).puntos;
    const gano = j.resultado === RESULTADO_OFICIAL;

    // Premio esperado: proporcional a lo apostado sobre la bolsa.
    const premioEsperado = gano
      ? Math.floor((apostado[j.email] * bolsa) / apostadoGanadores)
      : 0;
    const esperadoFinal = antes[j.email] - apostado[j.email] + premioEsperado;

    const bien = ahora === esperadoFinal;
    todoBien = todoBien && bien;
    ok(bien, `${j.email}: ${antes[j.email]} → ${ahora} (esperado ${esperadoFinal})`);
  }

  // Verifica que el partido quedó liquidado.
  const partFinal = (await partRef.get()).data();
  ok(partFinal?.liquidado === true, 'El partido quedó marcado como liquidado');

  console.log(`\n${todoBien ? '✅ PRUEBA PASÓ' : '❌ PRUEBA FALLÓ'}: el reparto ${todoBien ? 'cuadra' : 'NO cuadra'}.`);
  console.log('\n(Recuerda limpiar: node scripts/seed-dev.js limpiar)\n');
}

correr()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌ Error en la prueba:', e.message || e);
    process.exit(1);
  });
