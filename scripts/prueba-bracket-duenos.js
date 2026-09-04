/**
 * PRUEBA DE FLUJO — Eliminatoria (BRACKET) modo DUEÑOS.
 *
 * Ciclo completo con funciones reales:
 *   1. Admin crea un bracket de 4 equipos en modo 'duenos' (siembra, avance fijo).
 *   2. Admin asigna cada equipo a un usuario (asignarDuenoBracket).
 *   3. Cada dueño acepta y paga la entrada (aceptarDuenoBracket).
 *   4. Admin captura resultados hasta la final (capturarPartidoBracket).
 *   5. Admin califica (calificarBracket) → el dueño del campeón se lleva la bolsa.
 *   6. Se VERIFICA el cobro de entrada y que el dueño del campeón cobró la bolsa.
 *
 * USO:  node scripts/prueba-bracket-duenos.js
 * REQUISITOS: ver scripts/_prueba-comun.js.
 */

const {
  projectId, db, saldoDe, uidDe, comoUsuario, ok, arrancarBracket, marcarPrueba,
} = require('./_prueba-comun');

const ADMIN = 'prueba_admin@quiniela.test';

// 4 equipos, cada uno con un dueño registrado.
const EQUIPOS = [
  { nombre: 'América', siembra: 1 },
  { nombre: 'Guadalajara', siembra: 2 },
  { nombre: 'Cruz Azul', siembra: 3 },
  { nombre: 'Pumas', siembra: 4 },
];
const DUENOS = [
  { email: 'prueba_a@quiniela.test', equipo: 'América' },      // será el campeón
  { email: 'prueba_b@quiniela.test', equipo: 'Guadalajara' },
  { email: 'prueba_c@quiniela.test', equipo: 'Cruz Azul' },
  { email: 'prueba_d@quiniela.test', equipo: 'Pumas' },
];

const COSTO = 100;

async function correr() {
  console.log(`\n🧪 Prueba BRACKET DUEÑOS en ${projectId}\n`);

  console.log('1) Creando bracket de dueños (4 equipos, siembra)...');
  const creado = await comoUsuario(ADMIN, 'crearBracket', {
    nombre: 'Bracket Dueños Auto',
    modo: 'duenos',
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
    puntaje: { avanzaPorRonda: [1, 2], campeon: 5, finalista: 3, marcadorExacto: 3, marcadorResultado: 1 },
    equipos: EQUIPOS,
    costoEntrada: COSTO,
    porcentajeBote: 0,
    cierraAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  });
  const bracketId = creado.id;
  await marcarPrueba('brackets', bracketId);
  console.log(`   bracket ${bracketId}\n`);

  const antes = {};
  for (const d of DUENOS) antes[d.email] = (await saldoDe(d.email)).puntos;

  console.log('2) Asignando dueños...');
  for (const d of DUENOS) {
    const duenoUid = await uidDe(d.email);
    await comoUsuario(ADMIN, 'asignarDuenoBracket', { bracketId, equipo: d.equipo, duenoUid });
    console.log(`   ✓ ${d.equipo} → ${d.email}`);
  }
  console.log('');

  console.log('3) Cada dueño acepta y paga...');
  for (const d of DUENOS) {
    await comoUsuario(d.email, 'aceptarDuenoBracket', { bracketId });
    console.log(`   ✓ ${d.email} aceptó`);
  }
  console.log('');

  console.log('4) Capturando resultados hasta la final...');
  await arrancarBracket(bracketId);
  // Siembra: R0-L0 = América(1) vs Pumas(4); R0-L1 = Guadalajara(2) vs Cruz Azul(3).
  await comoUsuario(ADMIN, 'capturarPartidoBracket', { bracketId, idLlave: 'R0-L0', indicePartido: 0, golesLocal: 3, golesVisitante: 0 }); // América
  await comoUsuario(ADMIN, 'capturarPartidoBracket', { bracketId, idLlave: 'R0-L1', indicePartido: 0, golesLocal: 2, golesVisitante: 1 }); // Guadalajara
  // Final: América vs Guadalajara → gana América.
  await comoUsuario(ADMIN, 'capturarPartidoBracket', { bracketId, idLlave: 'R1-L0', indicePartido: 0, golesLocal: 1, golesVisitante: 0 });
  console.log('   ✓ capturadas todas; campeón esperado: América\n');

  let todoBien = true;
  const bTrasCaptura = (await db.doc(`brackets/${bracketId}`).get()).data();
  todoBien = ok(bTrasCaptura?.estado === 'finalizado', `Cuadro finalizado (ganador ${bTrasCaptura?.ganadorAlias})`) && todoBien;

  console.log('\n5) Calificando (el dueño del campeón cobra la bolsa)...');
  const res = await comoUsuario(ADMIN, 'calificarBracket', { bracketId });
  console.log(`   Resultado: ${JSON.stringify(res)}\n`);

  console.log('6) Verificando cobros...');
  // Todos pagaron la entrada.
  const bolsa = COSTO * DUENOS.length;
  for (const d of DUENOS) {
    const ahora = (await saldoDe(d.email)).puntos;
    const esCampeon = d.equipo === 'América';
    // Campeón: pagó entrada y recibió la bolsa completa. Resto: solo pagó.
    const esperado = esCampeon ? antes[d.email] - COSTO + bolsa : antes[d.email] - COSTO;
    const bien = ahora === esperado;
    todoBien = todoBien && bien;
    ok(bien, `${d.email} (${d.equipo}${esCampeon ? ', CAMPEÓN' : ''}): ${antes[d.email]} → ${ahora} (esperado ${esperado})`);
  }

  // ganadorAlias = alias del dueño del campeón (Prueba a).
  const bFinal = (await db.doc(`brackets/${bracketId}`).get()).data();
  todoBien = ok(!!bFinal?.ganadorAlias, `Ganador registrado: ${bFinal?.ganadorAlias}`) && todoBien;

  console.log(`\n${todoBien ? '✅ PRUEBA PASÓ' : '❌ PRUEBA FALLÓ'}: bracket dueños ${todoBien ? 'cuadra' : 'NO cuadra'}.`);
  console.log('\n(Limpieza: node scripts/seed-dev.js limpiar)\n');
}

correr()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌ Error en la prueba:', e.message || e);
    process.exit(1);
  });
