# Feature: Previa de puntos en quiniela (resultados parciales)

## Fecha: 28 de agosto 2026

## Objetivo

Que los jugadores de un torneo quiniela vean sus puntos parciales conforme el gestor
captura y GUARDA resultados de la jornada, sin esperar a que se PUBLIQUE (resuelva) la
jornada completa.

## Decisiones de diseno (confirmadas con el usuario)

1. Nueva Cloud Function dedicada (`previsualizarQuiniela`), no modificar el flujo actual.
2. Los puntos de previa se guardan en CAMPOS SEPARADOS (`puntosPrevia`, `exactosPrevia`),
   no en los oficiales (`puntosTorneo`, `puntos`). Asi el reparto de premios y la
   resolucion final quedan intactos, y no hay riesgo de contar doble.

## Flujo actual (antes del cambio)

Panel del gestor de liga (`liga-panel.component.ts`):
- **Guardar** -> `guardarResultados()` -> escribe marcadores directo en Firestore. No calcula puntos.
- **Publicar** -> `guardarResultados()` + `resolver()` (`resolverJornadaCompeticion`) ->
  califica quinielas: escribe `puntos` en cartones y suma `puntosTorneo` en participantes.

## Cambios

### Backend (`functions/src/index.ts`)

1. **Helper `puntosDeCarton(marcadores, partidos)`**: extrae el calculo de puntos de un
   carton (exacto=5, resultado=3, partidos sin resultado o aplazados no suman). Lo usan
   tanto `calificarQuinielas` (oficial) como la previa. Refactor sin cambio de comportamiento.

2. **Nueva funcion `previsualizarQuiniela(competicionId, jornadaId)`**:
   - Permiso: admin global o gestor de la competicion (igual que resolver)
   - Busca torneos quiniela en-curso parados en esa jornada
   - Para cada carton PENDIENTE, calcula puntos con lo capturado hasta ahora
   - Escribe `puntosPrevia`/`exactosPrevia` en el carton
   - Escribe `puntosPrevia`/`exactosPrevia` en el participante con SET ABSOLUTO
     (no increment): idempotente, se puede llamar muchas veces sin acumular de mas
   - No toca cartones ya `calificada` (esos tienen puntaje oficial)

3. **`calificarQuinielas`** ahora LIMPIA la previa al calificar en firme
   (`FieldValue.delete()` de `puntosPrevia`/`exactosPrevia`), tanto en el carton como en el
   participante. Asi, al resolver la jornada, `puntosTorneo` ya incluye esos puntos y la
   previa desaparece: nunca se cuenta doble.

### Frontend

1. **`competiciones.service.ts`**: nuevo metodo `previsualizarQuiniela()`.

2. **`liga-panel.component.ts`**: el boton **Guardar** ahora, tras guardar resultados,
   llama a `previsualizarQuiniela()`. Si la previa falla, no bloquea el guardado (es un extra).

3. **Modelo `torneo.model.ts`**: campos `puntosPrevia`/`exactosPrevia` en `Participante` y `Quiniela`.

4. **`tabla-posiciones.component.ts`**: los puntos visibles son
   `puntosTorneo + puntosPrevia` (y exactos igual). Muestra una etiqueta "en vivo" cuando
   hay previa. Ordena por el total.

5. **`cartones-jornada.component.ts`**: el total del carton usa `puntos ?? puntosPrevia ?? 0`
   (oficial si ya se resolvio, previa mientras esta en curso).

## Como se evita contar doble (clave del diseno)

- `puntosPrevia` = puntos de la JORNADA EN CURSO (parciales)
- `puntosTorneo` = acumulado OFICIAL de jornadas ya resueltas
- Total visible = `puntosTorneo + puntosPrevia`
- Al resolver la jornada: `calificarQuinielas` suma los puntos a `puntosTorneo` Y borra
  `puntosPrevia`. El total visible sigue siendo correcto, sin salto ni duplicado.

## Archivos modificados

- `functions/src/index.ts`
- `src/app/core/services/competiciones.service.ts`
- `src/app/features/liga/liga-panel.component.ts`
- `src/app/core/models/torneo.model.ts`
- `src/app/features/torneos/tabla-posiciones.component.ts`
- `src/app/features/torneos/cartones-jornada.component.ts`

## Nota

Esta previa aplica al torneo QUINIELA. El fix de puntos parciales de BRACKETS
(eliminatorias) esta documentado aparte en `2026-08-28-puntos-brackets-parciales.md`.
