# Refactor del monolito de Cloud Functions en módulos por dominio

## Fecha: 3 de septiembre 2027

Se partió el monolito `functions/src/index.ts` (~5600 líneas, 65 funciones)
en módulos por dominio, **sin cambiar el nombre de ninguna función**. Las
funciones `onCall`/`onSchedule` se re-exportan desde `index.ts`, así Firebase
las ve con el mismo nombre y **NO re-crea ni re-despliega** funciones nuevas.

> Objetivo: **mantenibilidad**. NO reduce el número de funciones (siguen 65)
> ni acelera el deploy. El dolor del 429 de cuota se resolvió aparte, con el
> deploy selectivo del CI (ver `2027-09-03-deploy-functions-selectivo.md`).

## Regla de oro del refactor

- Cada dominio se mueve a su `dominio.ts` con `export const nombre = onCall(...)`
  **idéntico**.
- En `index.ts` se re-exporta: `export { funcA, funcB } from './dominio';`.
- Los helpers que usan varios dominios se **exportan** y se importan donde hagan
  falta (evita duplicar y romper el comportamiento).
- Verificación por fase: `tsc --noEmit` verde **y** el conteo de exports
  desplegables debe seguir siendo **65** (repartido entre index + módulos).
- Commit y push a `develop` por fase.

Contar exports desplegables:
```powershell
Select-String -Path functions/src/*.ts -Pattern "^export const (\w+) = on(Call|Schedule|Request)" | Measure-Object | Select-Object -Expand Count
```

## Módulos creados (estado actual)

### `functions/src/comun.ts` — base compartida (fase 1)
Lo transversal que usan todos los dominios:
- `initializeApp()` (corre una vez, aquí, antes de cualquier `getFirestore`).
- `db` (cliente Firestore compartido).
- Entorno: `esProd`, `cada(minutos)` (schedule por entorno).
- Constantes del juego: `APUESTA_BASE`, `TOPE_INFERIOR`, `MULTIPLICADOR_MAX`,
  `PRONOSTICOS_POR_LOTE`, `MIN_RESUELTOS`, `MINUTOS_ANTES_DE_CONSULTAR`.
- `opcionesCall` (opciones comunes de las `onCall`, incluye `enforceAppCheck`).
- Secrets: `footballDataKey`, `telegramToken`, `telegramWebhookSecret`,
  `turnstileSecret`, `sportsDbKey`.
- Bote: `calcularBote(monto, pct)`, `registrarBote(monto, origen)`.
- **`actualizarRanking(uids)`** — helper transversal (lo usan ~15 llamados de
  partidos, torneos, brackets y usuarios). Vive aquí para que cualquier módulo
  lo importe sin dependencias cruzadas.
- Re-export de `FieldValue`, `Timestamp`, `HttpsError` (un solo punto de import).

### `functions/src/notificaciones.ts` — helpers de aviso (fase 2)
Helpers exportados: `avisar`, `enviarPush`, `enviarTelegram`, `limpiarHtml`,
`APP_URL`, `linkPush`, `CategoriaNotif`, `DEFAULT_PREFS_NOTIF`,
`quiereCategoria`.
Las funciones `onCall`/`onRequest` del canal (`guardarPrefsNotif`, `guardarPush`,
`guardarTelegram`, `vincularTelegram`, `telegramWebhook`, `avisarRegistro`)
**siguen en `index.ts`** por ahora (usan los helpers de este módulo).

### `functions/src/grupos.ts` — grupos (fase 3)
8 funciones `onCall` (re-exportadas desde `index.ts`):
- `crearGrupo`
- `unirseAGrupo`
- `agregarMiembroGrupo`
- `salirDeGrupo`
- `hacerAdminGrupo`
- `quitarAdminGrupo`
- `marcarGrupoFavorito`
- `buscarUsuariosPorAlias`

Helpers:
- `generarCodigoGrupo()` — **privado** (código de invitación de 6 caracteres).
- **`esAdminDeGrupo(grupo, uid)`** — **exportado**; lo usan también
  torneos (`crearTorneo`), partidos (`crearPartidoGrupo`,
  `liquidarPartidoGrupo`) y brackets (`crearBracket`). `index.ts` lo importa.

### `functions/src/usuarios.ts` — usuarios y ranking (fase 4)
6 funciones `onCall` (re-exportadas desde `index.ts`):
- `recalcularRanking` — regenera todo el ranking de una vez (admin).
- `backfillTotales` — reconstruye `totalGastado`/`totalGanado` recorriendo el
  ledger, luego regenera ranking (admin, idempotente).
- `reiniciarPuntos` — pone el saldo de un jugador en 0 y deja constancia en el
  ledger (admin, transaccional).
- `eliminarUsuarios` — borra cuentas NO validadas (docs + Auth); nunca admins
  ni la propia (admin). Usa `getAuth()`.
- `sincronizarHistoricos` — iguala `puntosHistoricos` al saldo, una sola vez
  (admin).
- `cambiarAlias` — cambia el alias propio y lo propaga a ranking y grupos.

> Nota: `actualizarRanking` **no** vive aquí; se movió a `comun.ts` porque lo
> usan muchos dominios. `usuarios.ts` lo importa de `./comun`.

## Commits de esta tanda

| Fase | Módulo | Commit |
|------|--------|--------|
| 1 | `comun.ts` | `6ee5c93` |
| 2 | `notificaciones.ts` | `b3edf4a` |
| 3 | `grupos.ts` | `8f49f8b` |
| 4 | `usuarios.ts` (+ `actualizarRanking` a comun) | `708a3b9` |

Conteo tras la fase 4: `index.ts` 51 + `grupos.ts` 8 + `usuarios.ts` 6 = **65**.

## Seguridad de las funciones (App Check) — respuesta a la duda recurrente

El "tener seguridad en todas las funciones" que antes obligaba a configurar
cada `onCall` es **App Check** (`enforceAppCheck`). Hoy está **centralizado y
apagado** en `comun.ts`:

```ts
const EXIGIR_APP_CHECK = false;
export const opcionesCall = { enforceAppCheck: EXIGIR_APP_CHECK };
```

Como **todas** las `onCall` usan `opcionesCall`, ya **no** hay que tocar función
por función. Para endurecer, se cambia esa **única** línea a `true` (aplica a
las 65 a la vez), pero solo DESPUÉS de registrar App Check en Firebase y probar;
si se activa antes, la app deja de responder.

Sigue activa (y no estorba) la seguridad por función:
- **Auth**: casi todas validan `req.auth?.uid`; muchas exigen admin
  (`admins/{uid}`).
- **Turnstile** (`validarTurnstile`): captcha del portón previo al login,
  independiente de App Check.

## Pendiente del refactor (fases siguientes)

- Fase 5 **Partidos** (6): `crearPronostico`, `liquidarPartido`,
  `cerrarPartidos`, `cancelarPartido`, `crearPartidoGrupo`,
  `liquidarPartidoGrupo`.
- Fase 6 **Torneos** (12).
- Fase 7 **Brackets** (12).
- Sub-bloque **API TheSportsDB/football-data** (~11): `buscarFixtures`,
  `buscarFixturesSportsDb`, `formaEquiposApi`, `traerJornadaApi`,
  `traerResultadosApi`, `refrescarTablaApi`, `importarEquiposApi`,
  `revisarResultados`, `revisarResultadosSportsDb`,
  `actualizarMarcadoresEnVivo`, `revisarJornadas`.
- Notificaciones `onCall` (6): mover al módulo `notificaciones.ts` junto con
  sus helpers.
- `validarTurnstile` (1): queda en index o pasa a comun.
- Verificación final: lista de exports antes/después idéntica + `tsc` + deploy.

> Notas técnicas para futuras fases:
> - **NO** editar `index.ts` con `Set-Content` de PowerShell: rompe UTF-8
>   (acentos/emoji). Preferir `str_replace`; para borrados de rango grande usar
>   Python con `io.open(..., encoding='utf-8')` y re-normalizar a CRLF.
> - Mantener el orden de import: `comun` primero (garantiza `initializeApp`).
