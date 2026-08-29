# Fix: Puntos parciales en brackets (eliminatorias)

## Fecha: 28 de agosto 2026

## Sintoma

En la vista de una eliminatoria (bracket) en curso, la seccion "Pronosticos de todos"
lista a los participantes pero sus puntos se quedan en 0, aunque ya haya rondas/partidos
cerrados donde los usuarios acertaron. Los puntos solo aparecian al FINAL, cuando un
admin calificaba manualmente el bracket.

## Causa raiz

El punteo de brackets solo se materializaba en `calificarBracket`, que:
1. Es `onCall` solo-admin (no se dispara solo)
2. Exige que el bracket este en estado `finalizado`

La funcion `capturarPartidoBracket` (que el gestor usa para capturar cada resultado)
resolvia las llaves y avanzaba a los ganadores, pero **nunca escribia `puntos`** en la
subcoleccion `pronosticos`. La tabla del frontend lee `puntos ?? 0`, asi que mientras el
bracket estaba `en-curso` siempre mostraba 0.

## Solucion

Se agrego una funcion auxiliar `recalcularPuntosBracket(ref)` que:
- Lee las `llaves` (ya resueltas hasta el momento) y el `puntaje` del bracket
- Recorre todos los pronosticos y recalcula sus puntos con `calificarBk` (la misma
  logica que usa la calificacion final)
- Escribe el `puntos` parcial en cada doc de `pronosticos`
- NO pisa a quien ya quedo `calificado` (para no interferir con el reparto final)

Se llama al final de `capturarPartidoBracket`, solo cuando una llave efectivamente se
resolvio (`llaveResuelta`) y el bracket NO es modo duenos (en ese modo no hay pronosticos
que calificar; gana el dueno del equipo campeon).

Asi, cada vez que se captura un resultado que cierra una llave, la tabla "Pronosticos de
todos" se actualiza con los aciertos acumulados ronda a ronda.

## Que sigue igual

- `calificarBracket` (reparto de bolsa, posiciones y premios) sigue siendo el paso final,
  ejecutado por el admin cuando el bracket queda `finalizado`. El fix solo agrega el
  punteo PARCIAL en curso; no cambia el reparto de premios.

## Archivos modificados

- `functions/src/index.ts`
  - `capturarPartidoBracket`: rastrea si se resolvio una llave y el modo; al terminar la
    transaccion, llama a `recalcularPuntosBracket`
  - Nueva funcion `recalcularPuntosBracket()`

---

## Nota sobre el torneo quiniela (mismo sintoma reportado)

El usuario reporta el mismo problema en torneos tipo quiniela. Sin embargo, el flujo de la
quiniela es DISTINTO:

- La quiniela SI tiene la funcion `calificarQuinielas`, que escribe `puntos` en cada carton
  y `puntosTorneo` (incrementado) en cada participante.
- Se dispara con `resolverJornadaCompeticion`, que exige que TODOS los partidos de la
  jornada tengan resultado capturado.

Es decir: la quiniela actualiza puntos cuando se RESUELVE la jornada completa, no partido a
partido. Si el gestor no ha resuelto la jornada (aunque partidos individuales esten
cerrados), los cartones siguen `pendiente` con puntos en 0.

**Opciones para la quiniela (pendiente de decidir con el usuario):**
1. Dejarlo como esta (los puntos aparecen al resolver la jornada completa). Es correcto por
   diseno: el carton es de toda la jornada.
2. Calcular puntos PARCIALES conforme cierran partidos individuales de la jornada. Esto
   requiere un punto de calculo al capturar cada resultado de jornada, similar al fix de
   brackets. Mas invasivo.
