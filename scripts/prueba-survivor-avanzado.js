/**
 * PRUEBA AVANZADA — Survivor (casos difíciles y borde).
 *
 * Ataca la lógica fina de supervivencia que el happy path no toca:
 *   - No elegir equipo cuenta como derrota.
 *   - Empate sin vida = eliminado; con vida = sobrevive con una menos.
 *   - vidaCubre 'tropiezo': la derrota también consume vida (no elimina).
 *   - No se puede repetir un equipo ya usado.
 *   - Revivir: ventana (solo la jornada siguiente), una sola vez,
 *     costo = round((jornadaActual/2) * entrada).
 *   - Resolver dos veces la misma jornada es idempotente.
 *
 * USO:  node scripts/prueba-survivor-avanzado.js
 * REQUISITOS: ver scripts/_prueba-comun.js (seed + credenciales dev).
 */

const {
  projectId, db, saldoDe, comoUsuario, ok, esperarError,
  crearCompeticionConJornada, capturarResultadosJornada, arrancarTorneo,
  marcarPrueba, participanteDe, fijarSaldo, fijarJornadaTorneo,
} = require('./_prueba-comun');

const ADMIN = 'prueba_admin@quiniela.test';
const A = 'prueba_a@quiniela.test';
const B = 'prueba_b@quiniela.test';
const C = 'prueba_c@quiniela.test';
const D = 'prueba_d@quiniela.test';

let todoBien = true;
const marca = (cond) => { todoBien = todoBien && cond; };

/** Crea un survivor arrancado con una jornada y devuelve ids + código. */
async function nuevoSurvivor(partidos, opciones = {}) {
  const { competicionId, jornadaId, jornadaRef } = await crearCompeticionConJornada(partidos, {
    numero: opciones.numero ?? 1,
  });
  const creado = await comoUsuario(ADMIN, 'crearTorneo', {
    nombre: opciones.nombre ?? 'Survivor Avanzado (auto)',
    modo: 'supervivencia',
    competicionId,
    competicionNombre: 'Liga de Prueba (auto)',
    jornadaInicial: opciones.numero ?? 1,
    vidas: opciones.vidas ?? 1,
    vidaCubre: opciones.vidaCubre ?? 'empate',
    permiteRevivir: opciones.permiteRevivir ?? false,
    costoEntrada: opciones.costoEntrada ?? 100,
    porcentajeBote: 0,
    cierreInscripcion: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  });
  await marcarPrueba('torneos', creado.id);
  return { torneoId: creado.id, codigo: creado.codigo, competicionId, jornadaId, jornadaRef };
}

// ── Caso 1: sin pick = derrota; empate sin vida = eliminado; gana sobrevive ──
async function casoResoluciones() {
  console.log('\n1) Sin pick = derrota; empate sin vida = eliminado...');
  // 1 vida, vidaCubre 'empate'. Partidos: América gana, Cruz Azul empata.
  const partidos = [
    { local: 'América', visitante: 'Guadalajara' },
    { local: 'Cruz Azul', visitante: 'Pumas' },
  ];
  const { torneoId, codigo, competicionId, jornadaId, jornadaRef } = await nuevoSurvivor(partidos, { vidas: 1 });

  for (const email of [A, B, C, D]) await comoUsuario(email, 'unirseTorneo', { codigo });
  await arrancarTorneo(torneoId);

  // A elige ganador (América), B elige empate (Cruz Azul), C elige perdedor (Guadalajara).
  // D NO elige (sin pick = derrota).
  await comoUsuario(A, 'guardarPick', { torneoId, equipo: 'América' });
  await comoUsuario(B, 'guardarPick', { torneoId, equipo: 'Cruz Azul' });
  await comoUsuario(C, 'guardarPick', { torneoId, equipo: 'Guadalajara' });

  await capturarResultadosJornada(jornadaRef, [
    { resultado: 'local', golesLocal: 2, golesVisitante: 0 },   // gana América
    { resultado: 'empate', golesLocal: 1, golesVisitante: 1 },  // empata Cruz Azul
  ]);
  await comoUsuario(ADMIN, 'resolverJornadaCompeticion', { competicionId, jornadaId });

  const ua = (await saldoDe(A)).uid, ub = (await saldoDe(B)).uid;
  const uc = (await saldoDe(C)).uid, ud = (await saldoDe(D)).uid;
  const pa = await participanteDe(torneoId, ua);
  const pb = await participanteDe(torneoId, ub);
  const pc = await participanteDe(torneoId, uc);
  const pd = await participanteDe(torneoId, ud);

  marca(ok(pa?.vivo === true, `A (ganador) sobrevive (vivo=${pa?.vivo})`));
  // B empató con 1 vida: la consume y sobrevive con 0.
  marca(ok(pb?.vivo === true && pb?.vidasRestantes === 0,
    `B (empate, gastó su vida) sobrevive con 0 vidas (vivo=${pb?.vivo}, vidas=${pb?.vidasRestantes})`));
  marca(ok(pc?.vivo === false, `C (perdió) eliminado (vivo=${pc?.vivo})`));
  marca(ok(pd?.vivo === false, `D (sin elegir) eliminado (vivo=${pd?.vivo})`));

  // Idempotencia: resolver otra vez la misma jornada debe fallar.
  marca(await esperarError(
    () => comoUsuario(ADMIN, 'resolverJornadaCompeticion', { competicionId, jornadaId }),
    'failed-precondition', 'segunda resolución de la jornada rechazada',
  ));
}

// ── Caso 2: vidaCubre 'tropiezo' — la derrota también consume vida ────
async function casoTropiezo() {
  console.log('\n2) vidaCubre "tropiezo": la derrota consume vida en vez de eliminar...');
  const partidos = [{ local: 'Toluca', visitante: 'Pachuca' }];
  const { torneoId, codigo, competicionId, jornadaId, jornadaRef } =
    await nuevoSurvivor(partidos, { vidas: 2, vidaCubre: 'tropiezo' });

  await comoUsuario(A, 'unirseTorneo', { codigo });
  await arrancarTorneo(torneoId);
  // A elige al PERDEDOR (Pachuca): con 'tropiezo' y 2 vidas, sobrevive con 1.
  await comoUsuario(A, 'guardarPick', { torneoId, equipo: 'Pachuca' });

  await capturarResultadosJornada(jornadaRef, [
    { resultado: 'local', golesLocal: 3, golesVisitante: 1 }, // Toluca gana, Pachuca pierde
  ]);
  await comoUsuario(ADMIN, 'resolverJornadaCompeticion', { competicionId, jornadaId });

  const ua = (await saldoDe(A)).uid;
  const pa = await participanteDe(torneoId, ua);
  marca(ok(pa?.vivo === true && pa?.vidasRestantes === 1,
    `A perdió pero 'tropiezo' lo cubre: vivo con 1 vida (vivo=${pa?.vivo}, vidas=${pa?.vidasRestantes})`));
}

// ── Caso 3: no repetir un equipo ya usado ─────────────────────────────
async function casoEquipoRepetido() {
  console.log('\n3) No se puede repetir un equipo ya usado...');
  const partidos = [{ local: 'Monterrey', visitante: 'Tigres' }];
  const { torneoId, codigo } = await nuevoSurvivor(partidos, { vidas: 3 });

  await comoUsuario(A, 'unirseTorneo', { codigo });
  await arrancarTorneo(torneoId);
  await comoUsuario(A, 'guardarPick', { torneoId, equipo: 'Monterrey' });

  // Volver a elegir Monterrey en la misma jornada: ya lo tiene marcado como usado.
  marca(await esperarError(
    () => comoUsuario(A, 'guardarPick', { torneoId, equipo: 'Monterrey' }),
    'failed-precondition', 'repetir el mismo equipo rechazado',
  ));

  // Un equipo que no juega en la jornada: invalid-argument.
  marca(await esperarError(
    () => comoUsuario(A, 'guardarPick', { torneoId, equipo: 'Barcelona' }),
    'invalid-argument', 'equipo que no juega en la jornada rechazado',
  ));
}

// ── Caso 4: revivir (ventana, costo, una sola vez) ────────────────────
async function casoRevivir() {
  console.log('\n4) Revivir: ventana, costo y una sola vez...');
  const partidos = [{ local: 'Santos', visitante: 'León' }];
  const { torneoId, codigo, competicionId, jornadaId, jornadaRef } =
    await nuevoSurvivor(partidos, { vidas: 1, permiteRevivir: true, costoEntrada: 100 });

  await comoUsuario(A, 'unirseTorneo', { codigo });
  await fijarSaldo(A, 5000);
  await arrancarTorneo(torneoId);
  // A elige al perdedor y cae en la jornada 1.
  await comoUsuario(A, 'guardarPick', { torneoId, equipo: 'León' });
  await capturarResultadosJornada(jornadaRef, [
    { resultado: 'local', golesLocal: 1, golesVisitante: 0 }, // Santos gana, León pierde
  ]);
  await comoUsuario(ADMIN, 'resolverJornadaCompeticion', { competicionId, jornadaId });

  const ua = (await saldoDe(A)).uid;
  let pa = await participanteDe(torneoId, ua);
  // El torneo puede haberse cerrado (quedó 0 vivos). Para probar revivir hace
  // falta que siga en-curso y estar en la jornada siguiente a la caída.
  await db.doc(`torneos/${torneoId}`).update({ estado: 'en-curso' });
  marca(ok(pa?.vivo === false && pa?.eliminadoEn === 1, `A cayó en la jornada 1 (eliminadoEn=${pa?.eliminadoEn})`));

  // Aún estamos en jornada 1 (no avanzó a la 2 por quedar sin vivos): revivir
  // debe rechazarse porque la ventana es la jornada eliminadoEn+1.
  marca(await esperarError(
    () => comoUsuario(A, 'revivir', { torneoId }),
    'failed-precondition', 'revivir fuera de ventana (misma jornada) rechazado',
  ));

  // Movemos el torneo a la jornada 2 (la ventana correcta) y revivimos.
  await fijarJornadaTorneo(torneoId, 2);
  const saldoAntes = (await saldoDe(A)).puntos;
  const r = await comoUsuario(A, 'revivir', { torneoId });
  // costo = round((2/2) * 100) = 100.
  const saldoDespues = (await saldoDe(A)).puntos;
  marca(ok(r.costo === 100, `costo de revivir en jornada 2 = ${r.costo} (esperado 100)`));
  marca(ok(saldoDespues === saldoAntes - 100, `se cobró el revivir: ${saldoAntes} → ${saldoDespues}`));
  pa = await participanteDe(torneoId, ua);
  marca(ok(pa?.vivo === true, `A revivió (vivo=${pa?.vivo})`));

  // Segundo revivir: ya revivió una vez → rechazado.
  marca(await esperarError(
    () => comoUsuario(A, 'revivir', { torneoId }),
    'failed-precondition', 'segundo revivir rechazado (ya revivió / sigue vivo)',
  ));
}

async function correr() {
  console.log(`\n🧪 Prueba AVANZADA de survivor en ${projectId}`);

  await casoResoluciones();
  await casoTropiezo();
  await casoEquipoRepetido();
  await casoRevivir();

  console.log(`\n${todoBien ? '✅ PRUEBA PASÓ' : '❌ PRUEBA FALLÓ'}: casos avanzados de survivor.`);
  console.log('\n(Limpieza: node scripts/seed-dev.js limpiar. Restaurar saldos: seed de nuevo.)\n');
}

correr()
  .then(() => process.exit(todoBien ? 0 : 1))
  .catch((e) => {
    console.error('\n❌ Error en la prueba:', e.message || e);
    process.exit(1);
  });
