# Survivor de NFL (sin tabla de clasificación) — propuesta

## Fecha: 3 de septiembre 2027

Objetivo: ofrecer un torneo de **supervivencia** sobre la NFL, reutilizando el
modo supervivencia que ya existe en la app. **Sin** tabla de clasificación,
**sin** quiniela por marcador exacto. Solo "elige un equipo cada semana; si
gana sobrevives; no puedes repetir equipo".

## Veredicto: VIABLE (esfuerzo medio)

La mecánica de supervivencia ya existe y encaja tal cual con la NFL. El empate
ya está contemplado. Lo grande que falta es el catálogo de 32 equipos + escudos.

---

## Paso 1 — VALIDADO ✅ (cobertura de TheSportsDB premium)

Se probó en vivo con la key premium (`SPORTSDB_KEY`) contra la API V2:

- **Liga NFL = id `4391`**, deporte "American Football", temporada actual `2026`.
- `schedule/league/4391/2026` devolvió **324 eventos** con: `strHomeTeam`,
  `strAwayTeam`, `intHomeScore`, `intAwayScore`, `strStatus` (NS/FT),
  `dateEvent`, `idEvent`, `intRound`.
- **Temporada regular = rounds 1 a 18** (las 18 semanas NFL), con 13-16 partidos
  por semana. Rounds especiales a excluir: `500` (pretemporada, 49 eventos),
  `150/160/200` (playoffs/Super Bowl).
- La **bye week ya viene reflejada en los datos**: los rounds con menos de 16
  partidos son justo las semanas donde algunos equipos descansan (no aparecen).

Conclusión: la API cubre todo lo que la supervivencia necesita (quién juega,
quién ganó, cuándo). Se continúa.

---

## Punto 4 — Bye week: DECIDIDO (Opción A)

**Cómo se maneja el equipo que descansa (bye):**

- El equipo en bye **no aparece** en `j.partidos` de esa jornada (la API no lo
  trae). Por lo tanto queda **excluido automáticamente** de la selección: no
  hay que "desactivarlo" a mano.
- `guardarPick` ya valida que el equipo elegido juegue esa jornada:
  ```ts
  const juega = j.partidos.some((p) => p.local === equipo || p.visitante === equipo);
  if (!juega) throw new HttpsError('invalid-argument', 'Ese equipo no juega en esta jornada.');
  ```
  Si el jugador intenta elegir un equipo en bye, el backend lo rechaza. **Ya
  funciona, sin cambios.**

**Regla del juego elegida — Opción A (survivor estándar):**
- Es responsabilidad del jugador elegir entre los equipos que juegan y que no
  ha usado. Si no elige (o su equipo pierde), lo trata como derrota → según sus
  vidas, sobrevive con una menos o queda eliminado. **Es el comportamiento
  actual de la resolución; no se toca.**
- (Se descartó la Opción B —"no penalizar si no eligió por bye"— por ser menos
  estándar y requerir cambios en la resolución.)

Resumen: **cero cambios** en la mecánica de supervivencia ni en la resolución.

---

## Qué falta implementar (cuando se arranque, tras el merge manual)

### Backend (`functions/src/index.ts`)
1. Agregar NFL al mapa de ligas:
   ```ts
   NFL: { id: 4391, nombre: 'NFL', nombreApi: 'NFL' },
   ```
   (en `LIGAS_SPORTSDB`).
2. Al traer jornadas de NFL, **filtrar rounds 1-18** (excluir 500/150/160/200).
   Confirmar que `traerJornadaApi` / el armado de jornada respeta el `intRound`.
3. Verificar que la resolución automática (`revisarResultadosSportsDb` /
   `resolverPendientes`) liquida por `idEvent` igual que en fútbol (debería, es
   el mismo campo).

### Frontend
4. Añadir NFL a los selects de liga:
   - `src/app/features/admin/crear-partido.component.ts` (`ligasSportsDb`).
   - `src/app/features/admin/admin-competiciones.component.ts` (`ligasApi`,
     id 4391).
5. Selector de equipo de la supervivencia: confirmar que lista los equipos
   **desde `j.partidos`** de la jornada (así los bye quedan fuera solos). Si ya
   es así (mismo componente que fútbol), no hay cambio.
6. UX del bye: mensaje claro tipo "Descansa esta semana (bye week)" para que el
   usuario entienda por qué su equipo no está disponible.

### Datos / assets (el trabajo más manual) — HECHO ✅
7. ~~Catálogo `EQUIPOS_NFL`~~ **HECHO**: los 32 equipos se agregaron directo al
   array maestro `EQUIPOS_LIGA_MX` (en `src/app/core/models/equipos-liga-mx.ts`)
   con `liga: 'NFL'`, nombre oficial y alias (nombre completo, ciudad, mascota).
   Se integró ahí —y no en un archivo aparte— porque ese array alimenta el
   `INDICE`, `escudoDe`, `nombreOficial` y el selector de equipo; un archivo
   suelto quedaría huérfano.
8. ~~32 escudos~~ **HECHO**: descargados de TheSportsDB (`list/teams/4391`,
   campo `strBadge`) a `public/escudos/` como `nfl-<mascota>.png` (los 32, PNG
   válidos verificados). Build de front en verde.

### Verificación
9. Crear un torneo de supervivencia NFL de prueba en dev, traer la semana 1,
   elegir equipo, y comprobar: (a) que los equipos en bye no aparecen, (b) que
   al terminar los partidos la resolución sobrevive/elimina bien, (c) escudos
   correctos.

---

## Notas / supuestos
- Empates NFL: son rarísimos (uno cada varias temporadas). Con `vidaCubre =
  'empate'` (por defecto), un empate cuesta una vida. Comportamiento aceptable.
- No se agrega tabla de posiciones (el usuario no la quiere y la NFL usa
  conferencias/divisiones, no una tabla lineal).
- Season string de la API para NFL: `"2026"` (año simple, NO "2026-2027" como
  las ligas europeas). Ojo al configurar `apiTemporada` de la competición.
