# Vista de torneos: Quiniela y Survivor por fase

Documento visual de la pantalla de **detalle de torneo** (`torneo-detalle.component.ts`) y cómo cambia según el tipo de torneo (quiniela vs survivor) y la fase en que se encuentra.

## Aclaración sobre las "tres fases"

A nivel de **torneo** solo existen tres estados (`EstadoTorneo` en `torneo.model.ts`):

| Estado en código | Etiqueta que ve el usuario |
| ---------------- | -------------------------- |
| `inscripcion`    | **Inscripciones**          |
| `en-curso`       | **En curso**               |
| `finalizado`     | **Finalizado**             |

El término **"Abierta"** no es una fase del torneo. Pertenece al estado de la **jornada** (`Jornada.estado`: `abierta` \| `resuelta`, en `competicion.model.ts`). Dentro de la fase **En curso**, la jornada puede estar:

- **Abierta**: aún se puede pronosticar (quiniela) o elegir equipo (survivor). Requiere `jornada.estado === 'abierta'` y que la fecha de cierre no haya pasado.
- **Cerrada / revelada**: ya no se captura; se revelan los pronósticos o picks de los demás.

Por eso este documento organiza las fases así:

1. **Inscripciones** (`estado = inscripcion`)
2. **Abierta** → sub-momento de *En curso* con la jornada abierta (captura habilitada)
3. **En curso** → *En curso* con la jornada ya cerrada (revelado y seguimiento)

El **tipo** se decide por `ModoTorneo`: `quiniela` o `supervivencia` (survivor).

---

## Cabecera común (franja de estado)

Con el torneo cargado, siempre se muestra la franja de *pills* en la parte superior:

- **Estado**: "Inscripciones" / "En curso" / "Finalizado" (resaltado si está en curso).
- **Jornada**: "Inicia J{jornadaInicial}" en inscripción, o "Jornada {jornadaActual}" en curso.
- **Participantes**:
  - Quiniela → total de participantes.
  - Survivor → `vivos / total`.
- **Pill personal** (si participas):
  - Quiniela → tus puntos (`{puntosTorneo} pts`).
  - Survivor → corazón si tienes vidas, o "Sin vida".
- **Bolsa** (si `costoEntrada > 0`): muestra la bolsa acumulada o el premio entregado.

---

## FASE 1 — Inscripciones (`estado = inscripcion`)

Panel principal **"Inscripciones abiertas"**, común a ambos tipos con matices de texto.

### Quiniela

```
┌─────────────────────────────────────────────┐
│ [Inscripciones]  [Inicia J5]  [👥 8]  [🪙 800]│
├─────────────────────────────────────────────┤
│ ⏳ Inscripciones abiertas                     │
│                                               │
│ El torneo arranca en la jornada 5 de LigaMX. │
│ Hasta entonces no hay nada que pronosticar.   │
│                                               │
│ Se puede entrar hasta: 12 de mayo, 7:00 pm    │
│ Faltan 2 días · después arranca solo          │
│                                               │
│ Primera jornada: Jornada 5                    │
│ Cierra: 12 de mayo, 7:00 pm  (Faltan 2 días)  │
│                                               │
│ Partidos:                                     │
│   América vs Chivas                           │
│   Cruz Azul vs Pumas   ...                    │
└─────────────────────────────────────────────┘
```

### Survivor

Idéntico, cambia el texto: "Hasta entonces **no hay que elegir equipo**". Además la franja usa corazones/vidas en vez de puntos.

### Elementos de esta fase (ambos tipos)

- Título "Inscripciones abiertas".
- Jornada de arranque + competición.
- **Cierre de inscripción**: fecha límite y cuenta regresiva ("Faltan X · después arranca solo" o "Plazo vencido").
- **Primera jornada** (si ya está publicada): número, cierre, cuenta regresiva y listado de partidos con escudos. Si no está publicada: "Esa jornada todavía no se publica".
- **Panel de administración** (solo gestores): "Las inscripciones siguen abiertas" + botón **Iniciar torneo**.

> Unirse no ocurre dentro del detalle: se hace desde la lista de torneos (por código) o en la pantalla `unirse.component.ts`.

**No se muestra**: paneles de captura/elección, hero-pick, cartones, tabla de posiciones.

---

## FASE 2 — Abierta (En curso, jornada abierta)

Es la fase de **En curso** cuando la jornada está `abierta` y su cierre no ha pasado. Aquí es donde el jugador **captura**.

> **Enfrentamientos de la jornada** (`app-partidos-jornada`): solo aparece en **survivor** mientras puedes elegir, como referencia de contra quién juega cada equipo. Es informativo (solo muestra "vs" o "Apl."), no trae ni actualiza marcadores. En quiniela no se muestra, y al cerrar la jornada desaparece (los resultados pasan a verse en las tarjetas de juego).

### Quiniela — jornada abierta

```
┌─────────────────────────────────────────────┐
│ [En curso]  [Jornada 5]  [👥 8]  [12 pts]     │
├─────────────────────────────────────────────┤
│ Jornada 5              🕐 Cierra en 5 h       │
│                                               │
│ Marcador exacto: 5 puntos                     │
│ Solo acertar quién gana: 3 puntos             │
│                                               │
│ América    [ 2 ] – [ 1 ]    Chivas            │
│ Cruz Azul  [ 0 ] – [ 0 ]    Pumas             │
│ ...                                           │
│                                               │
│           [ Guardar pronósticos ]             │
└─────────────────────────────────────────────┘
```

- Inputs de marcador por partido.
- Botón **Guardar pronósticos** (`enviarQuiniela`).
- Si ya enviaste: "Ya enviaste tus pronósticos · Puedes cambiarlos mientras siga abierta".
- Los cartones de los demás **no** se ven todavía (evita copiarse).
- Este panel de captura **solo existe con la jornada abierta**. Una vez que la jornada está en curso o cerrada, ya no se visualiza en quiniela.

### Survivor — jornada abierta

```
┌─────────────────────────────────────────────┐
│ [En curso]  [Jornada 5]  [👥 6/8]  [❤]        │
├─────────────────────────────────────────────┤
│         Tu elección · Jornada 5               │
│                 (escudo grande)               │
│                  América                      │
│    Puedes cambiarla mientras siga abierta.    │
├─────────────────────────────────────────────┤
│ Jornada 5              🕐 Cierra en 5 h       │
│ Elige un equipo que gane. El empate te cuesta │
│ la vida y la derrota te elimina.              │
│                                               │
│  [América] [Cruz Azul] [Pumas] [Toluca] ...   │
│                                               │
│ 💤 Descansan esta jornada: Tigres, Monterrey  │
└─────────────────────────────────────────────┘
```

- **Hero-pick**: tu elección destacada con escudo grande (si ya elegiste).
- Botones de **equipos disponibles** (solo los que juegan esa jornada y que no has usado). Click → confirmar → `elegir`.
- **Descansan esta jornada**: equipos que aún podrías usar pero no juegan (bye week).
- Si ya usaste a todos los que juegan: aviso correspondiente.

### Panel "Mis equipos" (solo survivor, si sigues vivo)

Colapsable: chips de equipos **disponibles** y chips **"Ya no disponibles"** con la jornada en que los usaste.

---

## FASE 3 — En curso (jornada cerrada / revelado y seguimiento)

Mismo estado `en-curso`, pero con la jornada ya cerrada. Se abre el **revelado** y el seguimiento.

### Quiniela — jornada cerrada

```
┌─────────────────────────────────────────────┐
│ [En curso]  [Jornada 5]  [👥 8]  [12 pts]     │
├─────────────────────────────────────────────┤
│ Cartones de la jornada (todos los jugadores)  │
│  - marcador real / en vivo / aplazado         │
│  - pronóstico de cada quien, coloreado 5/3/0  │
│  - ranking de totales de la jornada           │
├─────────────────────────────────────────────┤
│ ▸ Historial de jornadas (colapsable)          │
├─────────────────────────────────────────────┤
│ Tabla de posiciones                           │
│  1. Ana      27 pts                           │
│  2. Tú       12 pts   ◀                       │
│  ...                                          │
└─────────────────────────────────────────────┘
```

- **Cartones de la jornada** (`app-cartones-jornada`): visibles solo tras el cierre.
- **Historial de jornadas**: colapsable, reutiliza el mismo componente de cartones para jornadas pasadas.
- **Tabla de posiciones** (`app-tabla-posiciones`): ordena por puntos, desempata por exactos, marca tu fila, badge "en vivo" si hay puntos de previa.

### Survivor — jornada cerrada

```
┌─────────────────────────────────────────────┐
│ [En curso]  [Jornada 5]  [👥 6/8]  [❤]        │
├─────────────────────────────────────────────┤
│ Participantes            ❤ 6 de 8 en pie      │
│                                               │
│ En pie                                        │
│  ● Ana   ❤❤   Vivo   (eligió: Toluca)         │
│  ● Tú    ❤    Vivo   ◀                         │
│  ...                                          │
│                                               │
│ ▸ Eliminados (colapsable)                     │
│  ✕ Beto  Eliminado · J3                       │
├─────────────────────────────────────────────┤
│ Tarjetas de la jornada 5                      │
│                                               │
│ ┌─── Juárez  0 - 2  Pachuca ──── ● En vivo ──┐│  ◀ partido en vivo, al inicio,
│ │  Joonathany · Juárez     Va perdiendo      ││    resaltado con el acento
│ │  Tú · Pachuca            Va ganando        ││
│ │  Samuel C · Pachuca      Va ganando        ││
│ └────────────────────────────────────────────┘│
│ ┌─── At. San Luis  vs  Guadalajara ──────────┐│
│ │  Serch · Guadalajara     Sin marcador      ││
│ └────────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

- **Panel Participantes** (sustituye a la tabla de posiciones):
  - **En pie**: avatar, alias, corazones según vidas, chip "Vivo". Al estar cerrada la jornada se revela qué eligió cada quien y sus equipos usados.
  - **Eliminados**: colapsable, con "Eliminado · J{n}" y equipos usados.
- **Tarjetas de la jornada** (`app-picks-jornada`): homologadas con los cartones de la quiniela. Una tarjeta por partido con su marcador (final, en vivo o "vs") y, debajo, la lista de participantes que eligieron a alguno de sus dos equipos, con el estado coloreado: **Va ganando** (verde), **Empate** (ámbar) o **Va perdiendo** (rojo).
  - El partido **conectado a la API con datos en vivo** se muestra **primero** y resaltado con los colores de acento de la app, con etiqueta "En vivo" y el minuto.

### Avisos personales (sobre todo survivor)

- **No participas**: "No participas en este torneo".
- **Eliminado**: "Quedaste eliminado en la jornada X". Si aplica revivir, panel **Revivir por N pts** (costo = `(jornadaActual / 2) × costoEntrada`).
- **Pick en espera**: si una elección quedó pendiente por partido aplazado.

### Administración (solo gestores, en curso)

Texto informativo + botón **Cerrar torneo y repartir** (`finalizar`).

---

## Paneles comunes al final (cualquier fase con datos)

- **Enfrentamientos de la jornada** (`app-partidos-jornada`): **solo survivor** y **solo mientras eliges** (jornada abierta). Es referencia de contra quién juega cada equipo; resalta el partido de tu equipo. No muestra ni actualiza marcadores ("vs" / "Apl.").
- **Tabla de la liga** (`app-tabla-liga`): solo si la competición tiene datos de API cacheados. Panel informativo de solo lectura (colapsable).
- **Cómo se juega** (`app-reglas-torneo`): siempre, colapsable. Reglas distintas por modo:
  - Quiniela → 5 pts exacto / 3 pts resultado, pronosticar toda la jornada, aplazados fuera, gana quien más puntos.
  - Survivor → un equipo por jornada, vidas (según `vidaCubre`: empate o tropiezo), no repetir equipo, revivir si aplica, gana el último en pie.

---

## Diferencias clave: Quiniela vs Survivor

| Aspecto                    | Quiniela                       | Survivor                          |
| -------------------------- | ------------------------------ | --------------------------------- |
| Pill participantes         | total                          | vivos / total                     |
| Pill personal              | puntos                         | corazón / "Sin vida"              |
| Captura (jornada abierta)  | inputs de marcador + Guardar   | botones de equipos + confirmar    |
| Elemento destacado         | —                              | hero-pick con escudo grande       |
| Ranking                    | tabla de posiciones (puntos)   | panel Participantes (En pie / Eliminados) |
| Revelado al cerrar jornada | cartones de todos              | picks en lista + tarjetas de juego |
| Tarjetas de juego          | `app-cartones-jornada`         | `app-picks-jornada` (homologadas) |
| Enfrentamientos (rivales)  | no                             | sí, solo mientras eliges          |
| Historial                  | sí (colapsable)                | no                                |
| Eliminación / revivir      | no aplica                      | avisos + panel revivir            |
| Reglas                     | 5 / 3 pts                      | vidas, no repetir, último en pie  |

---

## Referencias de código

- `src/app/features/torneos/torneo-detalle.component.ts` — Detalle: todos los `@if` por fase y tipo.
- `src/app/core/models/torneo.model.ts` — `EstadoTorneo`, `ModoTorneo`.
- `src/app/core/models/competicion.model.ts` — `Jornada.estado` (`abierta` / `resuelta`).
- `src/app/features/torneos/reglas-torneo.component.ts` — Reglas por modo.
- `src/app/features/torneos/torneos-list.component.ts` — Etiquetas de estado en tarjetas.
- `src/app/features/torneos/cartones-jornada.component.ts` — Tarjetas de juego de quiniela.
- `src/app/features/torneos/picks-jornada.component.ts` — Tarjetas de juego de survivor (homologadas), con resalte del partido en vivo.
- `src/app/features/torneos/partidos-jornada.component.ts` — Enfrentamientos de la jornada (solo survivor, mientras eliges).
- `src/app/features/torneos/tabla-posiciones.component.ts`, `tabla-liga.component.ts`, `unirse.component.ts` — Subcomponentes.
