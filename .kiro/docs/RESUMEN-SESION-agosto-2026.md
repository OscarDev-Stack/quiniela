# Resumen de sesión — 28 al 30 de agosto 2026

Registro de todo lo trabajado en la app Quiniela: bugs corregidos, features nuevas
y, al final, la lista completa de Cloud Functions nuevas creadas.

---

## 1. Bugs corregidos

### Contador de apuestas en tarjetas (jugador)
Las tarjetas mostraban "sin apuestas" aunque la bolsa tuviera puntos. Causa: el `@if`
trataba el premio neto 0 como falsy. Fix: método `hayApuestas()` que verifica
`porResultado[r] > 0`. Además se copia `conteos` al documento del partido al pasar a
en-juego, y la escritura de bolsa usa `mergeFields`.
Doc: `2026-08-28-bugs-contador-apuestas.md`

### Puntos parciales en brackets
"Pronósticos de todos" mostraba 0 mientras el bracket estaba en curso. Fix:
`recalcularPuntosBracket` se llama al cerrar cada llave en `capturarPartidoBracket`.
Doc: `2026-08-28-puntos-brackets-parciales.md`

### Cambio de alias no se reflejaba en grupos
`cambiarAlias` ahora propaga el nuevo alias a `grupos/{id}/miembros` y `tabla`.
Doc: `2026-08-28-editar-alias-cerrar-sesion.md`

### Búsqueda de usuarios por alias sensible a mayúsculas
`buscarUsuariosPorAlias` ahora filtra en memoria con `toLowerCase().includes()`,
match por "contiene". Sin migración de datos.

### Super admin no podía crear para cualquier grupo
`crearTorneo` y `crearBracket` ahora aceptan (adminGrupo || superAdmin), como ya
hacía `crearPartidoGrupo`.

### Dueños fuera del grupo en brackets
En brackets de dueños de un grupo, solo se pueden asignar miembros del grupo.
Corregido en `asignarDuenoBracket` (backend) y `asignar-duenos` (frontend).

### El loading se apagaba antes de tiempo
En vistas con varias fuentes de datos, el spinner se apagaba con la primera. Fix:
cada vista marca el primer dato de cada fuente y apaga con un `effect` cuando todas
están listas. Afectó: inicio, torneo-detalle, torneos-list, mis-pronosticos, ranking.

### Fixes de UI
- Estilos de admin-usuarios (chips sin quebrarse, estado disabled)
- Menú de tres puntos: quedaba a la orilla de la ventana / detrás del contenido →
  ahora cuelga del botón, alineado a la app
- Doble barra de navegación en crear-partido/torneo/bracket → una sola
- Scrollbar discreto y estético en toda la app
- Vista admin/grupos: antes tenía Seleccionar/Activo confuso → ahora muestra los
  miembros de cada grupo

---

## 2. Features nuevas

### Login con Google + vinculación de cuentas
- Botón "Continuar con Google" en el login; crea usuario pendiente de validación la
  primera vez.
- Si el correo ya existe con contraseña, se pide la contraseña y se VINCULAN ambos
  métodos al mismo usuario (account linking), sin duplicados.
- Doc: `2026-08-28-auth-google.md`
- **Requiere en consola Firebase:** habilitar el proveedor Google (dev y prod).

### Editar el nombre (alias) en el perfil
Botón lápiz en el perfil; el cambio pasa por la función `cambiarAlias` (las reglas no
dejan al usuario escribir su propio documento). Se propaga al ranking y a los grupos.

### Cerrar sesión desde el menú de tres puntos
Nueva opción "Cerrar sesión" en el menú, disponible en cualquier pantalla.

### Super admin ve todos los grupos
Nueva pantalla `/admin/grupos` que lista todos los grupos y sus miembros. Regla de
Firestore ampliada: `isAdmin()` puede leer cualquier grupo.

### Previa de puntos en quiniela
Al GUARDAR resultados de una jornada (sin publicar), se calculan puntos parciales en
campos separados (`puntosPrevia`) para que los jugadores vean su avance en vivo. Al
publicar, la previa se limpia y se materializa el puntaje oficial (sin contar doble).
Doc: `2026-08-28-previa-quiniela.md`

### Ranking histórico con gastado / ganado / diferencia
Se acumula `totalGastado` y `totalGanado` por usuario en cada movimiento. Nueva vista
"Balance" (solo admin) con columnas Gastado / Ganado / Diferencia, ordenada por la
diferencia. Devoluciones revierten el gasto (no cuentan como ganancia). Incluye
backfill para reconstruir totales históricos desde el ledger.

### Integración con TheSportsDB (Liga MX)
Traer jornadas (enfrentamientos + hora) y resultados (marcadores) de Liga MX desde la
API, para no capturarlos a mano. Publicar sigue siendo manual.
Doc: `2026-08-30-integracion-thesportsdb-ligamx.md`

---

## 3. Cloud Functions NUEVAS creadas (en functions/src/index.ts)

| Función | Qué hace |
|---------|----------|
| `cambiarAlias` | Cambia el alias del usuario (valida 3-20 chars), lo propaga al ranking y a sus grupos (miembros + tabla). |
| `backfillTotales` | Recorre todo el ledger y reconstruye `totalGastado`/`totalGanado` de cada usuario; regenera el ranking. Se corre una vez. |
| `previsualizarQuiniela` | Calcula puntos parciales de las quinielas de una jornada con los resultados capturados hasta el momento, en campos `puntosPrevia`. No publica. |
| `traerJornadaApi` | Trae de TheSportsDB los enfrentamientos de una jornada (equipos normalizados + hora del primer partido). No guarda. |
| `traerResultadosApi` | Trae de TheSportsDB los marcadores de una jornada ya guardada (solo partidos terminados; marca pospuestos). No publica. |

## 4. Funciones existentes modificadas (backend)

- `crearPronostico` — acumula `totalGastado`.
- `ejecutarLiquidacion` (liquidar partido) — acumula `totalGanado` al ganar y revierte
  `totalGastado` en devoluciones.
- `cancelarPartido` — la devolución revierte `totalGastado`.
- `unirseTorneo` / revivir — acumulan `totalGastado`.
- `cerrarQuiniela` y demás pagos de torneo (x4) — acumulan `totalGanado`.
- `calificarBracket` / `calificarDuenos` — acumulan `totalGanado`.
- Cancelación de torneo — la devolución revierte `totalGastado`.
- `actualizarRanking` y `recalcularRanking` — proyectan `totalGastado`, `totalGanado`
  y `balance` a la fila del ranking.
- `capturarPartidoBracket` — recalcula puntos parciales al cerrar cada llave.
- `calificarQuinielas` — limpia la previa al calificar en firme.
- `crearTorneo` y `crearBracket` — permiten al super admin crear para cualquier grupo.
- `asignarDuenoBracket` — valida que el dueño sea miembro del grupo.
- `buscarUsuariosPorAlias` — búsqueda insensible a mayúsculas, match por "contiene".

## 5. Archivos nuevos (frontend/backend)

- `functions/src/equipos.ts` — normalizador de nombres de equipos de Liga MX (API → catálogo).
- `src/app/features/admin/admin-grupos.component.ts` — vista de grupos para el super admin.

## 6. Pendientes de configuración (fuera del código)

1. **Firebase Auth:** habilitar el proveedor Google en dev (`quiniela-dev-d203d`) y
   prod (`quinelav1-e23eb`).
2. **Recalcular bolsas:** correr una vez el botón en admin para partidos con conteos viejos.
3. **Calcular totales:** correr una vez el botón "Calcular totales" en admin-usuarios
   para el ranking histórico (backfill).
4. **TheSportsDB:** la key `123` (gratuita compartida) funciona; para producción conviene
   registrar una key propia y moverla a un secret `SPORTSDB_KEY`.
5. **Liga MX en la app:** configurar la conexión API en la competición (ID 4350,
   temporada 2026-2027).
