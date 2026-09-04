# Acceso público de las funciones (Cloud Run) y costo de App Check

## Fecha: 3 de septiembre 2027

Dos temas relacionados pero distintos:
1. Qué funciones necesitan **"Permitir el acceso público"** en la pestaña
   Seguridad de Cloud Run (autenticación a nivel de red/IAM).
2. Cuánto cuesta activar **App Check** (protección contra abuso).

---

## 1. ¿Qué es "Permitir acceso público" aquí?

Es la sección **Autenticación** de la pestaña Seguridad de la función en la
consola de Google Cloud (Cloud Run). Controla si el endpoint HTTP se puede
invocar sin credenciales IAM.

- **Permitir acceso público**: cualquiera puede *invocar* el endpoint. La
  autenticación real la hace tu código con el token de Firebase Auth
  (`req.auth?.uid`) y las validaciones de admin.
- **Requerir autenticación**: Cloud Run rechaza la llamada ANTES de que tu
  función vea el token de Firebase → **la app deja de funcionar**.

> REGLA: para funciones **`onCall`** de Firebase, lo correcto es
> **"Permitir el acceso público"**. NO cambiar a "Requerir autenticación".
> La protección real es Firebase Auth (dentro del código) + App Check (opcional).

### Qué tipo necesita qué

| Tipo | ¿Acceso público? | Por qué |
|------|------------------|---------|
| `onCall` (llamadas del navegador) | **SÍ, público** | El SDK las invoca por HTTPS sin credencial IAM. |
| `onRequest` (webhook HTTP) | **SÍ, público** | Lo llama un tercero (Telegram) sin credencial IAM. |
| `onSchedule` (programadas) | **NO aplica** | Las dispara Cloud Scheduler interno; no se exponen. |

---

## 2. Funciones `onCall` que van en "Permitir acceso público" (por dominio)

**Todas** las de esta lista deben quedar en público. Agrupadas por el
dominio del refactor.

### Partidos (5)
- `crearPronostico`
- `liquidarPartido`
- `cancelarPartido`
- `crearPartidoGrupo`
- `liquidarPartidoGrupo`

### Bolsas / mantenimiento de partidos (1)
- `recalcularBolsas`

### Torneos (10)
- `crearTorneo`
- `unirseTorneo`
- `revivir`
- `guardarPick`
- `guardarQuiniela`
- `previsualizarQuiniela`
- `resolverJornadaCompeticion`
- `finalizarTorneo`
- `resolverPendientes`
- `consultarTorneo`

### Brackets / eliminatorias (9)
- `crearBracket`
- `asignarLlaveBracket`
- `asignarDuenoBracket`
- `aceptarDuenoBracket`
- `rechazarDuenoBracket`
- `capturarPartidoBracket`
- `calificarBracket`
- `guardarPronosticoBracket`
- `unirseBracket`
- `consultarBracket`

### Grupos (8)
- `crearGrupo`
- `unirseAGrupo`
- `agregarMiembroGrupo`
- `salirDeGrupo`
- `hacerAdminGrupo`
- `quitarAdminGrupo`
- `marcarGrupoFavorito`
- `buscarUsuariosPorAlias`

### Usuarios / ranking (6)
- `recalcularRanking`
- `backfillTotales`
- `reiniciarPuntos`
- `eliminarUsuarios`
- `sincronizarHistoricos`
- `cambiarAlias`

### Notificaciones — canal (5)
- `guardarPrefsNotif`
- `guardarPush`
- `guardarTelegram`
- `vincularTelegram`
- `avisarRegistro`

### Cuenta / acceso (2)
- `solicitarReinicio`
- `validarTurnstile`

### API externa (football-data / TheSportsDB) (7)
- `buscarFixtures`
- `buscarFixturesSportsDb`
- `formaEquiposApi`
- `traerJornadaApi`
- `traerResultadosApi`
- `refrescarTablaApi`
- `importarEquiposApi`

### Webhook HTTP — también público (`onRequest`) (1)
- `telegramWebhook`

### Programadas (`onSchedule`) — NO requieren acceso público (10)
`cerrarPartidos`, `revisarResultados`, `revisarResultadosSportsDb`,
`actualizarMarcadoresEnVivo`, `cerrarInscripciones`, `recordarJornada`,
`avisarOportunidades`, `avisarDuenosPendientes`, `cerrarBrackets`,
`revisarJornadas`.

---

## 3. ¿Cómo hacerlo masivo (no una por una en la consola)?

### La buena noticia: normalmente NO hay que tocarlo

Firebase Functions v2 (Cloud Run) **ya despliega las `onCall` como públicas por
defecto** (`allUsers` con rol Invoker). Si ves "Permitir acceso público" en la
captura, es porque ya está bien. Solo hay que actuar si alguna quedó en
"Requerir autenticación" (p. ej. por una política de la organización que
bloquea `allUsers`).

### Opción A — gcloud, función por función (rápido y explícito)

```bash
gcloud functions add-invoker-policy-binding liquidarPartido \
  --region=us-central1 --member="allUsers"
```

(en v1 el equivalente es `gcloud run services add-iam-policy-binding <svc>
--member=allUsers --role=roles/run.invoker`.)

### Opción B — todas las `onCall`/`onRequest` de un jalón (bash/PowerShell)

Lista de nombres públicos (las de arriba, sin las `onSchedule`). Ejemplo en
PowerShell recorriendo un arreglo:

```powershell
$region = "us-central1"
$publicas = @(
  "crearPronostico","liquidarPartido","cancelarPartido","crearPartidoGrupo",
  "liquidarPartidoGrupo","recalcularBolsas","crearTorneo","unirseTorneo",
  "revivir","guardarPick","guardarQuiniela","previsualizarQuiniela",
  "resolverJornadaCompeticion","finalizarTorneo","resolverPendientes",
  "consultarTorneo","crearBracket","asignarLlaveBracket","asignarDuenoBracket",
  "aceptarDuenoBracket","rechazarDuenoBracket","capturarPartidoBracket",
  "calificarBracket","guardarPronosticoBracket","unirseBracket",
  "consultarBracket","crearGrupo","unirseAGrupo","agregarMiembroGrupo",
  "salirDeGrupo","hacerAdminGrupo","quitarAdminGrupo","marcarGrupoFavorito",
  "buscarUsuariosPorAlias","recalcularRanking","backfillTotales",
  "reiniciarPuntos","eliminarUsuarios","sincronizarHistoricos","cambiarAlias",
  "guardarPrefsNotif","guardarPush","guardarTelegram","vincularTelegram",
  "avisarRegistro","solicitarReinicio","validarTurnstile","buscarFixtures",
  "buscarFixturesSportsDb","formaEquiposApi","traerJornadaApi",
  "traerResultadosApi","refrescarTablaApi","importarEquiposApi","telegramWebhook"
)
foreach ($f in $publicas) {
  gcloud functions add-invoker-policy-binding $f --region=$region --member="allUsers"
}
```

> Ejecutar con la cuenta/proyecto correctos (`gcloud config set project ...`).
> Si la organización prohíbe `allUsers` (Domain Restricted Sharing), hay que
> pedir una excepción de la política; no se puede saltar desde aquí.

### Opción C — evitar el problema desde el código

En v2 se puede fijar el invoker en el deploy para que salga público siempre:

```ts
export const liquidarPartido = onCall(
  { ...opcionesCall, invoker: 'public' },
  async (req) => { /* ... */ }
);
```

Se podría añadir `invoker: 'public'` a `opcionesCall` en `comun.ts` y aplicaría
a todas de una vez. Solo hacerlo si de verdad alguna se está desplegando
privada; si ya salen públicas por defecto, no hace falta.

---

## 4. Costo real de activar App Check

App Check es la protección que evita que **clientes no autorizados** (scripts,
apps clonadas) llamen tus funciones aunque el endpoint sea público. Es la capa
que hoy tienes apagada (`EXIGIR_APP_CHECK = false` en `comun.ts`).

### El servicio App Check: **gratis**
App Check en sí **no tiene costo** (sujeto a cuotas según el proveedor de
attestation). No cobra por "verificación". Fuente:
[Firebase Pricing](https://firebase.google.com/pricing) — dice explícitamente
que es sin costo, sujeto a cuotas por proveedor. *Contenido reformulado para
cumplir con las restricciones de licencia.*

### El costo REAL está en el proveedor de attestation (solo en WEB)
En web, el proveedor recomendado es **reCAPTCHA Enterprise** (o reCAPTCHA v3).
Ese servicio SÍ tiene una tarifa por "assessment" (cada verificación):

| Volumen mensual | Costo |
|-----------------|-------|
| Hasta **10,000** assessments | **Gratis** |
| 10,001 – 100,000 | **$8 USD** fijo por ese tramo |
| Más de 100,000 | **$1 USD por cada 1,000** ($0.001 c/u) |

Fuente:
[Compare reCAPTCHA tiers](https://cloud.google.com/recaptcha-enterprise/docs/compare-tiers)
y [Billing](https://cloud.google.com/recaptcha/docs/billing-information).
*Contenido reformulado para cumplir con las restricciones de licencia.*

> OJO (cuota): los 10,000 gratis son **por organización** (agregan todos los
> sitios/cuentas), no por proyecto. Fuente:
> [reCAPTCHA quotas](https://docs.cloud.google.com/recaptcha/quotas).

### En apps móviles: sin ese costo
Los proveedores móviles (Play Integrity en Android, App Attest/DeviceCheck en
iOS) **no** cobran como reCAPTCHA. El costo de reCAPTCHA aplica al cliente WEB.

### ¿Cuántos "assessments" gastarías?
App Check en web genera un token que se renueva cada cierto tiempo (por defecto
~1 hora, cacheado). NO es 1 assessment por cada llamada a función, sino
aproximadamente **1 por sesión/renovación de token**. Para una quiniela con
pocos usuarios activos, es casi seguro que caes dentro de los **10,000 gratis**
al mes.

### Estimación para tu caso (orden de magnitud)
- Con reCAPTCHA Enterprise en web y tráfico bajo/medio (decenas o pocos
  cientos de usuarios): **$0** (dentro del tramo gratis de 10,000/mes).
- Solo pasarías a **$8/mes** si superas 10,000 renovaciones de token en un mes
  (mucho tráfico o tokens muy cortos).
- El servicio App Check y la parte de Functions **no** suman cargo extra por
  activarlo; lo de Functions ya lo pagas por invocación con o sin App Check.

### Recomendación
- Activar App Check con **reCAPTCHA Enterprise** en web: costo esperado **$0**
  al volumen actual.
- Antes de poner `EXIGIR_APP_CHECK = true` en `comun.ts`: registrar App Check
  en la consola de Firebase, configurar el proveedor, y **probar en dev** que
  la app sigue respondiendo. Si se activa sin registrar, las funciones dejan de
  responder.

---

## Resumen de una línea
- **Acceso público**: déjalo así en todas las `onCall`/`onRequest` (54 en
  total); las `onSchedule` no aplican. Normalmente ya salen públicas solas.
- **App Check**: el servicio es gratis; el único costo posible es reCAPTCHA
  Enterprise en web, con **10,000 verificaciones gratis/mes** — a tu volumen,
  esperado **$0**.
