# Bugs Resueltos — 28 de agosto 2026

## Bug #1: Contador de apuestas muestra "sin apuestas" en vista de jugador

**Ubicacion:** `/partidos` (vista publica del jugador)

**Sintoma:**
Cuando un partido pasa a estado "en-juego", las tarjetas muestran "sin apuestas" en todas
las opciones de resultado (local/empate/visitante), aunque la bolsa si refleja los puntos
apostados (ej: "Bolsa: 300 pts").

**Causa raiz:**
El template usaba `@if (netoPor100(m, o); as n)` para decidir si mostrar el premio o
"sin apuestas". Angular trata el valor `0` como falsy en `@if`.

Cuando todos los usuarios apuestan al mismo resultado:
- `premioPor100['visitante']` = `Math.floor((100 * 300) / 300)` = 100
- `netoPor100` = `100 - 100` = **0** (falsy) → mostraba "sin apuestas"

Para las opciones donde nadie aposto:
- `premioPor100['local']` no existe → fallback a 0 → **0** (falsy) → "sin apuestas"

Resultado: TODAS las celdas mostraban "sin apuestas" aunque si habia dinero en juego.

**Solucion:**
Se separo la logica en dos metodos:
1. `hayApuestas(m, r)` — verifica si `porResultado[r] > 0` (existe dinero apostado a esa opcion)
2. `netoPor100(m, r)` — calcula la ganancia neta (puede ser 0 y eso es valido)

El template ahora usa `@if (hayApuestas(m, o))` para decidir si mostrar el premio.
Si hay apuestas pero el premio neto es 0, se muestra "+0" (correcto: devuelve apuesta sin ganancia).

**Archivos modificados:**
- `src/app/features/partidos/partidos-list.component.ts`
  - Template: cambio `@if (netoPor100(m, o); as n)` → `@if (hayApuestas(m, o))`
  - Nuevo metodo `hayApuestas(m: Partido, r: string): boolean`
  - Subtexto cambiado de "por cada 100" a mostrar numero de apuestas: `{{ m.conteos?.[o] ?? 0 }} apuesta(s)`

---

## Bug #2: Campo `conteos` no se copiaba al documento publico del partido

**Ubicacion:** Cloud Function `cerrarPartidos` (scheduler) + vista `/partidos`

**Sintoma:**
En admin/partidos las tarjetas no mostraban conteos de apuestas hasta ejecutar
"Recalcular bolsas". En la vista del jugador, nunca se tenia acceso al dato de
cuantos pronosticos habia por resultado.

**Causa raiz:**
El flujo de datos es:
1. `crearPronostico` escribe en `bolsas/{partidoId}` → campos: `total`, `porResultado`, **`conteos`**
2. Scheduler `cerrarPartidos` copia de `bolsas/{partidoId}` al documento `partidos/{id}` al pasar a "en-juego"
3. El jugador lee de `partidos/{id}` (no tiene permiso de leer `bolsas`)

El paso 2 copiaba `poolTotal`, `porResultado` y `premioPor100`, pero **nunca copiaba `conteos`**.
Esto significaba que el documento publico del partido no tenia esa informacion.

**Solucion:**
Se agrego la lectura y escritura de `conteos` en el scheduler `cerrarPartidos`:

```typescript
const conteos = (bolsaSnap.data()?.['conteos'] ?? {}) as Record<string, number>;

await d.ref.update({
    status: 'en-juego',
    poolTotal: total,
    porResultado,
    premioPor100,
    conteos, // <-- NUEVO: numero de pronosticos por resultado
});
```

Se agrego el campo `conteos` a la interfaz `Partido` del frontend:
```typescript
/** Numero de pronosticos por resultado (se publica al iniciar). */
conteos?: Record<string, number>;
```

**Archivos modificados:**
- `functions/src/index.ts` — scheduler `cerrarPartidos` ahora copia `conteos`
- `src/app/core/models/partido.model.ts` — campo `conteos` agregado a la interfaz

---

## Nota para partidos existentes

Los partidos que ya estaban "en-juego" antes de este fix **no tienen `conteos`** en su
documento. Para ellos, el template muestra "0 apuesta(s)" aunque haya apuestas reales.

**Accion requerida:** Ejecutar el boton "Recalcular bolsas" en admin una vez. Esto
reconstruye la coleccion `bolsas` desde los pronosticos reales en Firestore. Los proximos
partidos que pasen a "en-juego" (via el scheduler `cerrarPartidos`) ya tendran `conteos`
correctamente copiado al documento publico.

### Detalle tecnico: por que las bolsas pueden tener `total` pero no `porResultado`

Si un partido tiene `total: 300` en su bolsa pero `porResultado` y `conteos` estan en 0,
significa que esos campos no se escribieron correctamente al momento del pronostico
(posiblemente por una version anterior del codigo que no los incluia). El boton
"Recalcular bolsas" reconstruye todo desde los documentos de `pronosticos` con estado
`activo`, lo cual corrige esta discrepancia.

**Despues de ejecutar "Recalcular bolsas":** Los datos quedan correctos en la coleccion
`bolsas`. Para que los jugadores vean los conteos en partidos que YA estan "en-juego",
necesitarias re-correr la logica del scheduler manualmente (actualizar el documento
`partidos/{id}` con los datos recalculados de la bolsa). Esto es porque el scheduler
solo copia datos al documento del partido una vez (al momento de transicionar a "en-juego").
