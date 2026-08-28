# Scripts de prueba — Quiniela (solo DEV)

Estos scripts prueban la app en el proyecto **dev** (`quiniela-dev-d203d`), nunca en producción. Todos tienen un candado que se niega a correr si el proyecto no es dev.

## Archivos

| Archivo | Qué hace |
|---|---|
| `seed-dev.js` | Crea (o borra) datos de prueba: usuarios, partidos, torneos. |
| `prueba-partido.js` | Prueba el flujo completo de un partido llamando a las funciones reales (lógica y reparto de puntos). |
| `prueba-partido-ui.spec.js` | Prueba la interfaz con un navegador real (Playwright). |

---

## Preparación (una sola vez)

### 1. Credenciales de dev

Necesitas dos archivos en la carpeta `scripts/` (NUNCA los subas a git):

**`service-account-dev.json`** — cuenta de servicio con permisos de admin.
- Consola Firebase → proyecto **dev** → ⚙️ Configuración → Cuentas de servicio → "Generar nueva clave privada".
- Guarda el JSON descargado como `scripts/service-account-dev.json`.

**`config-dev.json`** — configuración pública de la app (solo para `prueba-partido.js`).
```json
{
  "apiKey": "TU_API_KEY_DE_DEV",
  "projectId": "quiniela-dev-d203d"
}
```
- La `apiKey` la sacas de tu `environment.ts` (la config de Firebase) o de la consola.

### 2. Protege las credenciales en git

Agrega a tu `.gitignore` (en la raíz del proyecto):
```
scripts/service-account-dev.json
scripts/config-dev.json
```
Los scripts (`*.js`) SÍ pueden ir a git; los archivos de credenciales NO.

### 3. Instala dependencias

Desde la raíz del proyecto:
```bash
npm install firebase firebase-admin
```
Y solo si vas a usar la prueba de navegador:
```bash
npm install -D @playwright/test
npx playwright install chromium
```

---

## Cómo se usan

### Paso 1 — Sembrar datos de prueba

```bash
node scripts/seed-dev.js seed
```

Crea en dev: 1 admin (10000 pts), 4 jugadores (5000 pts), 1 jugador con poco saldo (50 pts), 2 partidos y 2 torneos (survivor + quiniela). Todo marcado como `esPrueba: true`.

**Contraseña de todos los usuarios de prueba:** `prueba1234`

Para borrar todo lo sembrado cuando termines:
```bash
node scripts/seed-dev.js limpiar
```

### Paso 2 — Probar el flujo del partido (lógica y dinero)

```bash
node scripts/prueba-partido.js
```

Qué hace:
1. Crea un partido de prueba.
2. Los 5 usuarios pronostican (llamando a `crearPronostico` real, autenticados).
3. El admin liquida (`liquidarPartido` real).
4. Verifica que el reparto de puntos cuadre e imprime ✅ o ❌ por cada usuario.

Necesita que antes hayas corrido `seed` (usa los usuarios de prueba).

### Paso 3 — Probar la interfaz (navegador)

```bash
DEV_URL="https://TU-APP-DEV.web.app" PARTIDO_ID="ID_DE_UN_PARTIDO_ABIERTO" npx playwright test scripts/prueba-partido-ui.spec.js
```

- `DEV_URL`: la URL de tu app dev desplegada.
- `PARTIDO_ID`: el id de un partido abierto (lo copias de la consola de Firebase, o de la URL al entrar a un partido).

Qué hace: abre un navegador, cada usuario hace login real y pronostica con clics, verificando que la interfaz funcione.

---

## Requisito importante: funciones abiertas en Cloud Run (dev)

Para que `prueba-partido.js` funcione, las funciones `onCall` que llama deben estar accesibles en el proyecto dev. Si te da error de permisos, revisa que `crearPronostico` y `liquidarPartido` estén desplegadas y abiertas en dev.

---

## Notas de seguridad

- **Candado anti-producción:** todos los scripts se niegan a correr si el `projectId` no contiene "dev".
- **Limpieza etiquetada:** todo lo que crea el seed lleva `esPrueba: true`, así `limpiar` borra exactamente eso sin tocar datos reales.
- Los schedulers en dev corren al doble de intervalo que en prod: los procesos automáticos tardan más (es esperado).
