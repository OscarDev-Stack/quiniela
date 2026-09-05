# Escáner de QR para unirse (torneos, eliminatorias y grupos)

Fecha: 05 de septiembre de 2026
Rama: `develop`

Se agregó un escáner de códigos QR dentro de la app para unirse a torneos, eliminatorias y
grupos leyendo la cámara en el propio dispositivo. Complementa la generación de QR que ya
existía (`codigo-invitar.component`): ahora también se pueden **leer**. Todo es front, no
requiere deploy de Cloud Functions ni cambios de reglas. Build en verde.

---

## 1. Componente escáner compartido

`src/app/shared/escaner-qr.component.ts` (standalone, selector `app-escaner-qr`):

- Usa `@zxing/browser` + `@zxing/library` para decodificar QR en el navegador (sin terceros:
  la imagen no sale del dispositivo).
- La cámara se enciende con un **botón "Escanear QR"** (gesto de usuario, requisito de iOS
  Safari), nunca automáticamente al montar la vista.
- Prefiere la **cámara trasera** en móviles (`facingMode: environment`).
- Maneja errores de permiso con mensajes claros: permiso denegado, sin cámara, cámara ocupada.
- Ofrece siempre un **fallback manual**: campo para escribir el código + botón "Usar".
- Inputs:
  - `tipoPorDefecto` (`'torneo' | 'bracket' | 'grupo'`, por defecto `'torneo'`): tipo asumido
    cuando el QR/código no trae ruta (código suelto).
  - `autoNavegar` (por defecto `true`): si es `true`, al reconocer una invitación navega solo
    a la pantalla de "unirse"; si es `false`, solo emite `(leido)` y deja que el contenedor
    decida (lo usan los modales de torneos y grupos).
- Output: `(leido)` con la `InvitacionPendiente` reconocida.

**Requisitos del navegador:** `getUserMedia` solo funciona en HTTPS o `localhost` (ya cubierto
por Firebase Hosting y el dev server).

## 2. Parser de QR en la utilidad de invitaciones

`src/app/shared/invitacion.util.ts` — nueva función `interpretarQr(texto, tipoPorDefecto)`:

- Acepta un **deep-link** (lo que codifican los QR: `.../unirse|unirse-elim|unirse-grupo/CODIGO`)
  o un **código suelto**.
- De la URL extrae el segmento de ruta y el código, mapeando `unirse-elim` → tipo `bracket`.
- Un código suelto se interpreta con el `tipoPorDefecto` recibido.
- Devuelve una `InvitacionPendiente` (`{ tipo, valor }`) o `null` si no reconoce el contenido.
- Reutiliza el mapeo `rutaDeInvitacion` ya existente.

## 3. Integración en los modales "Unirme con código"

Se sustituyó el input suelto de código por el escáner (que ya trae su propia entrada manual)
dentro del mismo modal, con un único botón para abrirlo.

- **Torneos** (`src/app/features/torneos/torneos-list.component.ts`): el modal usa
  `<app-escaner-qr [autoNavegar]="false">`. `onEscaneado()` decide: grupo → `/unirse-grupo`,
  eliminatoria → `/unirse-elim`, y para torneo/código suelto reusa `unirse()` (prueba torneo
  con `consultarTorneo` y, si no existe, lo intenta como eliminatoria). Cubre **torneos y
  eliminatorias** con un solo modal, como ya hacía el flujo original.
- **Grupos** (`src/app/features/grupos/grupos.component.ts`): el modal usa
  `<app-escaner-qr [autoNavegar]="false" tipoPorDefecto="grupo">`. `onEscaneado()` une al grupo
  con `gruposSrv.unirse()` (y cambia el contexto activo); si el QR es explícitamente de torneo o
  eliminatoria, redirige a su ruta.

No se agregó modal aparte para eliminatorias: el de torneos ya las cubre.

## 4. Dependencias

- Nuevas: `@zxing/browser` y `@zxing/library`, instaladas con `--legacy-peer-deps` por el
  conflicto de peer deps preexistente del árbol Angular/Fire (no relacionado con ZXing).
- El escáner queda como lazy chunk dentro de las vistas de torneos y grupos; no afecta la carga
  inicial.

## 5. Ajustes de UI

- Marco/mira del escáner centrado dentro de una caja propia del video (`.video-caja` con
  `position: relative` + `overflow: hidden`), en vez de posicionarse sobre todo el contenedor
  (antes quedaba desalineado).
- Separación entre el bloque de entrada manual y el botón "Cerrar" del modal: `.dialogo-acciones`
  con `margin-top` + `padding-top` + borde superior, en torneos y grupos.

---

## Validaciones sugeridas

- Probar en **dispositivos reales** (Android + iPhone) sobre HTTPS: la cámara no funciona en
  emuladores ni sobre `http://IP-local`, solo HTTPS o `localhost`.
- Escanear un QR de torneo, de eliminatoria y de grupo, y confirmar que cada uno lleva al
  destino correcto.
- Denegar el permiso de cámara y confirmar el mensaje + el fallback de escribir el código.
- Escribir el código a mano y confirmar que une igual que el escaneo.
