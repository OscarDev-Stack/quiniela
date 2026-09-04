/**
 * PRUEBA DE FLUJO — Torneo QUINIELA POR PUNTOS.
 *
 * Ciclo completo con funciones reales:
 *   1. Admin crea competición + jornada y un torneo quiniela (jornadas=1).
 *   2. Usuarios se inscriben (unirseTorneo).
 *   3. Se arranca y cada uno captura marcadores (guardarQuiniela).
 *   4. Admin captura resultados y resuelve (resolverJornadaCompeticion) → califica
 *      y, por ser la última jornada, cierra y reparte la bolsa.
 *   5. Se VERIFICA el puntaje (5 exacto / 3 resultado) y que el ganador cobró.
 *
 * USO:  node scripts/prueba-quiniela.js
 * REQUISITOS: ver scripts/_prueba-comun.js.
 */

const {
  projectId, db, saldoDe, comoUsuario, ok,
  crearCompeticionConJornada, capturarResultadosJornada, arrancarTorneo, marcarPrueba,
} = require('./_prueba-comun');

const ADMIN = 'prueba_admin@quiniela.test';

// 2 partidos en la jornada.
const PARTIDOS = [
  { local: 'América', visitante: 'Guadalajara' },
  { local: 'Cruz Azul', visitante: 'Pumas' },
];
// Resultados reales: 2-0 (local) y 1-1 (empate).
const RESULTADOS = [
  { resultado: 'local', golesLocal: 2, golesVisitante: 0 },
  { resultado: 'empate', golesLocal: 1, golesVisitante: 1 },
];

// Marcadores de cada jugador (mismo orden que PARTIDOS) y su puntaje esperado.
//  exacto = 5, solo resultado = 3.
const JUGADORES = [
  // A: 2-0 exacto (5) + 1-1 exacto (5) = 10
  { email: 'prueba_a@quiniela.test', marcadores: [{ local: 2, visitante: 0 }, { local: 1, visitante: 1 }], puntos: 10 },
  // B: 1-0 (acierta local=3) + 0-0 (acierta empate=3) = 6
  { email: 'prueba_b@quiniela.test', marcadores: [{ local: 1, visitante: 0 }, { local: 0, visitante: 0 }], puntos: 6 },
  // C: 0-2 (falla, visitante) + 2-2 (acierta empate=3) = 3
  { email: 'prueba_c@quiniela.test', marcadores: [{ local: 0, visitante: 2 }, { local: 2, visitante: 2 }], puntos: 3 },
];

const COSTO = 100;

async function correr() {
  console.log(`\n🧪 Prueba QUINIELA POR PUNTOS en ${projectId}\n`);

  console.log('1) Creando competición, jornada y torneo quiniela...');
  const { competicionId, jornadaId, jornadaRef } = await crearCompeticionConJornada(PARTIDOS);
  const creado = await comoUsuario(ADMIN, 'crearTorneo', {
    nombre: 'Quiniela Auto',
    modo: 'quiniela',
    competicionId,
    competicionNombre: 'Liga de Prueba (auto)',
    jornadaInicial: 1,
    jornadas: 1, // una sola jornada → al resolverla se cierra y reparte.
    costoEntrada: COSTO,
    porcentajeBote: 0,
    cierreInscripcion: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  });
  const torneoId = creado.id;
  await marcarPrueba('torneos', torneoId);
  console.log(`   torneo ${torneoId} (código ${creado.codigo})\n`);

  const antes = {};
  for (const j of JUGADORES) antes[j.email] = (await saldoDe(j.email)).puntos;

  console.log('2) Inscripción...');
  for (const j of JUGADORES) {
    await comoUsuario(j.email, 'unirseTorneo', { codigo: creado.codigo });
    console.log(`   ✓ ${j.email} inscrito`);
  }
  console.log('');

  console.log('3) Arrancando y capturando marcadores...');
  await arrancarTorneo(torneoId);
  for (const j of JUGADORES) {
    const r = await comoUsuario(j.email, 'guardarQuiniela', { torneoId, marcadores: j.marcadores });
    console.log(`   ✓ ${j.email}: ${r.partidos} marcadores`);
  }
  console.log('');

  console.log('4) Capturando resultados y resolviendo (última jornada → cierra)...');
  await capturarResultadosJornada(jornadaRef, RESULTADOS);
  const res = await comoUsuario(ADMIN, 'resolverJornadaCompeticion', { competicionId, jornadaId });
  console.log(`   Resultado: ${JSON.stringify(res)}\n`);

  console.log('5) Verificando puntaje y reparto...');
  let todoBien = true;

  // Puntaje de cada participante.
  for (const j of JUGADORES) {
    const uid = (await saldoDe(j.email)).uid;
    const part = (await db.doc(`torneos/${torneoId}/participantes/${uid}`).get()).data();
    const pts = Number(part?.['puntosTorneo'] ?? 0);
    const bien = pts === j.puntos;
    todoBien = todoBien && bien;
    ok(bien, `${j.email}: ${pts} pts (esperado ${j.puntos})`);
  }

  // Bolsa = suma de entradas; A tiene más puntos → gana la bolsa completa (1 ganador).
  const bolsa = COSTO * JUGADORES.length;
  const ganador = JUGADORES[0]; // A, con 10 pts
  const ahoraGanador = (await saldoDe(ganador.email)).puntos;
  // Entró pagando COSTO y recibió la bolsa completa.
  const esperadoGanador = antes[ganador.email] - COSTO + bolsa;
  todoBien = ok(
    ahoraGanador === esperadoGanador,
    `${ganador.email} (ganador): ${antes[ganador.email]} → ${ahoraGanador} (esperado ${esperadoGanador})`,
  ) && todoBien;

  // El torneo quedó finalizado.
  const tFinal = (await db.doc(`torneos/${torneoId}`).get()).data();
  todoBien = ok(tFinal?.estado === 'finalizado', 'El torneo quedó finalizado') && todoBien;

  console.log(`\n${todoBien ? '✅ PRUEBA PASÓ' : '❌ PRUEBA FALLÓ'}: quiniela ${todoBien ? 'cuadra' : 'NO cuadra'}.`);
  console.log('\n(Limpieza: node scripts/seed-dev.js limpiar)\n');
}

correr()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌ Error en la prueba:', e.message || e);
    process.exit(1);
  });
