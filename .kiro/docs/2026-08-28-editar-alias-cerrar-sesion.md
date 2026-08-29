# Features: Editar alias en perfil + Cerrar sesion en menu

## Fecha: 28 de agosto 2026

## 1. Editar el alias (nombre publico) en el perfil

### Contexto
Las reglas de Firestore NO dejan al usuario escribir su propio documento
(`users/{uid}`): `allow update, delete: if isAdmin();`. Por eso el cambio de alias
debe pasar por una Cloud Function, no por escritura directa del cliente.

### Backend (`functions/src/index.ts`)
Nueva funcion `cambiarAlias`:
- Valida sesion, alias entre 3 y 20 caracteres (mismo criterio que el registro)
- Actualiza `users/{uid}.alias`
- Llama a `actualizarRanking([uid])` para que el nombre nuevo aparezca de inmediato en
  el ranking (esa funcion toma el alias del documento del usuario)

### Frontend
- `perfil.service.ts`: metodo `cambiarAlias(alias)`
- `perfil.component.ts`:
  - Boton lapiz junto al nombre (solo en el perfil propio, `esMio()`)
  - Modo edicion inline: input + Guardar/Cancelar
  - Signals `editandoAlias`, `guardandoAlias`, campo `aliasBorrador`
  - Metodos `editarAlias()`, `cancelarAlias()`, `guardarAlias()`
  - Valida minimo 3 caracteres antes de llamar; si no cambio, cierra sin llamar

### Propagacion a grupos (agregado despues)
`cambiarAlias` ahora tambien actualiza el alias en cada grupo del usuario:
- `grupos/{id}/miembros/{uid}.alias` (set con merge; el miembro siempre existe)
- `grupos/{id}/tabla/{uid}.alias` (update; NO crea la fila si el usuario aun no ha
  jugado en ese grupo)

Antes, al cambiar el alias, en los grupos seguia apareciendo el nombre viejo porque el
alias se copia a esas subcolecciones al inscribirse.

### Nota
El alias en subcolecciones de eventos puntuales (participantes de torneos, picks,
quinielas, trofeos, ganadorAlias) son snapshots historicos del momento y NO se
reescriben. Solo se propagan las vistas "vivas": ranking global y grupos.

## 2. Cerrar sesion en el menu de tres puntos

Antes, cerrar sesion solo estaba en la pantalla de Perfil. Ahora tambien esta en el menu
de tres puntos (icono-top) del encabezado, accesible desde cualquier pantalla.

### Frontend (`nav.component.ts`)
- Nueva opcion "Cerrar sesion" al final del menu, separada con una linea
- Estilo `.menu-salir` (mismo aspecto que las filas del menu, en tono peligro/rojo)
- Metodo `cerrarSesion()`: cierra el menu, pide confirmacion (ConfirmarService),
  hace `auth.logout()` y navega a `/login`
- Se inyecto `ConfirmarService` en el nav

## Archivos modificados

- `functions/src/index.ts` — funcion `cambiarAlias`
- `src/app/core/services/perfil.service.ts` — metodo `cambiarAlias`
- `src/app/features/perfil/perfil.component.ts` — UI y logica de edicion del alias
- `src/app/shared/nav.component.ts` — opcion Cerrar sesion en el menu
