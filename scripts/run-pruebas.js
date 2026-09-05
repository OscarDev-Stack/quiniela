/**
 * RUNNER — corre todas las pruebas de flujo de una vez.
 *
 * Hace: seed (crea usuarios de prueba) → las 6 pruebas de flujo → resumen ✅/❌.
 * NO limpia: los datos quedan en dev para que los revises. Cuando termines de
 * mirar, corre a mano:  node scripts/seed-dev.js limpiar
 *
 * USO:
 *   node scripts/run-pruebas.js            (seed + todas las pruebas)
 *   node scripts/run-pruebas.js --no-seed  (solo las pruebas; usa los usuarios ya sembrados)
 *
 * Entre pruebas hace una pausa (por defecto 20 s) para no agotar la cuota de
 * verificación de contraseñas de Firebase Auth. Ajústala con PAUSA_PRUEBAS:
 *   PAUSA_PRUEBAS=0  node scripts/run-pruebas.js   (sin pausa; puede dar quota-exceeded)
 *   PAUSA_PRUEBAS=30 node scripts/run-pruebas.js   (pausa más larga)
 *
 * REQUISITOS: scripts/service-account-dev.json y scripts/config-dev.json
 * (mismos que los demás scripts). Candado anti-producción incluido.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const noSeed = process.argv.includes('--no-seed');

// Pausa entre pruebas (segundos). Firebase Auth limita cuántas verificaciones
// de contraseña acepta por ventana de tiempo; correr las 11 pruebas seguidas
// (cada una con varios logins) puede disparar 'auth/quota-exceeded'. Una pausa
// breve entre pruebas deja que la cuota se recupere. Ajustable con la variable
// de entorno PAUSA_PRUEBAS (0 para desactivar). Por defecto 20 s.
const PAUSA_SEG = Number(process.env.PAUSA_PRUEBAS ?? 20);

/** Pausa bloqueante (spawnSync ya es síncrono, así que no usamos async). */
function dormir(segundos) {
  if (segundos <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, segundos * 1000);
}

// Orden: primero el seed (si aplica), luego las pruebas.
const pasos = [];
if (!noSeed) pasos.push({ nombre: 'Seed de datos', archivo: 'seed-dev.js', args: ['seed'] });
pasos.push(
  // ── Flujo (happy path): confirma que cada modo funciona de punta a punta ──
  { nombre: 'Partido individual', archivo: 'prueba-partido.js' },
  { nombre: 'Survivor', archivo: 'prueba-survivor.js' },
  { nombre: 'Survivor NFL', archivo: 'prueba-survivor-nfl.js' },
  { nombre: 'Quiniela por puntos', archivo: 'prueba-quiniela.js' },
  { nombre: 'Bracket pronóstico', archivo: 'prueba-bracket-pronostico.js' },
  { nombre: 'Bracket dueños', archivo: 'prueba-bracket-duenos.js' },
  // ── Avanzadas (casos difíciles): validaciones, aritmética, idempotencia ──
  { nombre: 'Partido (avanzado)', archivo: 'prueba-partido-avanzado.js' },
  { nombre: 'Survivor (avanzado)', archivo: 'prueba-survivor-avanzado.js' },
  { nombre: 'Quiniela (avanzado)', archivo: 'prueba-quiniela-avanzado.js' },
  { nombre: 'Brackets (avanzado)', archivo: 'prueba-brackets-avanzado.js' },
  { nombre: 'Seguridad', archivo: 'prueba-seguridad.js' },
);

const resultados = [];

for (const paso of pasos) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`▶  ${paso.nombre}  (${paso.archivo})`);
  console.log('═'.repeat(60));

  const r = spawnSync(
    process.execPath, // el mismo 'node' que ejecuta este runner
    [path.join(__dirname, paso.archivo), ...(paso.args ?? [])],
    { stdio: 'inherit' },
  );

  const paso_ok = r.status === 0;
  resultados.push({ nombre: paso.nombre, ok: paso_ok });

  // Si el seed falla (credenciales, etc.), no tiene sentido seguir.
  if (paso.archivo === 'seed-dev.js' && !paso_ok) {
    console.error('\n❌ El seed falló. Revisa las credenciales de dev. Abortando.\n');
    process.exit(1);
  }

  // Respiro entre pruebas para no agotar la cuota de logins de Firebase Auth.
  const esUltimo = paso === pasos[pasos.length - 1];
  if (!esUltimo && PAUSA_SEG > 0) {
    console.log(`\n⏳ Pausa de ${PAUSA_SEG}s (evita 'auth/quota-exceeded')...`);
    dormir(PAUSA_SEG);
  }
}

// ── Resumen ──────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log('  RESUMEN');
console.log('═'.repeat(60));
for (const r of resultados) {
  console.log(`  ${r.ok ? '✅' : '❌'}  ${r.nombre}`);
}

const fallaron = resultados.filter((r) => !r.ok).length;
console.log('');
if (fallaron === 0) {
  console.log('✅ Todas las pruebas pasaron.');
} else {
  console.log(`❌ ${fallaron} prueba(s) fallaron (revisa el detalle arriba).`);
}

console.log('\nLos datos de prueba quedaron en dev para que los revises.');
console.log('Nota: las pruebas avanzadas ajustan saldos de algunos jugadores.');
console.log('  Restaurar saldos:  node scripts/seed-dev.js seed');
console.log('  Borrar todo:       node scripts/seed-dev.js limpiar\n');

process.exit(fallaron === 0 ? 0 : 1);
