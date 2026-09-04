/**
 * PRUEBA DE FLUJO — Torneo SURVIVOR de NFL.
 *
 * Igual que prueba-survivor.js pero con equipos NFL y validando lo propio de
 * la NFL:
 *   - Equipos NFL reales (sus escudos existen en public/escudos/nfl-*.png).
 *   - Un equipo en BYE WEEK (no juega esa jornada) NO se puede elegir: el
 *     backend (guardarPick) debe rechazarlo con invalid-argument.
 *   - Empate NFL (raro): con 1 vida y vidaCubre='empate', resta la vida pero
 *     sobrevive.
 *
 * Nota: esta prueba usa una competición de prueba con partidos NFL puestos a
 * mano (no llama a TheSportsDB en vivo), para validar la LÓGICA del survivor
 * con NFL de forma determinista. La validación de la API real (traer semanas
 * 1-18, temporada "2026") está en el checklist manual del PLAN-DE-PRUEBAS.
 *
 * USO:  node scripts/prueba-survivor-nfl.js
 * REQUISITOS: ver scripts/_prueba-comun.js (service-account-dev + config-dev + seed).
 */

const {
  projectId, db, saldoDe, comoUsuario, ok,
  crearCompeticionConJornada, capturarResultadosJornada, arrancarTorneo, marcarPrueba,
} = require('./_prueba-comun');

const ADMIN = 'prueba_admin@quiniela.test';

// Jornada NFL (semana): 3 partidos = 6 equipos jugando. Los Cowboys quedan en
// BYE (no aparecen en ningún partido) para probar que no se pueden elegir.
const PARTIDOS = [
  { local: 'Kansas City Chiefs', visitante: 'Buffalo Bills' },
  { local: 'San Francisco 49ers', visitante: 'Philadelphia Eagles' },
  { local: 'Green Bay Packers', visitante: 'Detroit Lions' },
];
const EQUIPO_EN_BYE = 'Dallas Cowboys'; // no juega esta jornada.

// Resultados reales de la jornada:
//   Chiefs 27-24 Bills   → gana Chiefs
//   49ers 17-31 Eagles   → gana Eagles
//   Packers 20-20 Lions  → empate (raro en NFL, pero para probar la vida)
const RESULTADOS = [
  { resultado: 'local', golesLocal: 27, golesVisitante: 24 },
  { resultado: 'visitante', golesLocal: 17, golesVisitante: 31 },
  { resultado: 'empate', golesLocal: 20, golesVisitante: 20 },
];

// A elige ganador (Chiefs → sobrevive), B elige perdedor (49ers → eliminado con 1 vida),
// C elige el del empate (Packers → sobrevive gastando su única vida).
const JUGADORES = [
  { email: 'prueba_a@quiniela.test', equipo: 'Kansas City Chiefs',   esperado: 'sobrevive' },
  { email: 'prueba_b@quiniela.test', equipo: 'San Francisco 49ers',  esperado: 'eliminado' },
  { email: 'prueba_c@quiniela.test', equipo: 'Green Bay Packers',    esperado: 'sobrevive' },
];

const COSTO = 100;
const VIDAS = 1; // 1 vida, vidaCubre 'empate': empate resta la vida pero sobrevive; derrota elimina.

async function correr() {
  console.log(`\n🧪 Prueba SURVIVOR NFL en ${projectId}\n`);

  console.log('1) Creando competición y jornada NFL...');
  const { competicionId, jornadaId, jornadaRef } = await crearCompeticionConJornada(PARTIDOS);
  console.log(`   competicion ${competicionId}, jornada ${jornadaId}`);

  const creado = await comoUsuario(ADMIN, 'crearTorneo', {
    nombre: 'Survivor NFL Auto',
    modo: 'supervivencia',
    competicionId,
    competicionNombre: 'NFL de Prueba (auto)',
    jornadaInicial: 1,
    vidas: VIDAS,
    vidaCubre: 'empate',
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
    const r = await comoUsuario(j.email, 'unirseTorneo', { codigo: creado.codigo });
    console.log(`   ✓ ${j.email} inscrito (costo ${r.costo})`);
  }
  console.log('');

  console.log('3) Arrancando torneo y eligiendo equipos...');
  await arrancarTorneo(torneoId);

  let todoBien = true;

  // Caso BYE WEEK: intentar elegir un equipo que no juega esta jornada.
  console.log(`   Probando bye week: ${JUGADORES[0].email} intenta elegir ${EQUIPO_EN_BYE} (en bye)...`);
  let rechazado = false;
  try {
    await comoUsuario(JUGADORES[0].email, 'guardarPick', { torneoId, equipo: EQUIPO_EN_BYE });
  } catch (e) {
    rechazado = true;
    console.log(`     (rechazado: ${e.message || e})`);
  }
  todoBien = ok(rechazado, `Elegir un equipo en bye week fue rechazado (${EQUIPO_EN_BYE} no juega)`) && todoBien;

  // Picks válidos.
  for (const j of JUGADORES) {
    await comoUsuario(j.email, 'guardarPick', { torneoId, equipo: j.equipo });
    console.log(`   ✓ ${j.email} → ${j.equipo}`);
  }
  console.log('');

  console.log('4) Capturando resultados y resolviendo la jornada...');
  await capturarResultadosJornada(jornadaRef, RESULTADOS);
  const res = await comoUsuario(ADMIN, 'resolverJornadaCompeticion', { competicionId, jornadaId });
  console.log(`   Resultado: ${JSON.stringify(res)}\n`);

  console.log('5) Verificando supervivencia y cobros...');

  // Cobro de entrada.
  for (const j of JUGADORES) {
    const ahora = (await saldoDe(j.email)).puntos;
    const bien = ahora === antes[j.email] - COSTO;
    todoBien = todoBien && bien;
    ok(bien, `${j.email}: cobro de entrada ${antes[j.email]} → ${ahora} (esperado ${antes[j.email] - COSTO})`);
  }

  // Estado vivo/eliminado.
  for (const j of JUGADORES) {
    const uid = (await saldoDe(j.email)).uid;
    const part = (await db.doc(`torneos/${torneoId}/participantes/${uid}`).get()).data();
    const vivo = part?.['vivo'] === true;
    const esperadoVivo = j.esperado === 'sobrevive';
    const bien = vivo === esperadoVivo;
    todoBien = todoBien && bien;
    ok(bien, `${j.email} (${j.equipo}): vivo=${vivo}, esperado ${j.esperado} (vidas ${part?.['vidasRestantes']})`);
  }

  // El del empate (C) debe haber gastado su vida (queda en 0) pero seguir vivo.
  const uidC = (await saldoDe(JUGADORES[2].email)).uid;
  const partC = (await db.doc(`torneos/${torneoId}/participantes/${uidC}`).get()).data();
  todoBien = ok(
    Number(partC?.['vidasRestantes']) === 0,
    `${JUGADORES[2].email} empató: gastó su vida (vidas restantes ${partC?.['vidasRestantes']}, esperado 0)`,
  ) && todoBien;

  const jornadaFinal = (await jornadaRef.get()).data();
  todoBien = ok(jornadaFinal?.estado === 'resuelta', 'La jornada quedó resuelta') && todoBien;

  console.log(`\n${todoBien ? '✅ PRUEBA PASÓ' : '❌ PRUEBA FALLÓ'}: survivor NFL ${todoBien ? 'cuadra' : 'NO cuadra'}.`);
  console.log('\n(Limpieza: node scripts/seed-dev.js limpiar)\n');
}

correr()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌ Error en la prueba:', e.message || e);
    process.exit(1);
  });
