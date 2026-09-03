# Invitaciones unificadas, bote en API y ranking de balance

Fecha: 03 de septiembre de 2027
Rama: `develop`

Resumen de los cambios de esta sesión relacionados con invitaciones (torneo/eliminatoria/grupo), el bote en partidos de API y el ranking por balance. Todo el front está en builds verdes; lo marcado como backend requiere desplegar Cloud Functions.

---

## 1. Sistema unificado de invitación (torneo / eliminatoria / grupo)

**Problema que resolvió:** la invitación pendiente se guardaba siempre al visitar la
pantalla de unirse (incluso con sesión) y no se limpiaba, así que cada login o cada
pestaña nueva reenviaba al usuario a "unirme a un torneo".

**Solución:** utilidad central `src/app/shared/invitacion.util.ts` con un único objeto en
localStorage `{ tipo: 'torneo' | 'bracket' | 'grupo', valor }`:

- `guardarInvitacion(tipo, valor)` — solo se llama cuando NO hay sesión (al ir a login/registro).
- `consumirInvitacion()` — lee y BORRA (consumo estricto, una sola vez).
- `limpiarInvitacion()` — borra el objeto y las claves antiguas (`invitacion`, `invitacionGrupo`).
- `rutaDeInvitacion(inv)` — ruta destino según el tipo.
- Migra automáticamente las claves antiguas al nuevo formato.

**Login y registro** ahora usan `consumirInvitacion()` + `rutaDeInvitacion()` para retomar
la invitación una sola vez y navegar al destino correcto.

**`app.ts`**: al resolver la primera navegación, si NO se aterriza en `/unirse*`, `/login`
o `/registro`, limpia cualquier invitación residual (arregla el bug en navegadores que ya
tenían el residuo).

## 2. Eliminatorias (brackets) con invitación como torneos

Antes el enlace de bracket iba directo a `/eliminatorias/:id` (tras `authGuard`), que
expulsaba a login sin recordar el destino. Ahora:

- Backend: nueva función `consultarBracket(codigo)` (pública) que devuelve nombre + reglas
  (modo, equipos, formato, costo, estado) sin unir. **Requiere deploy de functions.**
- Servicio: `BracketsService.consultar(codigo)`.
- Pantalla pública `src/app/features/brackets/unirse-elim.component.ts` + ruta
  `/unirse-elim/:codigo` (sin guard): muestra nombre y reglas; con sesión permite unirse
  (`unirseBracket`) y navega a `/eliminatorias/:id`; sin sesión guarda la invitación y ofrece
  login/registro.
- El QR/enlace de `gestionar-brackets` ahora apunta a `/unirse-elim/CODIGO`.

## 3. Compartir por código + QR (torneos, brackets, grupos)

- Componente compartido `src/app/shared/codigo-invitar.component.ts`: muestra el código,
  botón **Copiar código** (copia SOLO el código, ya no la URL) y **Ver QR** (QR local con la
  librería `qrcode`, sin terceros).
- Torneos → `/unirse/CODIGO`; eliminatorias → `/unirse-elim/CODIGO`; grupos →
  `/unirse-grupo/CODIGO` (nueva ruta + `unirse-grupo.component`).
- Dependencia nueva: `qrcode` (instalada con `--legacy-peer-deps` por un conflicto de peer
  deps preexistente del árbol Angular/Fire, no relacionado con qrcode).

## 4. Modal "¿Cómo se gana?" y nota de reparto (partidos)

- Botón "?" en la lista de partidos abre un modal estático con un ejemplo visual (bolsa 400,
  4 apostadores a 3 resultados, gana Local; muestra "+X por cada 100" por resultado).
- En la tarjeta del partido, cuando ya cerraron los pronósticos (en juego/finalizado),
  aparece una nota personalizada con TU pronóstico: "Apostaste a X: ganas +N por cada 100...".

## 5. Fix del bote en el premio mostrado (backend)

- `cerrarPartidos` ahora calcula `premioPor100` y `poolTotal` sobre la **bolsa neta**
  (descontando el bote), igual que la liquidación real. Antes mostraba premios inflados en
  partidos con bote. **Requiere deploy de functions.** Aplica a partidos que se cierren de
  ahí en adelante.

## 6. Selector de bote en el flujo de API (crear partido)

El campo "% al bote acumulado" existía solo en el formulario manual. Se agregó al bloque de
"Buscar partido por API" (`crear-partido.component.ts`), con las mismas opciones
(0/5/10/15/20%), y se envía al crear el partido desde la API tanto en el flujo global como
en el de grupo. No requiere backend nuevo (las funciones ya leían `porcentajeBote`).

## 7. Ranking de balance

- El **top 3 (podio)** en la vista Balance ahora muestra ganado (verde) y gastado (rojo)
  bajo el balance, como ya hacían las filas normales.
- La **vista Balance** dejó de ser exclusiva de admin: ahora la puede usar cualquier usuario
  con sesión **validado** (`puedeBalance = admin || validada`), siempre fuera de grupo.
- Sin cambios de backend ni reglas: `totalGanado`/`totalGastado`/`balance` ya se escriben en
  el doc público de `ranking` y las reglas ya permiten leerlo con sesión. Los no validados no
  aparecen en el ranking (el backend los excluye).

---

## Pendientes para producción (deploy)

- **Deploy de Cloud Functions** para que surtan efecto: `consultarBracket` (pantalla de
  invitación de eliminatoria) y el fix del bote en `cerrarPartidos`.
- El resto (invitaciones, QR, modal, selector de bote en API, ranking) es front y funciona
  sin deploy.

## Validaciones sugeridas

- Flujo sin sesión: abrir enlace/QR de torneo, eliminatoria y grupo; crear cuenta o iniciar
  sesión y confirmar que regresa a la invitación y une.
- Confirmar que el bug del residuo ya no aparece (login normal → inicio, no a "unirse").
- Copiar código copia solo el código (no la URL) en los tres.
- Partido de API creado con bote: al iniciar, el "+X por cada 100" ya sale reducido y el pago
  al liquidar coincide.
- Ranking Balance visible para un usuario validado no-admin, con ganado/gastado en el podio.
