/**
 * PRUEBA DE FLUJO — Eliminatoria (BRACKET) modo PRONÓSTICO.
 *
 * Ciclo completo con funciones reales:
 *   1. Admin crea un bracket de 4 equipos (siembra, avance fijo, formato único).
 *   2. Usuarios guardan su pronóstico (guardarPronosticoBracket) — se cobra entrada.
 *   3. Admin captura los resultados (capturarPartidoBracket) hasta la final.
 *   4. Admin califica (calificarBracket) → reparte la bolsa por posición.
 *   5. Se VERIFICA el puntaje por pronóstico y que el 1° lugar cobró.
 *
 * Cuadro (4 equipos, siembra 1..4): R0-L0 = seed1 vs seed4, R0-L1 = seed2 vs seed3.
 * Ganadores van a R1-L0 (la final). Avance fijo.
 *
 * USO:  node scripts/prueba-bracket-pronostico.js
 * REQUISITOS: ver scripts/_prueba-comun.js.
 */

const {
  projectId, db, saldoDe, comoUsuario, ok, arrancarBracket, marcarPrueba,
} = require('./_prueba-comun');

const ADMIN = 'prueba_admin@quiniela.test';

const EQUIPOS = [
  { nombre: 'América', siembra: 1 },
  { nombre: 'Guadalajara', siembra: 2 },
  { nombre: 'Cruz Azul', siembra: 3 },
  { nombre: 'Pumas', siembra: 4 },
];
// Siembra (mejor vs peor): R0-L0 = América(1) vs Pumas(4); R0-L1 = Guadalajara(2) vs Cruz Azul(3).
// Resultados reales que capturaremos:
//   R0-L0: América gana → avanza América
//   R0-L1: Cruz Azul gana → avanza Cruz Azul
//   R1-L0 (final): América gana → CAMPEÓN América
const PUNTAJE = { avanzaPorRonda: [1, 2], campeon: 5, finalista: 3, marcadorExacto: 3, marcadorResultado: 1 };

// Pronósticos por usuario (avances por llave). El campeón real es América.
// OJO con el puntaje: con 4 equipos hay 2 rondas (R0, R1). En calificarBk,
// "semifinal" es la ronda totalRondas-2, que aquí es R0. Así que cada acierto
// en R0 suma avanzaPorRonda[0] (1) + finalista (3) = 4. En R1 (final) suma
// avanzaPorRonda[1] (2) + campeon (5) = 7.
const JUGADORES = [
  {
    // A acierta todo: R0-L0 América, R0-L1 Cruz Azul, final América.
    // R0: 2 aciertos ×(1+3)=8 ; R1(final): (2+5)=7 ; total 15.
    email: 'prueba_a@quiniela.test',
    avances: { 'R0-L0': 'América', 'R0-L1': 'Cruz Azul', 'R1-L0': 'América' },
    puntos: 15,
  },
  {
    // B: R0-L0 América (1+3=4), R0-L1 Guadalajara (falla, 0), final América (2+5=7).
    // total = 4 + 0 + 7 = 11.
    email: 'prueba_b@quiniela.test',
    avances: { 'R0-L0': 'América', 'R0-L1': 'Guadalajara', 'R1-L0': 'América' },
    puntos: 11,
  },
];

const COSTO = 100;

async function correr() {
  console.log(`\n🧪 Prueba BRACKET PRONÓSTICO en ${projectId}\n`);

  console.log('1) Creando bracket (4 equipos, siembra, avance fijo)...');
  const creado = await comoUsuario(ADMIN, 'crearBracket', {
    nombre: 'Bracket Pronóstico Auto',
    modo: 'pronostico',
    config: {
      equipos: 4,
      armado: 'siembra',
      formatoRondas: 'unico',
      formatoFinal: 'unico',
      avance: 'fijo',
      reparto: [100],
      desempateRondas: 'penales',
      desempateFinal: 'penales',
    },
    puntaje: PUNTAJE,
    equipos: EQUIPOS,
    costoEntrada: COSTO,
    porcentajeBote: 0,
    cierraAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  });
  const bracketId = creado.id;
  await marcarPrueba('brackets', bracketId);
  console.log(`   bracket ${bracketId}\n`);

  const antes = {};
  for (const j of JUGADORES) antes[j.email] = (await saldoDe(j.email)).puntos;

  console.log('2) Pronósticos (se cobra entrada la primera vez)...');
  for (const j of JUGADORES) {
    await comoUsuario(j.email, 'guardarPronosticoBracket', { bracketId, avances: j.avances });
    console.log(`   ✓ ${j.email} pronosticó`);
  }
  console.log('');

  console.log('3) Capturando resultados hasta la final...');
  await arrancarBracket(bracketId);
  // R0-L0: América (local, siembra1) vs Pumas (visitante) → gana América 1-0
  await comoUsuario(ADMIN, 'capturarPartidoBracket', { bracketId, idLlave: 'R0-L0', indicePartido: 0, golesLocal: 1, golesVisitante: 0 });
  // R0-L1: Guadalajara (local, siembra2) vs Cruz Azul (visitante) → gana Cruz Azul 0-1
  await comoUsuario(ADMIN, 'capturarPartidoBracket', { bracketId, idLlave: 'R0-L1', indicePartido: 0, golesLocal: 0, golesVisitante: 1 });
  // Final R1-L0: América vs Cruz Azul → gana América 2-1
  await comoUsuario(ADMIN, 'capturarPartidoBracket', { bracketId, idLlave: 'R1-L0', indicePartido: 0, golesLocal: 2, golesVisitante: 1 });
  console.log('   ✓ capturadas R0-L0, R0-L1 y la final\n');

  // Verificar que el cuadro quedó finalizado con América campeón.
  const bTrasCaptura = (await db.doc(`brackets/${bracketId}`).get()).data();
  let todoBien = true;
  todoBien = ok(bTrasCaptura?.estado === 'finalizado', `Cuadro finalizado (ganador ${bTrasCaptura?.ganadorAlias})`) && todoBien;
  todoBien = ok(bTrasCaptura?.ganadorAlias === 'América', 'El campeón es América') && todoBien;

  console.log('\n4) Calificando y repartiendo...');
  const res = await comoUsuario(ADMIN, 'calificarBracket', { bracketId });
  console.log(`   Resultado: ${JSON.stringify(res)}\n`);

  console.log('5) Verificando puntaje y premio...');
  for (const j of JUGADORES) {
    const uid = (await saldoDe(j.email)).uid;
    const pron = (await db.doc(`brackets/${bracketId}/pronosticos/${uid}`).get()).data();
    const pts = Number(pron?.['puntos'] ?? 0);
    const bien = pts === j.puntos;
    todoBien = todoBien && bien;
    ok(bien, `${j.email}: ${pts} pts (esperado ${j.puntos}), posición ${pron?.['posicion']}`);
  }

  // A es 1° (9 > 8) y con reparto [100] se lleva toda la bolsa.
  const bolsa = COSTO * JUGADORES.length;
  const ganador = JUGADORES[0];
  const ahoraGanador = (await saldoDe(ganador.email)).puntos;
  const esperadoGanador = antes[ganador.email] - COSTO + bolsa;
  todoBien = ok(
    ahoraGanador === esperadoGanador,
    `${ganador.email} (1° lugar): ${antes[ganador.email]} → ${ahoraGanador} (esperado ${esperadoGanador})`,
  ) && todoBien;

  console.log(`\n${todoBien ? '✅ PRUEBA PASÓ' : '❌ PRUEBA FALLÓ'}: bracket pronóstico ${todoBien ? 'cuadra' : 'NO cuadra'}.`);
  console.log('\n(Limpieza: node scripts/seed-dev.js limpiar)\n');
}

correr()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌ Error en la prueba:', e.message || e);
    process.exit(1);
  });
