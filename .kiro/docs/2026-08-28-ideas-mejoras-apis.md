# Ideas de mejora: visual, funcionalidad y uso de las APIs (capa gratuita)

## Fecha: 28 de agosto 2026

Backlog de ideas para no perderlas. NADA de esto esta implementado; es una
lista priorizada para decidir en que trabajar. Todo pensado para respetar la
CAPA GRATUITA de las dos APIs.

## Como usamos las APIs hoy (punto de partida)

### football-data.org (`api.football-data.org/v4`)
- Solo para partidos sueltos del admin (`buscarFixtures`) y refrescar
  marcadores en vivo (`revisarResultados`, scheduler cada 15 min).
- Campos que leemos: `utcDate`, `status`, `homeTeam/awayTeam`, `score.fullTime`.
- Limite gratuito: ~10 requests/minuto y un set limitado de competiciones.

### TheSportsDB (`thesportsdb.com/api/v1/json/123`)
- Solo para armar jornadas de liga y precargar resultados
  (`eventsround.php`), mas el scheduler `revisarJornadas`.
- Campos que leemos: `intRound`, equipos, `intHomeScore/AwayScore`,
  `strStatus`, `strPostponed`, `strTimestamp`.
- Key gratuita compartida `123` (rate-limited, a veces recorta datos).

## Mejoras VISUALES

1. [HECHO] Escudos/logos reales de equipos. Resuelto con un componente propio
   que ya tiene los escudos (no se usa la API para esto). Disponible en cuadro
   de brackets, cartones y tarjetas de partido.
2. [HECHO - opcion 2A] Estado en vivo en la tarjeta de partido. Se hizo la
   version visual (2A): el badge "En juego" ahora tiene un punto que late
   (respeta prefers-reduced-motion). La 2B (minuto/marcador real en vivo) NO
   se hizo: requeriria scheduler + modelo + cuota; queda pendiente si se
   quiere el marcador parcial real.
3. [HECHO] Resaltado de aciertos. Cartones: leyenda con muestras de color
   (verde=exacto 5, ambar=resultado 3, gris=sin acierto). Mis-pronosticos:
   borde izquierdo verde/rojo por fila + linea "Resultado: X" con el resultado
   oficial. (En brackets ya se hizo antes: desglose + resaltado en el cuadro.)
4. [HECHO] Fecha/hora local del partido. Linea "sab 6 sep - 19:00" formateada
   a es-MX desde closesAt en la tarjeta de partido.

## Mejoras de FUNCIONALIDAD

5. [HECHO] Prellenar la hora de cierre de la jornada desde la API. La base ya
   existia (traerJornada prellenaba con primeraHora). Ajustado: conversion
   fija a America/Mexico_City (no depende del navegador del admin) + margen de
   5 min antes del primer partido + aviso en el toast con la hora sugerida.
6. Deteccion automatica de partido aplazado/reprogramado. Ya leemos
   `strPostponed`/`status`. Avisar al admin (Telegram/push) cuando la API
   marca un aplazamiento en una jornada abierta, en vez de descubrirlo tarde.
7. Autocompletar equipos al crear liga. TheSportsDB tiene
   `lookup_all_teams.php?id={liga}` con todos los equipos y su nombre oficial.
   Boton "importar equipos de la liga" que ademas alimente el normalizador.
   Prepara el terreno para cubrir mas ligas.
8. Head-to-head / forma reciente como dato informativo. football-data gratis
   tiene `/matches/{id}/head2head` y el historial. Mostrar "ultimos 5" o el
   h2h en la pantalla de pronostico. Es 1 request por partido -> requiere
   cache.

## Cosas de las APIs que NO aprovechamos (y estan gratis)

9. [HECHO] Tabla de posiciones oficial de la liga (`lookuptable.php` de
   TheSportsDB). Se muestra en torneo-detalle (panel colapsable "Tabla de la
   liga"), solo si la competicion tiene apiLigaId. Estandar + racha (strForm
   como puntitos W/D/L) + zonas coloreadas (strDescription). Cache en
   competiciones/{id}: se refresca sola al resolver jornada + boton manual del
   admin en admin-competiciones. El front lee de cache, nunca de la API.
10. Goleadores (`/competitions/{id}/scorers`, gratis). Un "pichichi" de la
    liga como contenido atractivo, cero riesgo.
11. Colores de equipo (`strColour1`/`strColour2`). Los escudos ya estan
    resueltos (punto 1, HECHO). Quedan los colores por equipo, que podrian
    usarse para acentos en tarjetas/cuadro. Opcional.
12. [DESCARTADO] `strThumb`/`strBanner` del evento. Cobertura pobre en Liga MX
    con la key gratuita; se descarto.

## RESTRICCION CLAVE: respetar la capa gratuita

football-data.org gratis = ~10 requests/minuto y competiciones limitadas.
Varias ideas (h2h, standings, scorers) son 1 request cada una. Si se llaman
por partido o en cada carga de pantalla, se revienta el limite. La forma
correcta de aprovecharlas SIN salir del plan gratis:

- Cachear en Firestore: un scheduler (mismo patron que `revisarJornadas` /
  `revisarResultados`) baja standings/scorers/escudos una vez cada X horas y
  los guarda. El front lee de Firestore, no de la API. 1 request alimenta a
  todos los usuarios.
- Escudos y equipos: se piden UNA sola vez por equipo/liga y se guardan.
  Nunca cambian.
- NUNCA llamar la API desde el cliente: siempre via Cloud Function, para no
  exponer la key y para poder cachear.

## Prioridad recomendada (impacto vs esfuerzo vs cuota)

1. [HECHO] Escudos reales (1/11) — resuelto con componente propio.
2. Prellenar hora de cierre de jornada desde la API (5) — ataca un dolor real
   del admin, sin requests extra. SIGUIENTE candidato.
3. Estado en vivo en la tarjeta (2) — usa datos que ya llegan, solo pintarlos.
4. Tabla de posiciones + goleadores cacheados (9/10) — contenido nuevo, con
   scheduler para respetar la cuota.

El resto (h2h, importar equipos) es bueno pero de segundo nivel.

## Otras notas de deuda tecnica (de una revision aparte)

- Casi no hay tests: solo `src/app/app.spec.ts`. La logica de dinero/puntos
  (puntosDeCarton, reparto de bolsa, calificacion de brackets, empates) no
  tiene pruebas y es donde mas bugs han salido. Es lo de mayor retorno.
- `functions/src/index.ts` tiene ~4,574 lineas (monolito). Partirlo por
  dominio ayudaria a razonar y testear.
- Componentes muy grandes: torneo-detalle (~1,186) y admin-competiciones
  (~918 lineas).
- Patron recurrente "el loading se apaga antes de tiempo": conviene un helper
  reutilizable para "espera a que N fuentes tengan su primer dato".
- Sin ESLint/Prettier configurado en el repo: un lint en CI atraparia cosas
  como la comilla de mas del measurementId.
