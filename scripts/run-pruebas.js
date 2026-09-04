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
 * REQUISITOS: scripts/service-account-dev.json y scripts/config-dev.json
 * (mismos que los demás scripts). Candado anti-producción incluido.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const noSeed = process.argv.includes('--no-seed');

// Orden: primero el seed (si aplica), luego las pruebas.
const pasos = [];
if (!noSeed) pasos.push({ nombre: 'Seed de datos', archivo: 'seed-dev.js', args: ['seed'] });
pasos.push(
  { nombre: 'Partido individual', archivo: 'prueba-partido.js' },
  { nombre: 'Survivor', archivo: 'prueba-survivor.js' },
  { nombre: 'Survivor NFL', archivo: 'prueba-survivor-nfl.js' },
  { nombre: 'Quiniela por puntos', archivo: 'prueba-quiniela.js' },
  { nombre: 'Bracket pronóstico', archivo: 'prueba-bracket-pronostico.js' },
  { nombre: 'Bracket dueños', archivo: 'prueba-bracket-duenos.js' },
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
console.log('Cuando termines de mirar:  node scripts/seed-dev.js limpiar\n');

process.exit(fallaron === 0 ? 0 : 1);
