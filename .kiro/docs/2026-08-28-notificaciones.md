# Inventario de notificaciones (push + Telegram) y análisis

## Fecha: 28 de agosto 2026

## Cómo funciona el envío

Todas las notificaciones a usuarios pasan por la función central
`avisar(uids, texto)` (functions/src/index.ts), que envía por AMBOS canales
según la preferencia de cada usuario:
- Telegram: si el usuario tiene `notificaciones = true` y su chat vinculado.
- Push: si tiene `pushActivo = true` (con sus dispositivos en `pushTokens`).

Es decir, cada notificación puede llegar por push y/o Telegram según lo que
cada quien tenga activo. No hay notificaciones "solo push". Las únicas de un
solo canal son las respuestas del bot de Telegram (por su naturaleza).

## Notificaciones a JUGADORES (vía avisar → push + Telegram)

### Torneos supervivencia
1. Jornada resuelta, sigues en pie — "Jornada X resuelta. Quedan N en pie.
   Ya puedes elegir tu equipo para la jornada X+1."
2. Eliminado — "😔 [Torneo] ... tu equipo perdió."
3. Torneo terminado (ganador) — "¡Terminó el torneo! Ganó [alias].
   Premio: X pts por cabeza."
4. Torneo arrancó — "Arrancó el torneo... ya puedes elegir tu equipo /
   capturar tus marcadores de la jornada X."
5. Reviviste — "❤️‍🔥 [Torneo] ... volviste a entrar."

### Torneos quiniela
6. Jornada calificada — "Jornada X calificada. [podio]. Ya puedes ver los
   cartones de todos en la app."
7. Torneo arrancó (mismo #4, texto adaptado a quiniela).

### Recordatorio
8. Falta elegir/pronosticar — "⏰ [Torneo] ... cierra en X minutos, aún no
   eliges tu equipo."

### Eliminatorias (brackets)
9. Te asignaron un equipo (dueños) — "⚽ [Eliminatoria] ... te tocó [equipo]."
10. Aceptaste y se te cobró — "⚽ [Eliminatoria] ... entraste."
11. Sin saldo, se liberó tu equipo — "⚠️ [Eliminatoria] ... no se pudo cobrar."
12. Campeón (dueños) — "🏆 [Eliminatoria] ... tu equipo se coronó, ganaste X."
13. Premiado por posición (pronóstico) — "🏆 [Eliminatoria] ... quedaste en
    X° lugar, ganaste X pts."

## Notificaciones a ADMINS (vía avisar)
14. Cuenta nueva por validar — "👤 Cuenta nueva ... hay N pendientes."
15. Solicitud de reinicio de saldo — "♻️ Solicitud de reinicio ..."

## Notificaciones a ADMIN/CREADOR de eliminatoria
16. Reasignar equipo (un dueño quedó libre) — "⚠️ [Bracket] ... reasigna."
17. Dueños pendientes por aceptar (recordatorio antes del cierre) —
    "⏰ [Bracket] ... faltan por aceptar: [nombres]."

## Mensajes del BOT de Telegram (solo Telegram, respuestas directas)
18. Vinculación exitosa — "¡Va, [alias]! Ya quedaste. 🏆"
19. Prueba al activar — "Listo, aquí te llegarán los avisos de tus torneos."
20. Desvinculación — "Listo, ya no te mandaremos avisos. Usa /start."
21. Errores de vínculo — "Ese enlace ya no sirve / ya venció", etc.

## ANÁLISIS (recomendaciones)

### Buenas y necesarias (mantener)
- Arranque de torneo (#4/#7), jornada resuelta/calificada (#1/#6),
  eliminado (#2), terminó/ganaste (#3): son el núcleo del engagement.
  Avisan justo cuando el jugador tiene que actuar o le pasó algo relevante.
- Recordatorio "falta elegir" (#8): de las más valiosas — evita que la gente
  pierda por olvido. Alta prioridad de conservar.
- Premios de eliminatoria (#12/#13): tocan dinero/logro, deben avisarse.
- Admin: cuenta nueva (#14) y reinicio (#15): necesarias para operar.

### Candidatas a AJUSTAR (no quitar, pero afinar)
- Asignación/cobro de dueños (#9/#10): #9 (te asignaron equipo) es útil;
  #10 (aceptaste y se cobró) es una CONFIRMACIÓN de algo que el usuario
  acaba de hacer en la app — puede sentirse redundante como push. Evaluar
  bajarla a solo Telegram o quitarla.
- "Sin saldo, se liberó" (#11): correcta, pero conviene revisar el texto para
  que quede claro qué debe hacer el usuario.

### Posible RUIDO (revisar frecuencia)
- Si un jugador está en varios torneos a la vez, en un fin de semana de
  resoluciones puede recibir muchas notificaciones #1/#6 seguidas. No quitar,
  pero considerar a futuro un "resumen" si el volumen crece.

### FALTANTES que valdría la pena AGREGAR
- Partido/jornada por cerrar (mercado suelto): hoy el recordatorio #8 es de
  torneos. Un aviso "cierra pronto un partido donde no has pronosticado"
  ayudaría al engagement de los partidos sueltos.
- Resultado de TU partido/pronóstico liquidado: cuando se liquida un partido
  suelto (no de torneo), avisar "ganaste/perdiste X en [partido]". Hoy los
  torneos avisan, pero el pronóstico suelto no tiene aviso de resultado.
- Bolsa grande / partido destacado: aviso opcional "hay una bolsa de X pts en
  [partido]" para atraer participación. Con moderación.
- Aviso al admin de alertas de la API: cuando un partido queda con alertaApi
  (empate no admitido, aplazado), avisar al admin por push/Telegram en vez de
  que solo lo vea con el punto rojo. Cierra el ciclo de la resolución.

### Recomendación de prioridad
1. Agregar: resultado de pronóstico suelto liquidado (alto valor, cierra el
   ciclo del jugador que apuesta en partidos).
2. Agregar: recordatorio de partido suelto por cerrar (engagement).
3. Agregar: aviso al admin de alertaApi (operación).
4. Ajustar: #10 (confirmación de cobro) para reducir posible redundancia.
Nada urgente de QUITAR; el set actual es sano.
