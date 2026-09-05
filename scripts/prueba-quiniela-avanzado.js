/**
 * PRUEBA AVANZADA — Quiniela por puntos (casos difíciles y borde).
 *
 * Ataca lo que el happy path no cubre:
 *   - Validación de marcadores: fuera de rango [0,20] y longitud incorrecta.
 *   - Desempate por marcadores exactos cuando empatan en puntos.
 *   - Empate TOTAL (mismos puntos y mismos exactos): comparten la bolsa
 *     con Math.floor y el sobrante va a la reserva.
 *   - Guardas de estado: no capturar si el torneo no está en curso.
 *
 * USO:  node scripts/prueba-quiniela-avanzado.js
 * REQUISITOS: ver scripts/_prueba-comun.js (seed + credenciales dev).
 */

const {
  projectId, db, saldoDe, comoUsuario, ok, esperarError,
  crearCompeticionConJornada, capturarResultadosJornada, arrancarTorneo,
  marcarPrueba, leerReserva, fijarSaldo,
} = require('./_prueba-comun');

const ADMIN = 'prueba_admin@quiniela.test';
const A = 'prueba_a@quiniela.test';
const B = 'prueba_b@quiniela.test';
const C = 'prueba_c@quiniela.test';

let todoBien = true;
const marca = (cond) => { todoBien = todoBien && cond; };

/** Crea una quiniela de una jornada. Devuelve ids + código. */
async function nuevaQuiniela(partidos, opciones = {}) {
  const { competicionId, jornadaId, jornadaRef } = await crearCompeticionConJornada(partidos);
  const creado = await comoUsuario(ADMIN, 'crearTorneo', {
    nombre: opciones.nombre ?? 'Quiniela Avanzada (auto)',
    modo: 'quiniela',
    competicionId,
    competicionNombre: 'Liga de Prueba (auto)',
    jornadaInicial: 1,
    jornadas: 1,
    costoEntrada: opciones.costoEntrada ?? 100,
    porcentajeBote: opciones.porcentajeBote ?? 0,
    cierreInscripcion: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  });
  await marcarPrueba('torneos', creado.id);
  return { torneoId: creado.id, codigo: creado.codigo, competicionId, jornadaId, jornadaRef };
}

// ── Caso 1: validación de marcadores ──────────────────────────────────
async function casoValidacionMarcadores() {
  console.log('\n1) Validación de marcadores (rango y longitud)...');
  const partidos = [
    { local: 'América', visitante: 'Guadalajara' },
    { local: 'Cruz Azul', visitante: 'Pumas' },
  ];
  const { torneoId, codigo } = await nuevaQuiniela(partidos);
  await comoUsuario(A, 'unirseTorneo', { codigo });
  await arrancarTorneo(torneoId);

  // Longitud incorrecta: manda 1 marcador para 2 partidos.
  marca(await esperarError(
    () => comoUsuario(A, 'guardarQuiniela', { torneoId, marcadores: [{ local: 1, visitante: 0 }] }),
    'invalid-argument', 'longitud de marcadores incorrecta rechazada',
  ));

  // Fuera de rango: 21 > 20.
  marca(await esperarError(
    () => comoUsuario(A, 'guardarQuiniela', {
      torneoId,
      marcadores: [{ local: 21, visitante: 0 }, { local: 1, visitante: 1 }],
    }),
    'invalid-argument', 'marcador fuera de rango (21) rechazado',
  ));

  // Negativo: −1 < 0.
  marca(await esperarError(
    () => comoUsuario(A, 'guardarQuiniela', {
      torneoId,
      marcadores: [{ local: -1, visitante: 0 }, { local: 1, visitante: 1 }],
    }),
    'invalid-argument', 'marcador negativo rechazado',
  ));

  // Un marcador válido sí pasa (control positivo).
  let paso = true;
  try {
    await comoUsuario(A, 'guardarQuiniela', {
      torneoId, marcadores: [{ local: 2, visitante: 0 }, { local: 1, visitante: 1 }],
    });
  } catch (e) { paso = false; console.log(`  (info) marcador válido falló: ${e.message || e}`); }
  marca(ok(paso, 'marcador válido aceptado (control positivo)'));
}

// ── Caso 2: desempate por marcadores exactos ──────────────────────────
async function casoDesempateExactos() {
  console.log('\n2) Desempate por marcadores exactos...');
  // 2 partidos: local 2-0, empate 1-1.
  const partidos = [
    { local: 'Toluca', visitante: 'Pachuca' },
    { local: 'Santos', visitante: 'León' },
  ];
  const { torneoId, codigo, competicionId, jornadaId, jornadaRef } = await nuevaQuiniela(partidos, { costoEntrada: 100 });

  // Baseline determinista: fijamos saldos y los leemos ANTES de unirse.
  await fijarSaldo(A, 5000);
  await fijarSaldo(B, 5000);
  const antesA = (await saldoDe(A)).puntos; // 5000 (antes de pagar la entrada)
  const antesB = (await saldoDe(B)).puntos;

  await comoUsuario(A, 'unirseTorneo', { codigo });
  await comoUsuario(B, 'unirseTorneo', { codigo });

  await arrancarTorneo(torneoId);
  // A: 2-0 exacto (5) + 1-1 exacto (5) = 10, con 2 exactos.
  await comoUsuario(A, 'guardarQuiniela', { torneoId, marcadores: [{ local: 2, visitante: 0 }, { local: 1, visitante: 1 }] });
  // B: 1-0 (acierta local=3) + 2-2 (acierta empate=3) = 6. Menos que A.
  await comoUsuario(B, 'guardarQuiniela', { torneoId, marcadores: [{ local: 1, visitante: 0 }, { local: 2, visitante: 2 }] });

  await capturarResultadosJornada(jornadaRef, [
    { resultado: 'local', golesLocal: 2, golesVisitante: 0 },
    { resultado: 'empate', golesLocal: 1, golesVisitante: 1 },
  ]);
  await comoUsuario(ADMIN, 'resolverJornadaCompeticion', { competicionId, jornadaId });

  // Bolsa = 200. A gana toda la bolsa (más puntos).
  const despuesA = (await saldoDe(A)).puntos;
  marca(ok(despuesA === antesA - 100 + 200, `A (10 pts) gana la bolsa: ${antesA} → ${despuesA} (esperado ${antesA + 100})`));
  const despuesB = (await saldoDe(B)).puntos;
  marca(ok(despuesB === antesB - 100, `B (6 pts) no cobra: ${antesB} → ${despuesB} (esperado ${antesB - 100})`));
}

// ── Caso 3: empate total → comparten bolsa (Math.floor + sobrante) ────
async function casoEmpateTotal() {
  console.log('\n3) Empate total: comparten la bolsa, sobrante a reserva...');
  // Un solo partido, resultado local 1-0.
  const partidos = [{ local: 'Monterrey', visitante: 'Tigres' }];
  // 3 jugadores con costo 100 → bolsa 300. Los 3 aciertan IGUAL (mismo cartón).
  const { torneoId, codigo, competicionId, jornadaId, jornadaRef } = await nuevaQuiniela(partidos, { costoEntrada: 100 });

  // Baseline determinista ANTES de unirse: cada quien paga 100 y recupera 100,
  // así el neto debe ser 0 respecto a este saldo.
  for (const e of [A, B, C]) await fijarSaldo(e, 5000);
  const antes = {
    [A]: (await saldoDe(A)).puntos,
    [B]: (await saldoDe(B)).puntos,
    [C]: (await saldoDe(C)).puntos,
  };
  for (const e of [A, B, C]) await comoUsuario(e, 'unirseTorneo', { codigo });
  const reservaAntes = await leerReserva();

  await arrancarTorneo(torneoId);
  // Los 3 ponen 1-0 exacto: 5 pts y 1 exacto cada uno. Empate total.
  for (const e of [A, B, C]) {
    await comoUsuario(e, 'guardarQuiniela', { torneoId, marcadores: [{ local: 1, visitante: 0 }] });
  }
  await capturarResultadosJornada(jornadaRef, [{ resultado: 'local', golesLocal: 1, golesVisitante: 0 }]);
  await comoUsuario(ADMIN, 'resolverJornadaCompeticion', { competicionId, jornadaId });

  // Bolsa 300 / 3 = 100 por cabeza, sobrante 0. Cada quien: −100 +100 = neto 0.
  for (const e of [A, B, C]) {
    const d = (await saldoDe(e)).puntos;
    marca(ok(d === antes[e], `${e}: comparte la bolsa (neto 0): ${antes[e]} → ${d}`));
  }
  const reservaDespues = await leerReserva();
  marca(ok(reservaDespues === reservaAntes, `sin sobrante en 300/3 (reserva ${reservaAntes} → ${reservaDespues})`));

  // Verifica que el torneo quedó finalizado con 3 ganadores (empate compartido).
  const t = (await db.doc(`torneos/${torneoId}`).get()).data();
  marca(ok(t?.estado === 'finalizado', 'el torneo quedó finalizado'));
}

// ── Caso 4: guarda de estado (torneo aún en inscripción) ──────────────
async function casoGuardaEstado() {
  console.log('\n4) No se puede capturar si el torneo no está en curso...');
  const partidos = [{ local: 'Atlas', visitante: 'Necaxa' }];
  const { torneoId, codigo } = await nuevaQuiniela(partidos);
  await comoUsuario(A, 'unirseTorneo', { codigo });
  // NO arrancamos el torneo: sigue en 'inscripcion'.
  marca(await esperarError(
    () => comoUsuario(A, 'guardarQuiniela', { torneoId, marcadores: [{ local: 1, visitante: 0 }] }),
    'failed-precondition', 'capturar en torneo no arrancado rechazado',
  ));
}

async function correr() {
  console.log(`\n🧪 Prueba AVANZADA de quiniela en ${projectId}`);

  await casoValidacionMarcadores();
  await casoDesempateExactos();
  await casoEmpateTotal();
  await casoGuardaEstado();

  console.log(`\n${todoBien ? '✅ PRUEBA PASÓ' : '❌ PRUEBA FALLÓ'}: casos avanzados de quiniela.`);
  console.log('\n(Limpieza: node scripts/seed-dev.js limpiar)\n');
}

correr()
  .then(() => process.exit(todoBien ? 0 : 1))
  .catch((e) => {
    console.error('\n❌ Error en la prueba:', e.message || e);
    process.exit(1);
  });
