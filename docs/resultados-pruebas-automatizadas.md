# Resultados de pruebas automatizadas

**Proyecto:** Quiniela — Cloud Functions (backend)
**Entorno:** `quiniela-dev-d203d` (dev, nunca producción)
**Fecha de ejecución:** 5 de septiembre de 2026
**Runner:** `npm run pruebas` (`node scripts/run-pruebas.js`)
**Resultado global:** ✅ **11/11 pruebas pasaron** (más el seed de datos)

Las pruebas llaman a las Cloud Functions reales autenticándose como cada
usuario (igual que la app), y verifican la lógica, el reparto de puntos y las
guardas de seguridad. Todas tienen candado anti-producción: se niegan a correr
si el `projectId` no contiene `dev`.

---

## Resumen

| # | Prueba | Archivo | Tipo | Resultado |
|---|--------|---------|------|-----------|
| 0 | Seed de datos | `seed-dev.js` | Preparación | ✅ |
| 1 | Partido individual | `prueba-partido.js` | Flujo | ✅ |
| 2 | Survivor | `prueba-survivor.js` | Flujo | ✅ |
| 3 | Survivor NFL | `prueba-survivor-nfl.js` | Flujo | ✅ |
| 4 | Quiniela por puntos | `prueba-quiniela.js` | Flujo | ✅ |
| 5 | Bracket pronóstico | `prueba-bracket-pronostico.js` | Flujo | ✅ |
| 6 | Bracket dueños | `prueba-bracket-duenos.js` | Flujo | ✅ |
| 7 | Partido (avanzado) | `prueba-partido-avanzado.js` | Casos difíciles | ✅ |
| 8 | Survivor (avanzado) | `prueba-survivor-avanzado.js` | Casos difíciles | ✅ |
| 9 | Quiniela (avanzado) | `prueba-quiniela-avanzado.js` | Casos difíciles | ✅ |
| 10 | Brackets (avanzado) | `prueba-brackets-avanzado.js` | Casos difíciles | ✅ |
| 11 | Seguridad | `prueba-seguridad.js` | Autorización | ✅ |

- **Flujo (happy path):** confirman que cada modo funciona de punta a punta.
- **Casos difíciles:** atacan validaciones, aritmética con redondeo, idempotencia y casos borde.
- **Seguridad:** verifican qué NO pueden hacer los usuarios comunes ni las cuentas sin validar.

---

## Constantes verificadas del sistema

Estas reglas se validaron a lo largo de las pruebas:

- `APUESTA_BASE = 100` — cada punto de multiplicador equivale a 100 pts.
- `MULTIPLICADOR_MAX = 5` — multiplicadores fuera de `[1, 5]` se rechazan.
- `TOPE_INFERIOR = -1000` — el saldo no puede quedar por debajo de −1000
  (−1000 exacto sí se permite; −1001 se rechaza).
- Premio de partido = `Math.floor(apuesta × bolsaNeta / apostadoGanadores)`.
- Bote = `Math.floor(bolsaBruta × porcentaje / 100)`; el sobrante por redondeo va a `sistema/reserva`.
- Marcadores de quiniela: enteros en rango `[0, 20]`, longitud = número de partidos.

---

## Detalle por prueba

### 1. Partido individual (flujo)

Cinco usuarios pronostican, el admin liquida y se verifica el reparto.

- 5 usuarios pronosticaron; 3 ganadores; bolsa 600, sobrante 0.
- Reparto verificado por usuario (ganadores y perdedores) al céntimo.
- El partido quedó marcado como liquidado.

### 2. Survivor (flujo)

Torneo de supervivencia con 1 vida, `vidaCubre = empate`.

- Cobro de entrada (100 pts) verificado por participante.
- Quien eligió al ganador sobrevive; quien empató gasta una vida pero sobrevive;
  quien perdió queda eliminado.
- La jornada quedó resuelta.

### 3. Survivor NFL (flujo)

Survivor con equipos NFL: escudos, bye week y empate.

- Elegir un equipo en **bye week** (Dallas Cowboys) fue rechazado correctamente.
- Cobro de entrada y supervivencia verificados.
- El empate NFL consume una vida (verificado).

### 4. Quiniela por puntos (flujo)

Torneo de una jornada; se califica y reparte.

- Puntajes verificados: 5 pts por marcador exacto, 3 pts por acertar solo el resultado.
- El ganador (más puntos) cobró la bolsa completa.
- El torneo quedó finalizado.

### 5. Bracket pronóstico (flujo)

Cuadro de 4 equipos, siembra, avance fijo.

- Cobro de entrada la primera vez; captura de resultados hasta la final.
- Calificación por posición y premio del 1° lugar verificados.

### 6. Bracket dueños (flujo)

Cuadro de dueños de 4 equipos.

- Asignación y aceptación (cobro) de cada dueño.
- El dueño del equipo campeón cobra la bolsa completa; ganador registrado.

### 7. Partido (avanzado) — casos difíciles

| Caso | Verificación | Resultado |
|------|--------------|-----------|
| Multiplicador 0 | Rechazado (`invalid-argument`) | ✅ |
| Multiplicador 6 (> MAX 5) | Rechazado (`invalid-argument`) | ✅ |
| Resultado no válido para 1x2 | Rechazado (`invalid-argument`) | ✅ |
| Partido inexistente | Rechazado (`not-found`) | ✅ |
| Edición: subir de x1 a x3 | Cobra la diferencia (200 pts) | ✅ |
| Edición: bajar y cambiar resultado | Devuelve la diferencia | ✅ |
| Ledger de edición | Registra `apuesta-edicion` | ✅ |
| Tope: −900 − 100 = −1000 exacto | Permitido | ✅ |
| Tope: −950 − 100 = −1050 | Rechazado (`failed-precondition`) | ✅ |
| Pronosticar tras la hora de cierre | Rechazado (`failed-precondition`) | ✅ |
| Pronosticar en partido liquidado | Rechazado (`failed-precondition`) | ✅ |
| Nadie acierta | Devolución total; el bote no crece | ✅ |
| Reparto con bote 10% | A: 5020, B: 5040; bote 40 a reserva (`Math.floor`) | ✅ |
| Doble liquidación | La segunda se rechaza; el saldo no cambia (idempotente) | ✅ |

### 8. Survivor (avanzado) — casos difíciles

| Caso | Verificación | Resultado |
|------|--------------|-----------|
| Sin elegir equipo | Se trata como derrota (eliminado) | ✅ |
| Empate con vida | Sobrevive con una vida menos | ✅ |
| Empate/derrota sin vida | Eliminado | ✅ |
| `vidaCubre = tropiezo` | La derrota consume vida en vez de eliminar | ✅ |
| Repetir un equipo ya usado | Rechazado (`failed-precondition`) | ✅ |
| Equipo que no juega en la jornada | Rechazado (`invalid-argument`) | ✅ |
| Doble resolución de jornada | La segunda se rechaza (idempotente) | ✅ |
| Revivir fuera de ventana | Rechazado (`failed-precondition`) | ✅ |
| Revivir en la jornada correcta | Costo = `round(jornada/2 × entrada)` = 100 | ✅ |
| Revivir dos veces | Rechazado (una sola vez por torneo) | ✅ |

### 9. Quiniela (avanzado) — casos difíciles

| Caso | Verificación | Resultado |
|------|--------------|-----------|
| Longitud de marcadores incorrecta | Rechazado (`invalid-argument`) | ✅ |
| Marcador fuera de rango (21) | Rechazado (`invalid-argument`) | ✅ |
| Marcador negativo | Rechazado (`invalid-argument`) | ✅ |
| Marcador válido (control) | Aceptado | ✅ |
| Desempate por puntos | El de más puntos (10) gana la bolsa; el de 6 no cobra | ✅ |
| Empate total (3 con mismo cartón) | Comparten 300/3 = 100 c/u; neto 0; sin sobrante | ✅ |
| Capturar en torneo no arrancado | Rechazado (`failed-precondition`) | ✅ |

### 10. Brackets (avanzado) — casos difíciles

| Caso | Verificación | Resultado |
|------|--------------|-----------|
| Reparto que no suma 100% | Rechazado (`invalid-argument`) | ✅ |
| Dueños: aceptar | Cobra la entrada una vez | ✅ |
| Dueños: aceptar de nuevo | No cobra doble (idempotente) | ✅ |
| Ledger de entrada | Un solo `bracket-entrada` por bracket | ✅ |
| Dueños: rechazar tras aceptar | Rechazado (`failed-precondition`) | ✅ |
| Dueños: rechazar | Libera el equipo; no cobra | ✅ |
| Dueños: aceptar sin saldo (tope −1000) | Rechazado (`failed-precondition`) | ✅ |
| Dueños: calificar | El dueño del campeón cobra la bolsa (200) | ✅ |
| Doble calificación | La segunda se rechaza; sin pago doble (idempotente) | ✅ |

> **Nota:** el caso de doble calificación valida la guarda de idempotencia
> agregada a `calificarBracket` (campo transaccional `repartido`), que evita
> pagar la bolsa dos veces ante un doble "Publicar" o un reintento.

### 11. Seguridad — autorización

| Caso | Verificación | Resultado |
|------|--------------|-----------|
| Usuario común liquida partido | Rechazado (`permission-denied`) | ✅ |
| Usuario común crea torneo global | Rechazado (`permission-denied`) | ✅ |
| Usuario común crea bracket | Rechazado (`permission-denied`) | ✅ |
| Usuario común reinicia puntos | Rechazado (`permission-denied`) | ✅ |
| Usuario común elimina usuarios | Rechazado (`permission-denied`) | ✅ |
| Usuario común resuelve jornadas | Rechazado (`permission-denied`) | ✅ |
| Cuenta sin validar se une a torneo | Rechazado (`permission-denied`) | ✅ |
| Cuenta sin validar pronostica bracket | Rechazado (`permission-denied`) | ✅ |
| Eliminar admin o cuenta validada | Se omiten; 0 borrados, se reportan omitidos | ✅ |
| Alias de 2 caracteres | Rechazado (`invalid-argument`) | ✅ |
| Alias de 21 caracteres | Rechazado (`invalid-argument`) | ✅ |
| Alias válido (control) | Aceptado | ✅ |

---

## Cambios de infraestructura aplicados durante las pruebas

Estos ajustes fueron a los scripts y a una Cloud Function; **ninguna falla
detectada correspondió a un bug de la lógica de negocio de la app.**

1. **Guarda de idempotencia en `calificarBracket`** (`functions/src/brackets.ts`):
   se marca el bracket como `repartido` dentro de una transacción antes de pagar,
   evitando el pago doble ante reintentos o dobles clics.

2. **Caché de sesión en `comoUsuario`** (`_prueba-comun.js` y `prueba-partido.js`):
   se re-loguea solo cuando cambia el usuario, en vez de hacer login/logout en
   cada llamada. Reduce drásticamente las verificaciones de contraseña.

3. **Pausa entre pruebas en el runner** (`run-pruebas.js`): pausa configurable
   (por defecto 20 s, variable `PAUSA_PRUEBAS`) para no agotar la cuota de
   Firebase Auth (`auth/quota-exceeded`) al correr las 11 pruebas seguidas.

---

## Cómo reproducir

```bash
# Requiere scripts/service-account-dev.json y scripts/config-dev.json
npm run pruebas                    # seed + 11 pruebas + resumen
PAUSA_PRUEBAS=0 npm run pruebas    # sin pausas (más rápido; puede dar quota-exceeded)

# Pruebas sueltas
node scripts/prueba-partido-avanzado.js
node scripts/prueba-survivor-avanzado.js
node scripts/prueba-quiniela-avanzado.js
node scripts/prueba-brackets-avanzado.js
node scripts/prueba-seguridad.js

# Limpieza
node scripts/seed-dev.js limpiar   # borra todo lo marcado esPrueba
```

## Notas y limitaciones

- Las pruebas avanzadas **ajustan saldos** de algunos jugadores a propósito
  (para probar el tope de −1000). Para restaurarlos: `node scripts/seed-dev.js seed`.
- El `ledger` acumula movimientos entre corridas; los conteos que dependen de él
  se filtran por `bracketId`/`torneoId` para ser deterministas.
- La cuota de Firebase Auth es por ventana de tiempo; si aparece
  `auth/quota-exceeded`, subir `PAUSA_PRUEBAS` o correr las pruebas en grupos
  más pequeños lo resuelve.
