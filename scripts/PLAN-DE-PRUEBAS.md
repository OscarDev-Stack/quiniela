# Plan de pruebas — Quiniela (dev → prod)

Guía para validar la app en **dev** antes de promover a **prod** vía merge a master.

**Flujo:** commits a `dev` → deploy automático a `quiniela-dev-d203d` → **pruebas (este checklist)** → merge a `master` → deploy automático a `quinelav1-e23eb` (producción).

**Regla de oro:** el merge a master es la compuerta de calidad. No se mergea hasta que este checklist pase completo en dev.

---

## Paso 0 — Prerrequisitos en dev (una sola vez)

Sin esto, varias pruebas fallarán con errores de permisos.

- [ ] **Funciones onCall abiertas en Cloud Run (proyecto dev).** Abrir con `allUsers` + rol *Cloud Run Invoker*:
  - [ ] `asignarDuenoBracket`
  - [ ] `aceptarDuenoBracket`
  - [ ] `rechazarDuenoBracket`
  - [ ] (revisar que las demás onCall que ya usabas sigan abiertas)
- [ ] **IAM Cloud Scheduler** — la cuenta de servicio de GitHub Actions tiene rol *Cloud Scheduler Admin* en dev (ya resuelto si el deploy de schedulers pasó).
- [ ] **Secretos configurados en dev**: `TELEGRAM_TOKEN` (bot de dev), `TELEGRAM_WEBHOOK_SECRET`, `FOOTBALL_DATA_KEY`.
- [ ] **Webhook de Telegram dev** conectado (pendiente: el 502, se retomará aparte).
- [ ] **Usuarios de prueba** creados y **validados** en dev (mínimo 3-4 para probar torneos y brackets con varios participantes).
- [ ] Al menos una **cuenta admin** en dev (documento en `admins/`).

> Nota: en dev los schedulers corren al **doble** del intervalo de prod. Los procesos automáticos tardan más — es esperado, no un bug.

---

## Paso 1 — Humo (smoke test) rápido

Confirmar que la app arranca y lo básico responde.

- [ ] La PWA carga en dev (login, hub).
- [ ] Registro de una cuenta nueva → llega a estado "por validar".
- [ ] Admin valida la cuenta → el usuario ya puede participar.
- [ ] El ranking se muestra.
- [ ] Las tarjetas del hub y de cada sección se ven con sus colores por tipo.

---

## Paso 2 — Pronósticos de partidos individuales

- [ ] Admin crea un partido **manual** (con % al bote, ej. 10%).
- [ ] Usuario pronostica: se descuenta la apuesta, aparece en "Mis movimientos" como `apuesta`.
- [ ] **Editar pronóstico** (bug reciente): cambiar resultado y multiplicador.
  - [ ] Si subo el multiplicador, se cobra la diferencia.
  - [ ] Si lo bajo, se devuelve la diferencia.
  - [ ] Aparece en movimientos como `apuesta-edicion`.
  - [ ] El botón dice "Actualizar pronóstico" cuando ya había uno.
- [ ] La bolsa muestra "se revela al cerrar" mientras está abierto.
- [ ] Indicador visual de estado en la tarjeta (abierto/en juego/cerrado) con su color.
- [ ] Entrar a un partido **cerrado** desde el hub → muestra "ya cerró" + botón volver (no deja pronosticar).
- [ ] Admin liquida el partido → premios repartidos, aparece `premio` en movimientos de ganadores.
- [ ] **Caso "todos aciertan"**: cada quien recupera su apuesta (menos % bote).
- [ ] **Caso "nadie acierta"**: devolución total (`devolucion`).
- [ ] La parte del bote llegó a `sistema/reserva.total`.

---

## Paso 3 — Cierre y liquidación automática por API

- [ ] Admin crea un partido **desde la API** (buscar fixture) de un juego europeo ya jugado o por jugar.
- [ ] Al llegar su hora, `cerrarPartidos` lo pasa a "en juego" solo (esperar el intervalo de dev).
- [ ] Tras el tiempo de espera, `revisarResultados` lo **liquida solo** (sin admin) con el resultado de la API.
- [ ] Verificar que repartió premios y quedó `liquidado`.
- [ ] Un partido manual (sin API) **no** se auto-liquida (sigue esperando admin).

---

## Paso 4 — Modo Survivor (supervivencia)

- [ ] Admin crea torneo survivor con **3 vidas** y % al bote.
- [ ] La tarjeta del torneo muestra **"3 vidas"** (bug reciente), no "1 vida".
- [ ] El "cómo se juega" muestra las 3 vidas correctas.
- [ ] Varios usuarios se inscriben: se cobra entrada (`torneo-entrada` en movimientos).
- [ ] Cada uno elige equipo en la jornada.
- [ ] Admin resuelve la jornada: se pierde vida al empatar/perder según config.
- [ ] Un usuario sin vidas queda eliminado; le llega aviso.
- [ ] (Si aplica) probar **revivir**: se cobra, aparece `torneo-revivir`, vuelve con sus vidas.
- [ ] Al quedar un ganador: recibe la bolsa (`torneo-premio`), trofeo, `torneosGanados` +1.
- [ ] % del bote llegó a la reserva.

---

## Paso 5 — Modo Quiniela por puntos

- [ ] Admin crea torneo quiniela (con jornadas y % al bote).
- [ ] Usuarios se inscriben (`torneo-entrada`).
- [ ] Capturan marcadores de la jornada.
- [ ] Admin resuelve: se califica (5 pts exacto, 3 pts resultado).
- [ ] La tabla de posiciones del torneo se actualiza.
- [ ] Al cerrar la última jornada: gana quien más puntos, recibe bolsa (`torneo-premio`) y trofeo.
- [ ] Desempate por marcadores exactos funciona.
- [ ] % del bote llegó a la reserva.

---

## Paso 6 — Brackets modo Pronóstico

Probar las combinaciones de formato: **liguilla** y **llaves fijas**.

- [ ] Admin crea bracket pronóstico (probar formato liguilla y formato Champions).
- [ ] Usuarios se registran: se cobra entrada (`bracket-entrada` en movimientos — bug reciente arreglado).
- [ ] Llenan su cuadro (avances + marcadores si aplica).
- [ ] El cargando espera a que llegue el pronóstico (sin parpadeo del cuadro vacío).
- [ ] Admin captura resultados ronda por ronda.
- [ ] Al terminar: se califica y reparte por posición (`bracket-premio` — bug reciente).
- [ ] El campeón (1° lugar) suma trofeo y `torneosGanados`.
- [ ] % del bote llegó a la reserva.

---

## Paso 7 — Brackets modo Dueños

Probar las 4 combinaciones posibles (dueños × liguilla, dueños × llaves).

- [ ] Admin crea bracket dueños con % al bote.
- [ ] Admin asigna equipos: a un **registrado** y a un **invitado externo**.
- [ ] Al registrado le llega aviso; ve las reglas.
- [ ] El registrado **acepta y paga** (con pocos puntos, para validar el bug: ya no dice "puntos insuficientes" si está sobre el tope -1000).
  - [ ] Aparece `bracket-entrada` en sus movimientos.
- [ ] Otro registrado **rechaza**: su equipo queda libre, se avisa al creador.
- [ ] El escudo del equipo asignado se ve **grande** (bug reciente).
- [ ] Al cerrar: a quien no respondió se le **cobra automático** (o se libera su equipo si no tiene saldo).
- [ ] Admin captura resultados hasta la final.
- [ ] Gana el **dueño del campeón**: recibe la bolsa completa (`bracket-premio`), trofeo, `torneosGanados`.
- [ ] % del bote llegó a la reserva.

---

## Paso 8 — Movimientos (el "leader") — transversal

Verificar que **todo movimiento de puntos** quedó registrado en "Mis movimientos":

- [ ] `apuesta` y `apuesta-edicion` (partidos)
- [ ] `premio` y `devolucion` (partidos)
- [ ] `torneo-entrada`, `torneo-premio`, `torneo-revivir`, `torneo-devolucion`
- [ ] `bracket-entrada`, `bracket-premio` (pronóstico Y dueños)
- [ ] `reinicio` (cuando el admin reinicia saldo)
- [ ] El bote (`bote`, uid reserva) se acumula en `sistema/reserva.total`

---

## Paso 9 — Notificaciones

- [ ] (Cuando el webhook de dev esté resuelto) Vincular Telegram con `/start`.
- [ ] Recibir aviso de: torneo arrancó, jornada resuelta, recordatorio antes de cerrar.
- [ ] Push (si está configurado en dev): llega a dispositivo.
- [ ] `/stop` deja de recibir.

---

## Paso 10 — Reinicio y administración

- [ ] Admin reinicia el saldo de un usuario → queda en 0, aparece `reinicio` en movimientos.
- [ ] Solicitud de reinicio de un usuario → llega aviso al admin.
- [ ] Validar/eliminar usuarios sin validar funciona.

---

## Compuerta final → merge a master (prod)

Solo mergear a master cuando:

- [ ] Todos los pasos anteriores pasaron en dev.
- [ ] No hay errores en los logs de Cloud Functions de dev.
- [ ] El build de functions pasa limpio (`npm run build`).

**Después del merge (post-deploy en prod):**

- [ ] Repetir el **Paso 0** en prod: abrir en Cloud Run las onCall nuevas (dueños) en el proyecto de producción.
- [ ] Confirmar secretos de prod (bot de prod, no el de dev).
- [ ] Humo rápido en prod (Paso 1) con una cuenta de prueba, sin afectar a usuarios reales.
- [ ] Vigilar logs las primeras horas.

---

## Notas de riesgo

- **Liquidación automática por API**: ahora reparte puntos reales sin revisión humana. Vigilar los primeros partidos auto-liquidados en prod.
- **Dev usa el bot de Telegram de dev**, no el de prod. No mezclar tokens.
- **Schedulers en dev** corren al doble de intervalo: las pruebas de procesos automáticos tardan más.
- **Bote acumulado**: por ahora solo se acumula; "jugar el bote" es pendiente futuro.
