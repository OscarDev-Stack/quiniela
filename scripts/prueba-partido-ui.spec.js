/**
 * PRUEBA DE INTERFAZ — Partido individual (Opción 2: Playwright).
 *
 * Abre un navegador real y simula a los usuarios haciendo clic, para
 * validar que la INTERFAZ funciona: login, ver el partido, seleccionar
 * resultado y multiplicador, confirmar. Complementa a prueba-partido.js
 * (que valida la lógica/dinero sin navegador).
 *
 * QUÉ NECESITA ANTES:
 *   1. Datos sembrados en dev:  node scripts/seed-dev.js seed
 *   2. Un partido ABIERTO en dev y su ID. Puedes crearlo con el seed
 *      (crea 2 partidos) y copiar un id desde la consola de Firebase,
 *      o pasar el id por variable de entorno PARTIDO_ID.
 *   3. La URL de dev en la variable DEV_URL.
 *
 * USO:
 *   npm install -D @playwright/test
 *   npx playwright install chromium
 *   DEV_URL="https://tu-app-dev.web.app" PARTIDO_ID="abc123" npx playwright test scripts/prueba-partido-ui.spec.js
 *
 * NOTA: esta prueba hace clics reales. Si cambias clases CSS de los
 * botones (.option, .mult, .confirm) o el flujo, hay que ajustarla.
 */

const { test, expect } = require('@playwright/test');

const DEV_URL = process.env.DEV_URL || 'https://TU-APP-DEV.web.app';
const PARTIDO_ID = process.env.PARTIDO_ID || '';
const PASSWORD = 'prueba1234';

// Los usuarios de prueba (creados por el seed) y su elección.
const USUARIOS = [
  { email: 'prueba_a@quiniela.test', resultado: 0, mult: 0 }, // 1ª opción, x1
  { email: 'prueba_b@quiniela.test', resultado: 0, mult: 1 }, // 1ª opción, x2
  { email: 'prueba_c@quiniela.test', resultado: 2, mult: 0 }, // 3ª opción, x1
];

/** Hace login en la app con el usuario dado. */
async function login(page, email) {
  // Primera visita para poder establecer localStorage.
  await page.goto(DEV_URL);

  await page.evaluate(() => {
    localStorage.setItem('versionVista', '2.1.0');
  });

  // Ahora sí entramos al login.
  await page.goto(`${DEV_URL}/login`);

  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');

  await page.waitForURL(
    (url) => !url.pathname.includes('/login'),
    { timeout: 15000 }
  );
}

test.describe('Flujo de pronóstico de partido', () => {
  test.skip(!PARTIDO_ID, 'Falta PARTIDO_ID: pásalo por variable de entorno.');

  for (const u of USUARIOS) {
    test(`${u.email} puede pronosticar`, async ({ page }) => {
      await login(page, u.email);

      // Ir directo a la pantalla de pronóstico del partido.
      await page.goto(`${DEV_URL}/pronosticar/${PARTIDO_ID}`);

      // Debe verse el bloque de opciones (partido abierto).
      const opciones = page.locator('.option');
      await expect(opciones.first()).toBeVisible({ timeout: 15000 });

      // Selecciona el resultado y el multiplicador indicados.
      await opciones.nth(u.resultado).click();
      const mults = page.locator('.mult');
      await mults.nth(u.mult).click();

      // Confirma.
      const confirmar = page.locator('.confirm');
      await expect(confirmar).toBeEnabled();
      await confirmar.click();

      // Tras confirmar, la app navega a "mis pronósticos".
      await page.waitForURL((url) => url.pathname.includes('mis-pronosticos'), { timeout: 15000 });
    });
  }

  test('un partido cerrado no deja pronosticar', async ({ page }) => {
    // Este caso asume que tienes un PARTIDO_CERRADO_ID a la mano.
    const cerradoId = process.env.PARTIDO_CERRADO_ID;
    test.skip(!cerradoId, 'Falta PARTIDO_CERRADO_ID para este caso.');

    await login(page, USUARIOS[0].email);
    await page.goto(`${DEV_URL}/pronosticar/${cerradoId}`);

    // Debe mostrar el mensaje de cerrado y NO las opciones.
    await expect(page.getByText(/ya cerró/i)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.option')).toHaveCount(0);
  });
});
