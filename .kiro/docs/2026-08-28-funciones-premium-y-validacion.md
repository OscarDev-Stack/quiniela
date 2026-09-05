# Funciones nuevas (Cloud Functions) y lista de validación — sesión premium TheSportsDB

## Fecha: 28 de agosto 2026

Resumen del trabajo hecho al pasar TheSportsDB a PREMIUM y ampliar su uso.
La key vive en el secret `SPORTSDB_KEY` (configurado en dev; FALTA en prod).

## IMPORTANTE: migración a la API V2 de TheSportsDB

La key PREMIUM NO funciona con los endpoints V1 (`*.php` con la key en la URL)
— dan 404. Premium usa la API V2: base `https://www.thesportsdb.com/api/v2/json/`
y la key va en el header `X-API-KEY`. Se migraron todos los llamados con el
helper `fetchSportsDbV2(ruta, key)`. Rutas V2 usadas (raíz JSON entre paréntesis):
- Jornada por ronda: `schedule/league/{id}/{temporada}` (schedule[]), se filtra por intRound
- Próximos partidos: `schedule/next/league/{id}` (schedule[])
- Evento por id: `lookup/event/{idEvent}` (lookup[])
- Equipos de la liga: `list/teams/{id}` (list[])
- Tabla de posiciones: SIGUE EN V1 — `lookuptable.php?l={id}&s={temporada}`
  (table[]). Este endpoint SÍ funciona en V1 con la key premium y devuelve los
  18 equipos completos (con key gratuita truncaba a 5). NO existe en V2
  (lookup/table da "Invalid ID passed"). OJO: no todos los endpoints premium
  van por V2; la tabla es de los que se quedan en V1.
Los nombres de campos internos (idEvent, strHomeTeam, intRound, intHomeScore,
strForm, strStatus...) son iguales que en V1; solo cambió la raíz y la auth.
La V1 se retira a futuro, así que esta migración también deja el terreno listo.

## Funciones nuevas de Cloud Functions

### Callables (onCall)
- `buscarFixturesSportsDb` — busca los próximos partidos de una liga en
  TheSportsDB (eventsnextleague). Recibe `liga` (código: LIGAMX, CL, PL, PD,
  SA, BL1, FL1). Solo admin. Secret SPORTSDB_KEY.
- `formaEquiposApi` — trae la forma reciente (últimos 5, "WWDLW") de dos
  equipos de football-data. Se llama UNA vez al crear el partido. Solo admin.
  Secret FOOTBALL_DATA_KEY.
- `refrescarTablaApi` — fuerza la descarga de la tabla de posiciones de una
  competición (botón manual del admin). Solo admin/gestor. Secret SPORTSDB_KEY.

### Programadas (onSchedule)
- `revisarResultadosSportsDb` — cada 15 min. Liquida automáticamente los
  partidos sueltos con `apiEventId` cuando terminan (lookupevent). Mismo
  fallback manual del admin. Secret SPORTSDB_KEY.
- `actualizarMarcadoresEnVivo` — cada 3 min. Actualiza marcador y minuto en
  vivo de: (1) partidos sueltos en-juego con apiEventId, y (2) partidos de
  jornadas de quiniela abiertas cuyo primer partido ya empezó. Solo
  informativo. Secret SPORTSDB_KEY.

### Función existente modificada
- `resolverJornadaCompeticion` — ahora refresca la tabla de posiciones al
  resolver la jornada (secret SPORTSDB_KEY añadido).
- `crearPartidoGrupo` — ahora acepta y guarda apiEventId y apiLigaId.
- `traerJornadaApi` — ahora devuelve apiEventId por partido (+ prellenado de
  cierre con zona MX y margen de 5 min, de una sesión anterior).
- `buscarFixtures` (football-data) — ahora devuelve homeTeamId/awayTeamId
  (para la forma reciente).

### Helpers internos (no desplegables, viven en index.ts)
- `sportsDbBase(key)` — arma la URL base con la key.
- `eventosProximosLigaSportsDb(ligaId, key)` — eventsnextleague.
- `lookupEventoSportsDb(idEvent, key)` — lookupevent (un evento).
- `tablaLigaSportsDb(ligaId, temporada, key)` — lookuptable.
- `refrescarTablaCompeticion(compRef, comp, key)` — cachea la tabla.
- `formaEquipoFootballData(teamId, key)` — forma de un equipo (football-data).
- `vivoDeEvento(ev)` — extrae marcador/minuto en vivo de un evento.

## Secrets requeridos (por proyecto)
- `SPORTSDB_KEY` — configurado en DEV. FALTA en PROD:
  `firebase use prod` ; `firebase functions:secrets:set SPORTSDB_KEY`
- `FOOTBALL_DATA_KEY`, `TELEGRAM_TOKEN`, `TURNSTILE_SECRET_KEY` — ya existían.

## Ligas soportadas (7)
Liga MX (4350), Champions (4480), Premier (4328), LaLiga (4335), Serie A
(4332), Bundesliga (4331), Ligue 1 (4334). Se quitó Brasileirão; Eurocopa
fuera (inactiva). Mismo set en el buscador de partidos y en la conexión de
competiciones (torneos).

## LISTA DE VALIDACIÓN (en dev, tras el deploy del CI)

### Tabla de posiciones
- [x] admin -> competiciones -> Conexión API -> "Actualizar tabla": debe
      decir "18 equipos" (no 5). Confirma que la key premium funciona.
- [x] En un torneo de esa liga, panel "Tabla de la liga": se ven todos los
      equipos, con racha (puntitos) y zonas coloreadas.
- [x] Si la tabla luce incompleta, NO se muestra al jugador y el admin ve el
      banner de alerta (contingencia).

### Crear partidos por TheSportsDB
- [x] Crear partido -> Buscar por API -> Fuente TheSportsDB -> liga (ej.
      Liga MX): lista los próximos partidos.
- [x] "Crear" en uno: se crea global y de grupo; guarda apiEventId/apiLigaId.
- [x] Los equipos calzan con los escudos del catálogo (ojo con ligas nuevas
      europeas: revisar nombres/escudos).

### Resolución automática (partidos sueltos)
- [ ] Un partido de TheSportsDB en juego se liquida solo al terminar (hasta
      15 min después). El fallback manual del admin sigue disponible.

### Marcadores en vivo
- [ ] Partido suelto en juego: la tarjeta muestra marcador X-Y + minuto con
      punto pulsante (se actualiza cada ~3 min).
- [ ] Cartones de quiniela (jornada traída de la API, en curso): cada tarjeta
      de partido muestra el marcador en vivo + minuto. Al capturar el
      resultado final, pasa al marcador oficial con aciertos coloreados.

### Forma reciente en pronóstico
- [ ] Partido de Liga MX creado por TheSportsDB: en la pantalla de pronóstico
      se ven los puntitos de forma de cada equipo (desde la tabla cacheada).
- [ ] Partido de liga europea creado por football-data: forma desde el partido.

### Rediseño de cartones
- [ ] La vista de cartones es por tarjetas (escudo + nombre completo), sin
      abreviaturas ambiguas. Ranking de totales arriba. Colores de acierto
      (5 verde / 3 ámbar / 0 gris) correctos.

### Vista de torneos y eliminatorias
- [ ] En /torneos: activos (en juego / inscripción) arriba, finalizados al
      final y atenuados. Las dos secciones (Torneos y Eliminatorias) se
      conservan.

### Ligas ampliadas en competiciones
- [ ] Al configurar la Conexión API de una competición, el select ofrece las
      7 ligas. Crear una competición europea de prueba y traer una jornada.

### Prellenado de hora de cierre (sesión previa)
- [ ] Al traer jornada de la API, el cierre se prellena a la hora del primer
      partido menos 5 min, en zona horaria de México.

### Desglose y resaltado de brackets (sesión previa)
- [ ] Eliminatoria finalizada: sección "Tus puntos, explicados" con el
      desglose; el cuadro resalta aciertos (verde) y fallos (rojo), incluida
      la Final.

## PENDIENTES (backlog)
- Retirar football-data por completo (migrar forma reciente y resolución a
  TheSportsDB) — planeado para fin de mes si se extiende la licencia a 1 año.
- Configurar SPORTSDB_KEY en PROD antes de desplegar allá.
- Recordatorio de calendario: decidir plan anual antes de que termine el mes
  de prueba (y dentro de la ventana de reembolso de 14 días de TheSportsDB).
