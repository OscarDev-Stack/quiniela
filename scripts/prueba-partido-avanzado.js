/**
 * PRUEBA AVANZADA — Partido individual (casos difíciles y borde).
 *
 * A diferencia de prueba-partido.js (happy path), aquí atacamos las
 * validaciones, guardas de estado, aritmética con redondeo e idempotencia
 * de crearPronostico y liquidarPartido. Cada bloque crea su propio partido
 * para no arrastrar estado entre casos.
 *
 * USO:  node scripts/prueba-partido-avanzado.js
 * REQUISITOS: ver scripts/_prueba-comun.js (seed + credenciales dev).
 *
 * OJO: fija el saldo de algunos jugadores para probar el tope. Al terminar
 * corre  node scripts/seed-dev.js seed  si quieres restaurar los 5000 pts.
 */

const {
  projectId, saldoDe, comoUsuario, ok, esperarError,
  crearPartido, fijarSaldo, ajustarPartido, leerReserva, contarLedger,
} = require('./_prueba-comun');

const ADMIN = 'prueba_admin@quiniela.test';
const A = 'prueba_a@quiniela.test';
const B = 'prueba_b@quiniela.test';
const C = 'prueba_c@quiniela.test';
const D = 'prueba_d@quiniela.test';

let todoBien = true;
const marca = (cond) => { todoBien = todoBien && cond; };

// ── Caso 1: validaciones de entrada de crearPronostico ────────────────
async function casoValidaciones() {
  console.log('\n1) Validaciones de crearPronostico...');
  const partidoId = await crearPartido({ local: 'Toluca', visitante: 'Pachuca' });

  // Multiplicador fuera de rango (0 y 6): invalid-argument (MAX=5).
  marca(await esperarError(
    () => comoUsuario(A, 'crearPronostico', { partidoId, resultado: 'local', multiplicador: 0 }),
    'invalid-argument', 'multiplicador 0 rechazado',
  ));
  marca(await esperarError(
    () => comoUsuario(A, 'crearPronostico', { partidoId, resultado: 'local', multiplicador: 6 }),
    'invalid-argument', 'multiplicador 6 rechazado (MAX 5)',
  ));

  // Resultado que no aplica a un 1x2 ('pasa-local' es de otro tipo).
  marca(await esperarError(
    () => comoUsuario(A, 'crearPronostico', { partidoId, resultado: 'pasa-local', multiplicador: 1 }),
    'invalid-argument', 'resultado no válido para 1x2 rechazado',
  ));

  // Partido inexistente → not-found.
  marca(await esperarError(
    () => comoUsuario(A, 'crearPronostico', { partidoId: 'no-existe-xyz', resultado: 'local', multiplicador: 1 }),
    'not-found', 'partido inexistente rechazado',
  ));
}

// ── Caso 2: edición de pronóstico (cobros al subir/bajar/cambiar) ─────
async function casoEdicion() {
  console.log('\n2) Edición de pronóstico (cobra la diferencia)...');
  const partidoId = await crearPartido({ local: 'León', visitante: 'Atlas' });

  // Dejamos a A con saldo conocido para verificar la aritmética exacta.
  await fijarSaldo(A, 5000);

  // Primera apuesta: local x1 = −100.
  await comoUsuario(A, 'crearPronostico', { partidoId, resultado: 'local', multiplicador: 1 });
  let s = (await saldoDe(A)).puntos;
  marca(ok(s === 4900, `tras apostar x1: 5000 → ${s} (esperado 4900)`));

  // Sube a x3: debe cobrar la diferencia (300 − 100 = 200 más).
  await comoUsuario(A, 'crearPronostico', { partidoId, resultado: 'local', multiplicador: 3 });
  s = (await saldoDe(A)).puntos;
  marca(ok(s === 4700, `tras subir a x3: → ${s} (esperado 4700)`));

  // Baja a x1 cambiando de resultado a 'empate': devuelve 200 (queda −100 neto).
  await comoUsuario(A, 'crearPronostico', { partidoId, resultado: 'empate', multiplicador: 1 });
  s = (await saldoDe(A)).puntos;
  marca(ok(s === 4900, `tras bajar a x1 y cambiar a empate: → ${s} (esperado 4900)`));

  // El movimiento quedó como 'apuesta-edicion' (al menos una vez).
  const uid = (await saldoDe(A)).uid;
  const ediciones = await contarLedger(uid, 'apuesta-edicion');
  marca(ok(ediciones >= 1, `hay ${ediciones} movimiento(s) 'apuesta-edicion' (esperado ≥1)`));
}

// ── Caso 3: tope inferior de saldo (−1000) ────────────────────────────
async function casoTope() {
  console.log('\n3) Tope inferior de saldo (−1000)...');
  const partidoId = await crearPartido({ local: 'Santos', visitante: 'Necaxa' });

  // Con saldo −900, una apuesta x1 (−100) deja el saldo en −1000 exacto: PERMITIDO.
  await fijarSaldo(B, -900);
  let ok1 = true;
  try {
    await comoUsuario(B, 'crearPronostico', { partidoId, resultado: 'local', multiplicador: 1 });
  } catch (e) {
    ok1 = false;
    console.log(`  (info) error inesperado al llegar a −1000 exacto: ${e.message || e}`);
  }
  const s = (await saldoDe(B)).puntos;
  marca(ok(ok1 && s === -1000, `−900 − 100 = −1000 exacto permitido (saldo ${s})`));

  // Con saldo −950, una apuesta x1 lo llevaría a −1050 (< −1000): RECHAZADO.
  const partido2 = await crearPartido({ local: 'Puebla', visitante: 'Juárez' });
  await fijarSaldo(C, -950);
  marca(await esperarError(
    () => comoUsuario(C, 'crearPronostico', { partidoId: partido2, resultado: 'local', multiplicador: 1 }),
    'failed-precondition', 'apuesta que baja de −1000 rechazada',
  ));
}

// ── Caso 4: guardas de estado (cerrado por hora / liquidado) ──────────
async function casoEstados() {
  console.log('\n4) Guardas de estado del partido...');

  // Partido con cierre en el pasado: el cierre por hora manda.
  const cerrado = await crearPartido({ local: 'Tigres', visitante: 'Monterrey', minutosParaCerrar: 60 });
  await ajustarPartido(cerrado, {
    closesAt: require('firebase-admin/firestore').Timestamp.fromMillis(Date.now() - 60 * 1000),
  });
  await fijarSaldo(D, 5000);
  marca(await esperarError(
    () => comoUsuario(D, 'crearPronostico', { partidoId: cerrado, resultado: 'local', multiplicador: 1 }),
    'failed-precondition', 'pronóstico tras la hora de cierre rechazado',
  ));

  // Partido ya liquidado: no acepta pronósticos.
  const liquidado = await crearPartido({ local: 'Mazatlán', visitante: 'Querétaro' });
  await ajustarPartido(liquidado, { liquidado: true, status: 'cerrado' });
  marca(await esperarError(
    () => comoUsuario(D, 'crearPronostico', { partidoId: liquidado, resultado: 'local', multiplicador: 1 }),
    'failed-precondition', 'pronóstico en partido liquidado rechazado',
  ));
}

// ── Caso 5: nadie acierta → devolución total, bote NO se aparta ───────
async function casoNadieAcierta() {
  console.log('\n5) Nadie acierta → devolución total...');
  const partidoId = await crearPartido({ local: 'América', visitante: 'Cruz Azul', porcentajeBote: 10 });

  await fijarSaldo(A, 5000);
  await fijarSaldo(B, 5000);
  const reservaAntes = await leerReserva();

  // A y B apuestan a 'local' y 'empate'; el resultado oficial será 'visitante'.
  await comoUsuario(A, 'crearPronostico', { partidoId, resultado: 'local', multiplicador: 1 });
  await comoUsuario(B, 'crearPronostico', { partidoId, resultado: 'empate', multiplicador: 2 });

  await comoUsuario(ADMIN, 'liquidarPartido', { partidoId, resultadoOficial: 'visitante' });

  // Devolución: cada quien recupera su apuesta completa (el bote no se toca).
  const sa = (await saldoDe(A)).puntos;
  const sb = (await saldoDe(B)).puntos;
  marca(ok(sa === 5000, `A recuperó su apuesta: → ${sa} (esperado 5000)`));
  marca(ok(sb === 5000, `B recuperó su apuesta: → ${sb} (esperado 5000)`));

  const reservaDespues = await leerReserva();
  marca(ok(
    reservaDespues === reservaAntes,
    `el bote NO creció al devolver (reserva ${reservaAntes} → ${reservaDespues})`,
  ));
}

// ── Caso 6: reparto con bote + redondeo (Math.floor) y sobrante ───────
async function casoRepartoConBote() {
  console.log('\n6) Reparto con bote 10% y redondeo hacia abajo...');
  const partidoId = await crearPartido({ local: 'Pumas', visitante: 'Toluca', porcentajeBote: 10 });

  await fijarSaldo(A, 5000); // gana
  await fijarSaldo(B, 5000); // gana
  await fijarSaldo(C, 5000); // pierde
  const reservaAntes = await leerReserva();

  // A: local x1 (−100), B: local x2 (−200), C: visitante x1 (−100).
  await comoUsuario(A, 'crearPronostico', { partidoId, resultado: 'local', multiplicador: 1 });
  await comoUsuario(B, 'crearPronostico', { partidoId, resultado: 'local', multiplicador: 2 });
  await comoUsuario(C, 'crearPronostico', { partidoId, resultado: 'visitante', multiplicador: 1 });

  // Bolsa bruta = 400. Bote 10% = floor(400*10/100) = 40. Bolsa neta = 360.
  // Ganadores (local): A(100) y B(200), apostadoGanadores = 300.
  // Premio A = floor(100*360/300) = 120. Premio B = floor(200*360/300) = 240.
  // Repartido = 360, sobrante = 0.
  await comoUsuario(ADMIN, 'liquidarPartido', { partidoId, resultadoOficial: 'local' });

  const sa = (await saldoDe(A)).puntos; // 5000 −100 +120 = 5020
  const sb = (await saldoDe(B)).puntos; // 5000 −200 +240 = 5040
  const sc = (await saldoDe(C)).puntos; // 5000 −100 +0   = 4900
  marca(ok(sa === 5020, `A: → ${sa} (esperado 5020)`));
  marca(ok(sb === 5040, `B: → ${sb} (esperado 5040)`));
  marca(ok(sc === 4900, `C (perdió): → ${sc} (esperado 4900)`));

  // El bote (40) llegó a la reserva. El sobrante fue 0 en este caso.
  const reservaDespues = await leerReserva();
  marca(ok(
    reservaDespues === reservaAntes + 40,
    `el bote 40 llegó a la reserva (${reservaAntes} → ${reservaDespues})`,
  ));
}

// ── Caso 7: doble liquidación es idempotente (segundo intento falla) ──
async function casoDobleLiquidacion() {
  console.log('\n7) Doble liquidación (idempotencia)...');
  const partidoId = await crearPartido({ local: 'Guadalajara', visitante: 'Atlas' });

  await fijarSaldo(A, 5000);
  await comoUsuario(A, 'crearPronostico', { partidoId, resultado: 'local', multiplicador: 1 });

  await comoUsuario(ADMIN, 'liquidarPartido', { partidoId, resultadoOficial: 'local' });
  const primera = (await saldoDe(A)).puntos;

  // Segundo intento: debe fallar porque ya está liquidado (no vuelve a pagar).
  marca(await esperarError(
    () => comoUsuario(ADMIN, 'liquidarPartido', { partidoId, resultadoOficial: 'local' }),
    'failed-precondition', 'segunda liquidación rechazada',
  ));
  const segunda = (await saldoDe(A)).puntos;
  marca(ok(primera === segunda, `el saldo no cambió tras el segundo intento (${primera} = ${segunda})`));
}

async function correr() {
  console.log(`\n🧪 Prueba AVANZADA de partido en ${projectId}`);

  await casoValidaciones();
  await casoEdicion();
  await casoTope();
  await casoEstados();
  await casoNadieAcierta();
  await casoRepartoConBote();
  await casoDobleLiquidacion();

  console.log(`\n${todoBien ? '✅ PRUEBA PASÓ' : '❌ PRUEBA FALLÓ'}: casos avanzados de partido.`);
  console.log('\n(Se ajustaron saldos: corre "node scripts/seed-dev.js seed" para restaurarlos,');
  console.log(' y "node scripts/seed-dev.js limpiar" para borrar los datos de prueba.)\n');
}

correr()
  .then(() => process.exit(todoBien ? 0 : 1))
  .catch((e) => {
    console.error('\n❌ Error en la prueba:', e.message || e);
    process.exit(1);
  });
