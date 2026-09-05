/**
 * PRUEBA AVANZADA — Seguridad y autorización (transversal).
 *
 * Verifica que las guardas de permiso y de cuenta se cumplan: cosas que
 * NUNCA deberían poder hacer los usuarios comunes o las cuentas sin validar.
 * Todo debe FALLAR con el código correcto (permission-denied casi siempre).
 *
 *   - Un usuario común NO puede: liquidar/cancelar partidos, crear torneos
 *     globales, crear brackets, resolver jornadas, reiniciar puntos ni
 *     eliminar usuarios.
 *   - Una cuenta SIN validar NO puede unirse a torneos ni pronosticar brackets.
 *   - No se puede eliminar a un admin ni a una cuenta validada.
 *   - El alias tiene límites de longitud (3–20).
 *
 * USO:  node scripts/prueba-seguridad.js
 * REQUISITOS: ver scripts/_prueba-comun.js (seed + credenciales dev).
 */

const {
  projectId, comoUsuario, ok, esperarError, uidDe,
  crearPartido, crearBracketDuenos, crearUsuarioSinValidar,
} = require('./_prueba-comun');

const ADMIN = 'prueba_admin@quiniela.test';
const A = 'prueba_a@quiniela.test'; // usuario común validado

let todoBien = true;
const marca = (cond) => { todoBien = todoBien && cond; };

// ── Caso 1: acciones de admin bloqueadas para usuario común ───────────
async function casoSoloAdmin() {
  console.log('\n1) Un usuario común no puede hacer cosas de admin...');

  // Liquidar un partido (creado por Admin SDK) como usuario común.
  const partidoId = await crearPartido({ local: 'América', visitante: 'Guadalajara' });
  marca(await esperarError(
    () => comoUsuario(A, 'liquidarPartido', { partidoId, resultadoOficial: 'local' }),
    'permission-denied', 'usuario común NO puede liquidar',
  ));

  // Crear un torneo GLOBAL (sin grupo) como usuario común.
  marca(await esperarError(
    () => comoUsuario(A, 'crearTorneo', {
      nombre: 'Torneo Pirata',
      modo: 'quiniela',
      competicionId: 'x', competicionNombre: 'x',
      jornadaInicial: 1, jornadas: 1, costoEntrada: 0, porcentajeBote: 0,
      cierreInscripcion: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
    }),
    'permission-denied', 'usuario común NO puede crear torneo global',
  ));

  // Crear un bracket global como usuario común.
  marca(await esperarError(
    () => comoUsuario(A, 'crearBracket', {
      nombre: 'Bracket Pirata',
      modo: 'pronostico',
      config: { equipos: 2, avance: 'fijo', reparto: [100], armado: 'siembra' },
      puntaje: { avanzaPorRonda: [10], campeon: 20, finalista: 10, marcadorExacto: 5, marcadorResultado: 3 },
      equipos: [{ nombre: 'América' }, { nombre: 'Guadalajara' }],
      costoEntrada: 0, porcentajeBote: 0,
    }),
    'permission-denied', 'usuario común NO puede crear bracket',
  ));

  // Reiniciar puntos de otro (solo admin).
  const uidA = await uidDe(A);
  marca(await esperarError(
    () => comoUsuario(A, 'reiniciarPuntos', { uid: uidA }),
    'permission-denied', 'usuario común NO puede reiniciar puntos',
  ));

  // Eliminar usuarios (solo admin).
  marca(await esperarError(
    () => comoUsuario(A, 'eliminarUsuarios', { uids: [uidA] }),
    'permission-denied', 'usuario común NO puede eliminar usuarios',
  ));

  // Resolver una jornada de competición (solo admin/gestor).
  marca(await esperarError(
    () => comoUsuario(A, 'resolverJornadaCompeticion', { competicionId: 'x', jornadaId: 'y' }),
    'permission-denied', 'usuario común NO puede resolver jornadas',
  ));
}

// ── Caso 2: cuenta sin validar bloqueada ──────────────────────────────
async function casoSinValidar() {
  console.log('\n2) Una cuenta sin validar no puede participar...');
  const { email } = await crearUsuarioSinValidar('sinvalidar');

  // Unirse a un torneo con cualquier código: primero valida la cuenta.
  marca(await esperarError(
    () => comoUsuario(email, 'unirseTorneo', { codigo: 'CUALQUIERA' }),
    'permission-denied', 'cuenta sin validar NO puede unirse a torneos',
  ));

  // Pronosticar un bracket: exige cuenta validada.
  const bracketId = await crearBracketDuenos({ costoEntrada: 0, equipos: ['América', 'Guadalajara'] });
  marca(await esperarError(
    () => comoUsuario(email, 'guardarPronosticoBracket', { bracketId, avances: {}, marcadores: {} }),
    'permission-denied', 'cuenta sin validar NO puede pronosticar brackets',
  ));
}

// ── Caso 3: no borrar admin ni cuenta validada ────────────────────────
async function casoBorradoProtegido() {
  console.log('\n3) eliminarUsuarios protege admins y cuentas validadas...');
  const uidAdmin = await uidDe(ADMIN);
  const uidA = await uidDe(A); // A está validado (seed)

  // El admin intenta borrar a otro admin y a una cuenta validada: se OMITEN,
  // no se borran. La función no falla, pero reporta 0 borrados y los omitidos.
  const res = await comoUsuario(ADMIN, 'eliminarUsuarios', { uids: [uidAdmin, uidA] });
  marca(ok(res.borrados === 0, `no borró ninguno de los protegidos (borrados=${res.borrados})`));
  marca(ok(
    Array.isArray(res.omitidos) && res.omitidos.length >= 1,
    `reportó cuentas omitidas (${(res.omitidos || []).length})`,
  ));
}

// ── Caso 4: límites de alias ──────────────────────────────────────────
async function casoAlias() {
  console.log('\n4) El alias respeta 3–20 caracteres...');
  marca(await esperarError(
    () => comoUsuario(A, 'cambiarAlias', { alias: 'ab' }),
    'invalid-argument', 'alias de 2 caracteres rechazado',
  ));
  marca(await esperarError(
    () => comoUsuario(A, 'cambiarAlias', { alias: 'x'.repeat(21) }),
    'invalid-argument', 'alias de 21 caracteres rechazado',
  ));
  // Un alias válido sí pasa (control positivo). Lo devolvemos a algo neutral.
  let paso = true;
  try {
    await comoUsuario(A, 'cambiarAlias', { alias: 'Prueba a' });
  } catch (e) { paso = false; console.log(`  (info) alias válido falló: ${e.message || e}`); }
  marca(ok(paso, 'alias válido aceptado (control positivo)'));
}

async function correr() {
  console.log(`\n🧪 Prueba de SEGURIDAD y autorización en ${projectId}`);

  await casoSoloAdmin();
  await casoSinValidar();
  await casoBorradoProtegido();
  await casoAlias();

  console.log(`\n${todoBien ? '✅ PRUEBA PASÓ' : '❌ PRUEBA FALLÓ'}: guardas de seguridad.`);
  console.log('\n(Limpieza: node scripts/seed-dev.js limpiar)\n');
}

correr()
  .then(() => process.exit(todoBien ? 0 : 1))
  .catch((e) => {
    console.error('\n❌ Error en la prueba:', e.message || e);
    process.exit(1);
  });
