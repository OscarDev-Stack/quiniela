# Scripts de prueba — Quiniela (solo DEV)

Estos scripts prueban la app en el proyecto **dev** (`quiniela-dev-d203d`), nunca en producción. Todos tienen un candado que se niega a correr si el proyecto no es dev.

## Archivos

| Archivo | Qué hace |
|---|---|
| `seed-dev.js` | Crea (o borra) datos de prueba: usuarios, partidos, torneos, competiciones. |
| `_prueba-comun.js` | Helpers compartidos por los scripts de flujo (login, saldos, crear competición/jornada, arrancar torneo/bracket). No se corre solo. |
| `prueba-partido.js` | Flujo completo de un partido individual (lógica y reparto de puntos). |
| `prueba-survivor.js` | Flujo completo de un torneo de supervivencia. |
| `prueba-survivor-nfl.js` | Survivor con equipos NFL: valida escudos, bye week y empate. |
| `prueba-quiniela.js` | Flujo completo de un torneo de quiniela por puntos. |
| `prueba-bracket-pronostico.js` | Flujo completo de una eliminatoria modo pronóstico. |
| `prueba-bracket-duenos.js` | Flujo completo de una eliminatoria modo dueños. |
| `prueba-partido-avanzado.js` | **Casos difíciles** de partido: edición de pronóstico, tope de saldo, multiplicador inválido, cerrado/liquidado, nadie/todos aciertan, redondeo del bote, doble liquidación. |
| `prueba-survivor-avanzado.js` | **Casos difíciles** de survivor: sin pick, empate sin/con vida, `vidaCubre` tropiezo, no repetir equipo, revivir (ventana/costo/una vez), idempotencia. |
| `prueba-quiniela-avanzado.js` | **Casos difíciles** de quiniela: marcadores fuera de rango/longitud, desempate por exactos, empate total compartido, guardas de estado. |
| `prueba-brackets-avanzado.js` | **Casos difíciles** de brackets: reparto que debe sumar 100, dueños aceptar/rechazar/idempotencia, aceptar sin saldo, calificar dueños y chequeo de pago doble. |
| `prueba-seguridad.js` | **Autorización transversal**: qué NO pueden hacer los usuarios comunes ni las cuentas sin validar; protección al borrar; límites de alias. |
| `prueba-partido-ui.spec.js` | Prueba la interfaz con un navegador real (Playwright). |
| `PLAN-DE-PRUEBAS.md` | Checklist manual dev → prod. |

Todos los scripts de flujo (`prueba-*.js`, menos el `.spec.js`) llaman a las Cloud
Functions reales autenticándose como cada usuario y verifican el reparto de puntos.
Comparten el candado anti-producción y los helpers de `_prueba-comun.js`.

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

## Atajo: correr TODAS las pruebas de un jalón

```bash
npm run pruebas
```

Esto hace, en orden: **seed** (crea los usuarios de prueba) → las 6 pruebas de
flujo (partido, survivor, survivor NFL, quiniela, bracket pronóstico, bracket
dueños) → las **5 pruebas avanzadas** (partido, survivor, quiniela y brackets
en sus casos difíciles, más seguridad) → un **resumen ✅/❌** al final.

> Las pruebas avanzadas ajustan el saldo de algunos jugadores a propósito (para
> probar el tope de −1000). Si después quieres volver a correr las de flujo con
> los saldos originales, corre de nuevo `node scripts/seed-dev.js seed`.

**No borra nada:** los datos quedan en dev para que los revises en la app / consola.
Cuando termines de mirar:

```bash
npm run pruebas:limpiar     # borra todo lo marcado esPrueba
```

Si ya sembraste antes y solo quieres repetir las pruebas sin re-sembrar:

```bash
node scripts/run-pruebas.js --no-seed
```

> Requiere los dos archivos de credenciales (abajo). Si faltan, el runner se
> detiene en el seed con un mensaje claro.

---

## Cómo se usan (paso a paso, manual)

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

### Paso 2b — Probar torneos y eliminatorias (lógica y dinero)

Cada uno crea sus propios datos (competición + jornada, torneo o bracket), corre
el ciclo completo con funciones reales y verifica el reparto:

```bash
node scripts/prueba-survivor.js            # supervivencia
node scripts/prueba-survivor-nfl.js        # supervivencia NFL (bye week + empate)
node scripts/prueba-quiniela.js            # quiniela por puntos
node scripts/prueba-bracket-pronostico.js  # eliminatoria pronóstico
node scripts/prueba-bracket-duenos.js      # eliminatoria dueños
```

También requieren `seed` antes (usan los usuarios de prueba a/b/c/d y admin).
Fuerzan el estado a `en-curso` por Admin SDK para no esperar los schedulers.
Al terminar, `node scripts/seed-dev.js limpiar` borra todo (incluidas las
competiciones/jornadas que crearon, marcadas `esPrueba`).

### Paso 2c — Casos difíciles (pruebas avanzadas)

Las de flujo confirman que el camino feliz funciona. Estas otras atacan las
**validaciones, la aritmética con redondeo, la idempotencia y los permisos**:
esperan que ciertas llamadas **fallen** con el código correcto, y verifican al
céntimo los repartos con bote y sobrante.

```bash
node scripts/prueba-partido-avanzado.js    # edición, tope, bote/redondeo, doble liquidación
node scripts/prueba-survivor-avanzado.js   # vidas, tropiezo, no repetir equipo, revivir
node scripts/prueba-quiniela-avanzado.js   # marcadores inválidos, desempate, empate total
node scripts/prueba-brackets-avanzado.js   # reparto=100, dueños aceptar/rechazar, pago doble
node scripts/prueba-seguridad.js           # qué NO puede hacer un usuario común / sin validar
```

Cada una crea sus propios datos y los marca `esPrueba`. Al final imprime
`✅ PRUEBA PASÓ` / `❌ PRUEBA FALLÓ`. Como algunas fijan saldos para probar el
tope de −1000, corre `node scripts/seed-dev.js seed` si necesitas restaurarlos.

> `prueba-brackets-avanzado.js` verifica que una segunda llamada a
> `calificarBracket` se **rechace** (guarda de idempotencia): el bracket se
> marca `repartido: true` al calificar, así un doble "Publicar" o un reintento
> no vuelve a pagar la bolsa.

### Paso 3 — Probar la interfaz (navegador)

```bash
DEV_URL="https://TU-APP-DEV.web.app" PARTIDO_ID="ID_DE_UN_PARTIDO_ABIERTO" npx playwright test scripts/prueba-partido-ui.spec.js
```

- `DEV_URL`: la URL de tu app dev desplegada.
- `PARTIDO_ID`: el id de un partido abierto (lo copias de la consola de Firebase, o de la URL al entrar a un partido).

Qué hace: abre un navegador, cada usuario hace login real y pronostica con clics, verificando que la interfaz funcione.

---

## Funciones abiertas en Cloud Run (dev)

Ya no hay que abrirlas a mano: todas las `onCall` usan `invoker: 'public'`
(en `functions/src/comun.ts`), así que cada deploy las deja públicas a nivel de
red. La seguridad real la da `req.auth` dentro de cada función. Si un script da
error de permisos de red, confirma que el deploy de esa función tomó ese cambio.

---

## Notas de seguridad

- **Candado anti-producción:** todos los scripts se niegan a correr si el `projectId` no contiene "dev".
- **Limpieza etiquetada:** todo lo que crea el seed lleva `esPrueba: true`, así `limpiar` borra exactamente eso sin tocar datos reales.
- Los schedulers en dev corren al doble de intervalo que en prod: los procesos automáticos tardan más (es esperado).
