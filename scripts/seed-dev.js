/**
 * SEED DE DATOS DE PRUEBA — solo para el proyecto DEV.
 *
 * Crea usuarios validados, un admin, y torneos/brackets de cada tipo,
 * todo marcado con { esPrueba: true } para poder borrarlo de un golpe.
 *
 * USO:
 *   node scripts/seed-dev.js seed      → crea los datos de prueba
 *   node scripts/seed-dev.js limpiar   → borra TODO lo marcado esPrueba
 *
 * REQUISITOS:
 *   1. Tener el archivo de credenciales de la cuenta de servicio de DEV.
 *      Descárgalo de: Consola Firebase (proyecto dev) → Configuración →
 *      Cuentas de servicio → Generar nueva clave privada.
 *   2. Guárdalo como scripts/service-account-dev.json
 *      (NUNCA lo subas a git — agrégalo a .gitignore).
 *   3. npm install firebase-admin  (si no está)
 *
 * SEGURIDAD: por diseño, este script SE NIEGA a correr si el projectId
 * no contiene 'dev', para que nunca toque producción por accidente.
 */

const admin = require('firebase-admin');
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const path = require('path');

// ── Carga de credenciales ────────────────────────────────────────────
let serviceAccount;
try {
  serviceAccount = require(path.join(__dirname, 'service-account-dev.json'));
} catch (e) {
  console.error('\n❌ No encontré scripts/service-account-dev.json');
  console.error('   Descárgalo de la consola de Firebase (proyecto DEV) y ponlo ahí.\n');
  process.exit(1);
}

// ── Candado anti-producción ──────────────────────────────────────────
const projectId = serviceAccount.project_id || '';
if (!projectId.includes('dev')) {
  console.error(`\n🛑 ALTO: el projectId es "${projectId}", que no parece DEV.`);
  console.error('   Este script solo corre en dev (el id debe contener "dev").');
  console.error('   Si de verdad quieres otro proyecto, revisa el service-account.\n');
  process.exit(1);
}

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const auth = getAuth();

// Marca que llevan TODOS los datos de prueba, para poder limpiarlos.
const MARCA = { esPrueba: true };

// Equipos reales para que los escudos se vean bien.
const EQUIPOS = ['América', 'Guadalajara', 'Cruz Azul', 'Pumas', 'Monterrey',
  'Tigres', 'Toluca', 'Pachuca', 'Santos', 'León', 'Atlas', 'Necaxa',
  'Puebla', 'Querétaro', 'Mazatlán', 'Juárez'];

// ── Helpers ──────────────────────────────────────────────────────────

/** Crea (o reusa) un usuario de Auth + su doc en Firestore. */
async function crearUsuario(sufijo, { admin: esAdmin = false, puntos = 5000 } = {}) {
  const email = `prueba_${sufijo}@quiniela.test`;
  const alias = `Prueba ${sufijo}`;

  let uid;
  try {
    const u = await auth.createUser({ email, password: 'prueba1234', displayName: alias });
    uid = u.uid;
  } catch (e) {
    if (e.code === 'auth/email-already-exists') {
      const existing = await auth.getUserByEmail(email);
      uid = existing.uid;
    } else {
      throw e;
    }
  }

  await db.doc(`users/${uid}`).set({
    email,
    alias,
    rol: esAdmin ? 'admin' : 'user',
    validada: true,
    bloqueado: false,
    puntos,
    puntosHistoricos: puntos,
    aciertos: 0,
    resueltos: 0,
    racha: 0,
    mejorRacha: 0,
    torneosGanados: 0,
    createdAt: FieldValue.serverTimestamp(),
    ...MARCA,
  }, { merge: true });

  // El ranking del usuario (para que aparezca en la tabla).
  await db.doc(`ranking/${uid}`).set({
    alias,
    puntos,
    saldo: puntos,
    torneosGanados: 0,
    aciertos: 0,
    resueltos: 0,
    porcentaje: 0,
    calificado: false,
    racha: 0,
    mejorRacha: 0,
    actualizado: FieldValue.serverTimestamp(),
    ...MARCA,
  }, { merge: true });

  if (esAdmin) {
    await db.doc(`admins/${uid}`).set({ email, ...MARCA });
  }

  console.log(`  ✓ Usuario ${email} (${uid})${esAdmin ? ' [admin]' : ''}`);
  return { uid, email, alias };
}

/** Crea un partido individual de prueba (abierto). */
async function crearPartido(local, visitante, { porcentajeBote = 0, minutosParaCerrar = 120 } = {}) {
  const cierra = Timestamp.fromMillis(Date.now() + minutosParaCerrar * 60 * 1000);
  const ref = await db.collection('partidos').add({
    competition: 'Prueba',
    homeTeam: local,
    awayTeam: visitante,
    type: '1x2',
    status: 'abierto',
    closesAt: cierra,
    porcentajeBote,
    liquidado: false,
    createdAt: FieldValue.serverTimestamp(),
    ...MARCA,
  });
  console.log(`  ✓ Partido ${local} vs ${visitante} (bote ${porcentajeBote}%)`);
  return ref.id;
}

/** Crea un torneo de prueba (en inscripción). */
async function crearTorneo(nombre, modo, { vidas = 3, costoEntrada = 100, porcentajeBote = 0, jornadas = 5 } = {}) {
  const codigo = Math.random().toString(36).slice(2, 8).toUpperCase();
  const ref = await db.collection('torneos').add({
    nombre,
    competicionId: 'prueba-liga',
    competicionNombre: 'Liga de Prueba',
    jornadaInicial: 1,
    jornadaActual: 1,
    modo,
    jornadas: modo === 'quiniela' ? jornadas : 0,
    vidas: modo === 'supervivencia' ? vidas : 0,
    vidaCubre: 'empate',
    permiteRevivir: true,
    costoEntrada,
    porcentajeBote,
    bolsa: 0,
    codigo,
    estado: 'inscripcion',
    cierreInscripcion: Timestamp.fromMillis(Date.now() + 3 * 60 * 60 * 1000),
    gestores: [],
    createdAt: FieldValue.serverTimestamp(),
    ...MARCA,
  });
  console.log(`  ✓ Torneo "${nombre}" (${modo}, código ${codigo})`);
  return ref.id;
}

// ── Comando: SEED ────────────────────────────────────────────────────
async function seed() {
  console.log(`\n🌱 Sembrando datos de prueba en ${projectId}...\n`);

  console.log('Usuarios:');
  const admin1 = await crearUsuario('admin', { admin: true, puntos: 10000 });
  const jugadores = [];
  for (const n of ['a', 'b', 'c', 'd']) {
    jugadores.push(await crearUsuario(n, { puntos: 5000 }));
  }
  // Un jugador con pocos puntos, para probar el tope inferior.
  jugadores.push(await crearUsuario('sinsaldo', { puntos: 50 }));

  console.log('\nPartidos:');
  await crearPartido(EQUIPOS[0], EQUIPOS[1], { porcentajeBote: 10 });
  await crearPartido(EQUIPOS[2], EQUIPOS[3], { porcentajeBote: 0 });

  console.log('\nTorneos:');
  await crearTorneo('Survivor de Prueba', 'supervivencia', { vidas: 3, porcentajeBote: 10 });
  await crearTorneo('Quiniela de Prueba', 'quiniela', { jornadas: 3, porcentajeBote: 5 });

  console.log('\n✅ Listo. Datos de prueba creados.');
  console.log('   Contraseña de todos los usuarios: prueba1234');
  console.log('   Para borrarlos: node scripts/seed-dev.js limpiar\n');
}

// ── Comando: LIMPIAR ─────────────────────────────────────────────────
async function limpiar() {
  console.log(`\n🧹 Limpiando datos de prueba en ${projectId}...\n`);

  const colecciones = ['partidos', 'torneos', 'brackets', 'ranking', 'admins', 'bolsas', 'ledger', 'trofeos'];
  let total = 0;

  for (const col of colecciones) {
    const snap = await db.collection(col).where('esPrueba', '==', true).get();
    for (const d of snap.docs) {
      // Borra subcolecciones conocidas de torneos/brackets.
      if (col === 'torneos' || col === 'brackets') {
        for (const sub of ['participantes', 'picks', 'quinielas', 'pronosticos']) {
          const subs = await d.ref.collection(sub).get();
          for (const s of subs.docs) await s.ref.delete();
        }
      }
      await d.ref.delete();
      total++;
    }
    if (snap.size > 0) console.log(`  ✓ ${col}: ${snap.size} borrado(s)`);
  }

  // Usuarios: borrar doc + cuenta de Auth.
  const users = await db.collection('users').where('esPrueba', '==', true).get();
  for (const d of users.docs) {
    await auth.deleteUser(d.id).catch(() => undefined);
    await d.ref.delete();
    total++;
  }
  if (users.size > 0) console.log(`  ✓ users: ${users.size} borrado(s) (doc + Auth)`);

  console.log(`\n✅ Limpieza completa. ${total} documento(s) eliminado(s).\n`);
}

// ── Router ───────────────────────────────────────────────────────────
const comando = process.argv[2];
(async () => {
  try {
    if (comando === 'seed') await seed();
    else if (comando === 'limpiar') await limpiar();
    else {
      console.log('\nUso:');
      console.log('  node scripts/seed-dev.js seed      → crea datos de prueba');
      console.log('  node scripts/seed-dev.js limpiar   → borra los datos de prueba\n');
    }
    process.exit(0);
  } catch (e) {
    console.error('\n❌ Error:', e.message || e);
    process.exit(1);
  }
})();
