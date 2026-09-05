/**
 * PRUEBA AVANZADA — Brackets / Eliminatorias (casos difíciles y borde).
 *
 * Ataca lo que el happy path no cubre, centrado en modo DUEÑOS y en la
 * calificación:
 *   - Validación: el reparto de la bolsa debe sumar 100%.
 *   - Modo dueños: asignar → aceptar (cobra una vez, idempotente) y
 *     rechazar (libera el equipo, no se puede rechazar tras aceptar).
 *   - Cierre por saldo: aceptar sin saldo suficiente se rechaza (tope −1000).
 *   - Calificar dueños: el dueño del campeón se lleva la bolsa.
 *   - RIESGO CONOCIDO: calificarBracket no tiene guarda de idempotencia;
 *     esta prueba DOCUMENTA el comportamiento actual (si paga doble, lo marca).
 *
 * USO:  node scripts/prueba-brackets-avanzado.js
 * REQUISITOS: ver scripts/_prueba-comun.js (seed + credenciales dev).
 */

const {
  projectId, saldoDe, comoUsuario, ok, esperarError,
  crearBracketDuenos, leerBracket, fijarSaldo, contarLedger,
} = require('./_prueba-comun');

const ADMIN = 'prueba_admin@quiniela.test';
const A = 'prueba_a@quiniela.test';
const B = 'prueba_b@quiniela.test';

let todoBien = true;
const marca = (cond) => { todoBien = todoBien && cond; };

// ── Caso 1: el reparto debe sumar 100% ────────────────────────────────
async function casoRepartoSuma100() {
  console.log('\n1) crearBracket exige que el reparto sume 100%...');
  // reparto [60, 30] suma 90 → invalid-argument.
  marca(await esperarError(
    () => comoUsuario(ADMIN, 'crearBracket', {
      nombre: 'Repartomalo (auto)',
      modo: 'pronostico',
      config: { equipos: 2, avance: 'fijo', reparto: [60, 30], armado: 'siembra' },
      puntaje: { avanzaPorRonda: [10], campeon: 20, finalista: 10, marcadorExacto: 5, marcadorResultado: 3 },
      equipos: [{ nombre: 'América' }, { nombre: 'Guadalajara' }],
      costoEntrada: 0,
      porcentajeBote: 0,
    }),
    'invalid-argument', 'reparto que no suma 100 rechazado',
  ));
}

// ── Caso 2: modo dueños — asignar, aceptar (cobra 1 vez), idempotente ─
async function casoAceptar() {
  console.log('\n2) Dueños: aceptar cobra una vez (idempotente)...');
  const bracketId = await crearBracketDuenos({ costoEntrada: 100, equipos: ['América', 'Guadalajara'] });
  const uidA = await fijarSaldo(A, 5000);

  // Admin asigna América a A (queda 'invitado').
  await comoUsuario(ADMIN, 'asignarDuenoBracket', { bracketId, equipo: 'América', duenoUid: uidA });

  const saldoAntes = (await saldoDe(A)).puntos;
  // A acepta: se le cobra 100.
  await comoUsuario(A, 'aceptarDuenoBracket', { bracketId });
  const saldoDespues = (await saldoDe(A)).puntos;
  marca(ok(saldoDespues === saldoAntes - 100, `aceptar cobra 100: ${saldoAntes} → ${saldoDespues}`));

  // Aceptar de nuevo NO vuelve a cobrar (idempotente).
  await comoUsuario(A, 'aceptarDuenoBracket', { bracketId });
  const saldoDoble = (await saldoDe(A)).puntos;
  marca(ok(saldoDoble === saldoDespues, `segundo aceptar no cobra doble (${saldoDespues} = ${saldoDoble})`));

  // Un solo movimiento 'bracket-entrada' EN ESTE bracket (el ledger acumula
  // movimientos de otros brackets del mismo usuario, por eso filtramos).
  const entradas = await contarLedger(uidA, 'bracket-entrada', { bracketId });
  marca(ok(entradas === 1, `un solo movimiento 'bracket-entrada' en este bracket (hay ${entradas})`));

  // Rechazar tras aceptar: rechazado.
  marca(await esperarError(
    () => comoUsuario(A, 'rechazarDuenoBracket', { bracketId }),
    'failed-precondition', 'rechazar tras aceptar rechazado',
  ));
}

// ── Caso 3: rechazar libera el equipo ─────────────────────────────────
async function casoRechazar() {
  console.log('\n3) Dueños: rechazar libera el equipo...');
  const bracketId = await crearBracketDuenos({ costoEntrada: 100, equipos: ['Cruz Azul', 'Pumas'] });
  const uidB = await fijarSaldo(B, 5000);

  await comoUsuario(ADMIN, 'asignarDuenoBracket', { bracketId, equipo: 'Cruz Azul', duenoUid: uidB });
  const saldoAntes = (await saldoDe(B)).puntos;

  await comoUsuario(B, 'rechazarDuenoBracket', { bracketId });
  const saldoDespues = (await saldoDe(B)).puntos;
  marca(ok(saldoDespues === saldoAntes, `rechazar no cobra: ${saldoAntes} → ${saldoDespues}`));

  const b = await leerBracket(bracketId);
  const sigueAsignado = (b?.duenos ?? []).some((d) => d.equipo === 'Cruz Azul');
  marca(ok(!sigueAsignado, 'el equipo quedó libre tras rechazar'));
}

// ── Caso 4: aceptar sin saldo suficiente (tope −1000) ─────────────────
async function casoAceptarSinSaldo() {
  console.log('\n4) Dueños: aceptar sin saldo suficiente se rechaza...');
  const bracketId = await crearBracketDuenos({ costoEntrada: 100, equipos: ['Toluca', 'Pachuca'] });
  const uidA = await fijarSaldo(A, -950); // −950 − 100 = −1050 < −1000 → rechazo.

  await comoUsuario(ADMIN, 'asignarDuenoBracket', { bracketId, equipo: 'Toluca', duenoUid: uidA });
  marca(await esperarError(
    () => comoUsuario(A, 'aceptarDuenoBracket', { bracketId }),
    'failed-precondition', 'aceptar que baja de −1000 rechazado',
  ));
}

// ── Caso 5: calificar dueños — dueño del campeón cobra la bolsa ───────
//    y comportamiento de una SEGUNDA calificación (idempotencia).
async function casoCalificarDuenos() {
  console.log('\n5) Dueños: el dueño del campeón cobra la bolsa...');
  const bracketId = await crearBracketDuenos({ costoEntrada: 100, equipos: ['Monterrey', 'Tigres'] });
  const uidA = await fijarSaldo(A, 5000);
  const uidB = await fijarSaldo(B, 5000);

  // A dueño de Monterrey, B dueño de Tigres. Ambos aceptan → bolsa 200.
  await comoUsuario(ADMIN, 'asignarDuenoBracket', { bracketId, equipo: 'Monterrey', duenoUid: uidA });
  await comoUsuario(ADMIN, 'asignarDuenoBracket', { bracketId, equipo: 'Tigres', duenoUid: uidB });
  await comoUsuario(A, 'aceptarDuenoBracket', { bracketId });
  await comoUsuario(B, 'aceptarDuenoBracket', { bracketId });

  const saldoAantes = (await saldoDe(A)).puntos; // 4900 (ya pagó 100)

  // Capturamos la final: Monterrey 2-0 Tigres → campeón Monterrey (dueño A).
  await comoUsuario(ADMIN, 'capturarPartidoBracket', {
    bracketId, idLlave: 'r0p0', indicePartido: 0, golesLocal: 2, golesVisitante: 0,
  });
  // Capturar la final debe dejar el bracket 'finalizado'.
  let b = await leerBracket(bracketId);
  marca(ok(b?.estado === 'finalizado', `bracket finalizado tras la final (estado=${b?.estado})`));

  // Calificar: el dueño de Monterrey (A) se lleva la bolsa (200).
  await comoUsuario(ADMIN, 'calificarBracket', { bracketId });
  const saldoAdespues = (await saldoDe(A)).puntos;
  marca(ok(saldoAdespues === saldoAantes + 200, `A (dueño del campeón) cobra 200: ${saldoAantes} → ${saldoAdespues}`));

  // Segunda calificación: debe RECHAZARSE (guarda de idempotencia). El bracket
  // se marca 'repartido' en la primera llamada; la segunda no vuelve a pagar.
  marca(await esperarError(
    () => comoUsuario(ADMIN, 'calificarBracket', { bracketId }),
    'failed-precondition', 'segunda calificación rechazada (idempotente)',
  ));
  const saldoAfinal = (await saldoDe(A)).puntos;
  marca(ok(
    saldoAfinal === saldoAdespues,
    `sin pago doble: el saldo no cambió (${saldoAdespues} = ${saldoAfinal})`,
  ));
}

async function correr() {
  console.log(`\n🧪 Prueba AVANZADA de brackets en ${projectId}`);

  await casoRepartoSuma100();
  await casoAceptar();
  await casoRechazar();
  await casoAceptarSinSaldo();
  await casoCalificarDuenos();

  console.log(`\n${todoBien ? '✅ PRUEBA PASÓ' : '❌ PRUEBA FALLÓ'}: casos avanzados de brackets.`);
  console.log('\n(Limpieza: node scripts/seed-dev.js limpiar. Restaurar saldos: seed de nuevo.)\n');
}

correr()
  .then(() => process.exit(todoBien ? 0 : 1))
  .catch((e) => {
    console.error('\n❌ Error en la prueba:', e.message || e);
    process.exit(1);
  });
