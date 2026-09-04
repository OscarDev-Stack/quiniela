/**
 * PRUEBA DE FLUJO — Torneo SURVIVOR (supervivencia).
 *
 * Ciclo completo con funciones reales (sin navegador):
 *   1. Admin crea competición + jornada (Admin SDK) y un torneo survivor (crearTorneo).
 *   2. Varios usuarios se inscriben (unirseTorneo) — se cobra la entrada.
 *   3. Se arranca el torneo y cada uno elige equipo (guardarPick).
 *   4. Admin captura resultados y resuelve la jornada (resolverJornadaCompeticion).
 *   5. Se VERIFICA quién sobrevive / cae según su equipo, y el cobro de entrada.
 *
 * USO:  node scripts/prueba-survivor.js
 * REQUISITOS: ver scripts/_prueba-comun.js (service-account-dev + config-dev + seed).
 */

const {
  projectId, db, saldoDe, comoUsuario, ok,
  crearCompeticionConJornada, capturarResultadosJornada, arrancarTorneo, marcarPrueba,
} = require('./_prueba-comun');

const ADMIN = 'prueba_admin@quiniela.test';
// A elige GANADOR (sobrevive), B elige PERDEDOR (con 1 vida y vidaCubre=empate → eliminado),
// C elige EMPATE (con vidas cubre → sobrevive con una vida menos).
const JUGADORES = [
  { email: 'prueba_a@quiniela.test', equipo: 'América',     esperado: 'sobrevive' },
  { email: 'prueba_b@quiniela.test', equipo: 'Guadalajara', esperado: 'eliminado' },
  { email: 'prueba_c@quiniela.test', equipo: 'Cruz Azul',   esperado: 'sobrevive' },
];

// Jornada: América gana, Guadalajara pierde (mismo partido), Cruz Azul empata.
const PARTIDOS = [
  { local: 'América', visitante: 'Guadalajara' },
  { local: 'Cruz Azul', visitante: 'Pumas' },
];
const RESULTADOS = [
  { resultado: 'local', golesLocal: 2, golesVisitante: 0 },   // gana América
  { resultado: 'empate', golesLocal: 1, golesVisitante: 1 },  // empata Cruz Azul
];

const COSTO = 100;
const VIDAS = 1; // con 1 vida y vidaCubre 'empate': el empate resta la vida pero sobrevive; la derrota elimina.

async function correr() {
  console.log(`\n🧪 Prueba SURVIVOR en ${projectId}\n`);

  // 1. Competición + jornada.
  console.log('1) Creando competición y jornada...');
  const { competicionId, jornadaId, jornadaRef } = await crearCompeticionConJornada(PARTIDOS);
  console.log(`   competicion ${competicionId}, jornada ${jornadaId}`);

  // Torneo survivor (como admin).
  const creado = await comoUsuario(ADMIN, 'crearTorneo', {
    nombre: 'Survivor Auto',
    modo: 'supervivencia',
    competicionId,
    competicionNombre: 'Liga de Prueba (auto)',
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

  // Saldos antes.
  const antes = {};
  for (const j of JUGADORES) antes[j.email] = (await saldoDe(j.email)).puntos;

  // 2. Inscripción.
  console.log('2) Inscripción...');
  for (const j of JUGADORES) {
    const r = await comoUsuario(j.email, 'unirseTorneo', { codigo: creado.codigo });
    console.log(`   ✓ ${j.email} inscrito (costo ${r.costo})`);
  }
  console.log('');

  // 3. Arrancar + picks.
  console.log('3) Arrancando torneo y eligiendo equipos...');
  await arrancarTorneo(torneoId);
  for (const j of JUGADORES) {
    await comoUsuario(j.email, 'guardarPick', { torneoId, equipo: j.equipo });
    console.log(`   ✓ ${j.email} → ${j.equipo}`);
  }
  console.log('');

  // 4. Capturar resultados y resolver.
  console.log('4) Capturando resultados y resolviendo la jornada...');
  await capturarResultadosJornada(jornadaRef, RESULTADOS);
  const res = await comoUsuario(ADMIN, 'resolverJornadaCompeticion', { competicionId, jornadaId });
  console.log(`   Resultado: ${JSON.stringify(res)}\n`);

  // 5. Verificaciones.
  console.log('5) Verificando supervivencia y cobros...');
  let todoBien = true;

  // Cobro de entrada: cada quien bajó COSTO.
  for (const j of JUGADORES) {
    const ahora = (await saldoDe(j.email)).puntos;
    const bien = ahora === antes[j.email] - COSTO;
    todoBien = todoBien && bien;
    ok(bien, `${j.email}: cobro de entrada ${antes[j.email]} → ${ahora} (esperado ${antes[j.email] - COSTO})`);
  }

  // Estado vivo/eliminado según lo esperado.
  for (const j of JUGADORES) {
    const uid = (await saldoDe(j.email)).uid;
    const part = (await db.doc(`torneos/${torneoId}/participantes/${uid}`).get()).data();
    const vivo = part?.['vivo'] === true;
    const esperadoVivo = j.esperado === 'sobrevive';
    const bien = vivo === esperadoVivo;
    todoBien = todoBien && bien;
    ok(bien, `${j.email} (${j.equipo}): vivo=${vivo}, esperado ${j.esperado} (vidas restantes ${part?.['vidasRestantes']})`);
  }

  // La jornada quedó resuelta.
  const jornadaFinal = (await jornadaRef.get()).data();
  todoBien = ok(jornadaFinal?.estado === 'resuelta', 'La jornada quedó resuelta') && todoBien;

  console.log(`\n${todoBien ? '✅ PRUEBA PASÓ' : '❌ PRUEBA FALLÓ'}: survivor ${todoBien ? 'cuadra' : 'NO cuadra'}.`);
  console.log('\n(Limpieza: node scripts/seed-dev.js limpiar — nota: la competición/jornada auto quedan con esPrueba)\n');
}

correr()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌ Error en la prueba:', e.message || e);
    process.exit(1);
  });
