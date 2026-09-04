# Ideas de mejora: visual, funcionalidad y uso de las APIs (capa gratuita)

## Fecha: 28 de agosto 2026

Backlog de ideas para no perderlas. Lista priorizada para decidir en que
trabajar.

NOTA: TheSportsDB paso a PREMIUM (Single Developer, $90/año via Patreon). La
key vive en el secret SPORTSDB_KEY (configurado en dev; falta en prod cuando
se despliegue alla). Con premium la tabla ya no se trunca a 5 equipos.

## PLAN DE CONTINGENCIA si la suscripcion caduca (REGLA DE DISENO)

Principio: la API es ENRIQUECIMIENTO, nunca dependencia critica. Si el dia de
manana no se paga (o la API falla), la app debe seguir funcionando.

Reglas para TODA feature que use la API (actuales y futuras):
1. Nada critico depende de la API. Resolver jornadas, premios, puntos y el
   CIERRE de partidos SIEMPRE tienen el camino manual del admin. El cierre por
   API se mantiene solo como comodidad; si falla, el admin cierra a mano.
2. Degradacion SILENCIOSA para el usuario final: si no hay datos frescos, la
   seccion simplemente NO aparece. El usuario nunca ve errores, datos a medias
   ni tablas incompletas.
3. AVISO solo para el admin: cuando la API no responde o devuelve datos
   incompletos, avisar al admin (banner/toast/Telegram) para que sepa que hay
   que revisar la suscripcion. El usuario no se entera.
4. No mostrar datos incompletos: p.ej. si la tabla trae menos equipos de los
   esperados (sintoma de key gratuita), NO mostrarla (mejor nada que 5 de 18).
5. Marcar frescura: mostrar "actualizada hace X" para que un dato viejo se
   note y no se confunda con actual.
6. Toda funcion que consulte la API va en try/catch y no rompe el flujo que la
   contiene (ya aplicado en refrescarTablaCompeticion, revisarJornadas, etc.).

Estado actual verificado ante caida de la API:
- tablaLigaSportsDb lanza si falla, pero refrescarTablaCompeticion y
  resolverJornadaCompeticion lo envuelven: la resolucion NO se rompe; la tabla
  se queda con el ultimo cache.
- eventosRondaSportsDb: traerJornada/traerResultados avisan al admin por toast;
  el flujo manual sigue disponible. revisarJornadas tiene try/catch por jornada.
- La forma reciente usa football-data, independiente de TheSportsDB.
- Conclusion: hoy la app NO se rompe si caduca; el riesgo es mostrar datos
  viejos/incompletos sin avisar -> lo cubren las reglas 2-5.

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
7. [DESCARTADO] Autocompletar equipos al crear liga. Ya esta cubierto en la
   practica: al "Traer jornada de la API" el catalogo se autocompleta con los
   equipos nuevos que trae la jornada. Un boton de importacion masiva aporta
   poco. (Nota: el endpoint correcto para listar equipos de una liga es
   `search_all_teams.php?l={nombre-liga}`, NO `lookup_all_teams.php?id=`.)
8. [EN CURSO - solo forma reciente] Forma reciente en la pantalla de pronostico
   (SOLO partidos creados desde football-data, con apiFixtureId). Al CREAR el
   partido se captura UNA sola vez la forma (ultimos 5: W/D/L) de cada equipo y
   se guarda en el doc (formaLocal/formaVisitante). Como no cambia, se muestra
   sin requests recurrentes; la seccion se oculta si el partido no trae el dato.
   El head-to-head se DESCARTO por ahora: en football-data varios subrecursos
   son TIER_THREE (pago) y no se pudo confirmar sin la key; alto riesgo de
   trabajo perdido.

   NOTA IMPORTANTE de cobertura: football-data NO cubre Liga MX (esa va por
   TheSportsDB). Por eso la forma solo aparecera en partidos de ligas que
   football-data si cubre y que se creen por su buscador.

13. [HECHO - camino (a), conviven ambas] Integrar TheSportsDB al flujo de
    "crear partido". Buscador unico con selector de FUENTE (TheSportsDB /
    football-data). TheSportsDB busca los proximos partidos de una liga
    (eventsnextleague) para 7 ligas: Liga MX, Champions, Premier, LaLiga,
    Serie A, Bundesliga, Ligue 1 (se quito Brasileirao; Eurocopa fuera por
    inactiva). El partido guarda apiEventId (distinto de apiFixtureId de
    football-data). crearPartidoGrupo tambien acepta apiEventId.
    Resolucion automatica: nuevo scheduler revisarResultadosSportsDb (cada 15
    min) liquida los partidos con apiEventId al terminar (lookupevent), con el
    mismo fallback manual del admin. La meta de migrar TODO a TheSportsDB al
    extender la licencia ya esta encaminada; football-data se puede retirar
    cuando se decida (buscador + revisarResultados + forma reciente).

## Cosas de las APIs que NO aprovechamos (y estan gratis)

9. [HECHO] Tabla de posiciones oficial de la liga (`lookuptable.php` de
   TheSportsDB). Se muestra en torneo-detalle (panel colapsable "Tabla de la
   liga"), solo si la competicion tiene apiLigaId. Estandar + racha (strForm
   como puntitos W/D/L) + zonas coloreadas (strDescription). Cache en
   competiciones/{id}: se refresca sola al resolver jornada + boton manual del
   admin en admin-competiciones. El front lee de cache, nunca de la API.
10. Goleadores (`/competitions/{id}/scorers`, gratis). Un "pichichi" de la
    liga como contenido atractivo, cero riesgo.
11. [DESCARTADO] Colores de equipo (`strColour1`/`strColour2`). Mucho esfuerzo
    (colores a mano para cientos de equipos, o cobertura parcial via API que es
    por-liga) para poco valor: los escudos ya dan el color de facto y hay
    riesgo de contraste/accesibilidad. Se descarto.
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
