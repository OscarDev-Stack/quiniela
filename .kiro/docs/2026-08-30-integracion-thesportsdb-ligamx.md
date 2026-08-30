# Integración con TheSportsDB (Liga MX)

## Fecha: 30 de agosto 2026

## Objetivo

Usar TheSportsDB para generar los partidos de las jornadas y traer sus resultados,
sin que el admin tenga que escribirlos a mano. La parte de PUBLICAR y aplicar a los
torneos sigue siendo 100% manual (el admin revisa y confirma).

## Por qué TheSportsDB

- Cubre Liga MX (idLeague 4350) con equipos, hora, jornada (intRound) y marcadores.
- El endpoint de temporada completa funciona con la KEY GRATUITA (`123`):
  `eventsseason.php?id=4350&s=2026-2027` → una sola llamada trae toda la temporada.
- football-data.org (que ya se usa para partidos sueltos) NO cubre Liga MX en su plan
  gratuito, así que TheSportsDB complementa lo que faltaba.

## Alcance

Solo Liga MX por ahora, pero el diseño es genérico: cada competición guarda su
`apiLigaId` y `apiTemporada`, así que sumar otra liga es solo configurar esos dos
valores (los nombres de equipos de otras ligas requerirían ampliar el normalizador).

## Cambios

### Modelo (`src/app/core/models/competicion.model.ts`)
`Competicion` ahora tiene `apiLigaId?: number` y `apiTemporada?: string`.

### Backend
- **`functions/src/equipos.ts`** (nuevo): normalizador de nombres de Liga MX. Traduce los
  nombres de la API ("Tigres UANL", "Santos Laguna", "America") a los nombres oficiales
  del catálogo ("Tigres", "Santos", "América"), quitando acentos y usando alias.
- **`functions/src/index.ts`**:
  - Constantes `SPORTSDB_KEY = '123'`, `SPORTSDB_BASE` y helper `eventosRondaSportsDb`.
  - **IMPORTANTE:** se usa el endpoint `eventsround.php?id={liga}&r={jornada}&s={temporada}`,
    que trae la jornada completa. NO se usa `eventsseason` porque con la key gratuita esa
    respuesta viene truncada (solo las primeras jornadas), lo que hacía que jornadas altas
    (ej: la 4) parecieran vacías.
  - **`traerJornadaApi(competicionId, numeroJornada)`**: trae la jornada directa de la API,
    devuelve los enfrentamientos con equipos normalizados y la hora del primer partido
    (ISO UTC). No guarda nada.
  - **`traerResultadosApi(competicionId, jornadaId)`**: empareja los partidos de la jornada
    con los de la API por par de equipos normalizados; devuelve marcador solo para los que
    ya terminaron (FT/AET/PEN) y marca pospuestos (`strPostponed === 'yes'`). No publica.
  - Ambas validan admin global o gestor de la competición.

### Frontend
- **`competiciones.service.ts`**: `guardarConfigApi`, `traerJornadaApi`, `traerResultadosApi`.
- **`admin-competiciones.component.ts`**:
  - Panel "Conexión con la API": el admin elige la Liga y la Temporada de dos SELECTS
    (catálogo `ligasApi` con Liga MX = 4350, y `temporadasApi`). No escribe códigos.
    El botón "Guardar conexión" escribe `apiLigaId`/`apiTemporada` en la competición
    (vinculación de una sola vez; sin ella no aparecen los botones de traer datos).
  - Botón "Traer jornada de la API" (junto a "Armar jornada completa"): prellena los
    enfrentamientos y la hora del primer partido en el borrador. El admin revisa y guarda.
  - Botón "Traer resultados de la API" (en cada jornada abierta): precarga los marcadores.
    El admin revisa, guarda y publica manualmente.

## Flujo final para el admin (Liga MX)

1. Configurar la conexión una vez: ID 4350, temporada 2026-2027.
2. Al armar una jornada: escribir el número → "Traer jornada de la API" → revisar → Guardar.
3. Cuando se juegan los partidos: abrir la jornada → "Traer resultados de la API" → revisar →
   Guardar resultados → "Publicar y aplicar a los torneos" (manual, como siempre).

## Notas / pendientes

- La key `123` es la gratuita compartida (30 req/min). Para producción conviene registrar
  una key propia gratuita y moverla a un secret `SPORTSDB_KEY`. El código ya está aislado
  en una constante, así que es un cambio de una línea.
- La hora de la API viene en UTC; el front la convierte a hora local del navegador para el
  campo datetime-local.
- El emparejamiento de resultados es por par (local, visitante) normalizado. Si la API
  invierte local/visitante respecto a como se guardó la jornada, ese partido no calzaría;
  en Liga MX no debería pasar, pero conviene revisar al publicar.
