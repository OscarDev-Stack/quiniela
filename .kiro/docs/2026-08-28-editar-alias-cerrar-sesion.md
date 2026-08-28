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

### Nota
El alias en las subcolecciones de participantes de torneos (`torneos/{id}/participantes`)
se fija al inscribirse y NO se actualiza retroactivamente con este cambio. Si se quiere
que el alias nuevo se refleje ahi tambien, seria una mejora aparte.

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
