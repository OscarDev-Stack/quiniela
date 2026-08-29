# Feature: Autenticacion con Google

## Fecha: 28 de agosto 2026

## Decisiones de diseno

| Pregunta | Respuesta |
|----------|-----------|
| Alias de quien entra con Google | Nombre de Google (displayName), editable luego en perfil |
| Validacion de admin | Si, quedan pendientes de validacion igual que el registro normal |
| Ubicacion del boton | Solo en la pantalla de login por ahora |

## Comportamiento

1. El usuario toca "Continuar con Google" en /login
2. Se abre un popup de Google (`signInWithPopup` + `GoogleAuthProvider`)
3. Se fuerza `prompt: 'select_account'` para que siempre pueda elegir cuenta
4. Al autenticar:
   - Si es la PRIMERA vez (no existe `users/{uid}`): se crea el documento con
     - `alias`: nombre de Google (o parte local del correo como respaldo)
     - `validada: false` (pendiente de validacion por admin)
     - `puntos: 0`
     - `bloqueado: false`
     - `rol: 'user'`
   - Se avisa a los administradores (`avisarRegistro`)
   - Si YA existe: solo inicia sesion, no se toca su documento
5. Navega a /inicio (o consume invitacion pendiente si la hay)

## Cumplimiento de reglas de Firestore

La regla de creacion de `users/{uid}` exige:
```
allow create: if request.auth.uid == uid
  && request.resource.data.puntos == 0
  && request.resource.data.validada == false;
```
La creacion via Google cumple ambas condiciones (`puntos: 0`, `validada: false`).

## Manejo de errores

Se agrego `mapErrorGoogle()` para casos especificos:
- `popup-closed-by-user` / `cancelled-popup-request` / `user-cancelled`: sin mensaje (el usuario cancelo a proposito)
- `popup-blocked`: pide habilitar popups
- `account-exists-with-different-credential`: correo ya usado con otro metodo
- `network-request-failed`: problema de conexion

## Archivos modificados

- `src/app/core/services/auth.service.ts` — nuevo metodo `loginConGoogle()`
- `src/app/features/auth/login.component.ts` — boton de Google, logica `onGoogle()`, creacion de documento primera vez, manejo de errores, estilos

## Configuracion requerida en Firebase (fuera del codigo)

Para que funcione en cada entorno (dev y prod), en la consola de Firebase:
1. Authentication -> Sign-in method -> habilitar proveedor **Google**
2. Verificar que los dominios autorizados incluyan:
   - `quiniela-dev-d203d.web.app` (dev)
   - el dominio de produccion (`quinelav1-e23eb`)
   - `localhost` (para pruebas locales)

Sin habilitar el proveedor en consola, el popup fallara con `auth/operation-not-allowed`.

## Vinculacion de cuentas (account linking) — agregado despues

Antes, si el correo ya existia con contraseña y el usuario intentaba entrar con Google,
se bloqueaba con un mensaje (Opcion A). Ahora se implemento la vinculacion (Opcion B):

**Flujo:**
1. El usuario toca "Continuar con Google"
2. Firebase lanza `auth/account-exists-with-different-credential` (el correo ya existe con contraseña)
3. Se captura la credencial de Google del error (`GoogleAuthProvider.credentialFromError`) y el correo
4. Se muestra un modal pidiendo la contraseña de la cuenta existente
5. Al confirmar: `signInWithEmailAndPassword` + `linkWithCredential` unen Google a esa cuenta
6. El usuario queda logueado con AMBOS metodos activos sobre el MISMO uid (sin duplicados)

**Metodos nuevos en AuthService:**
- `credencialGoogleDeError(error)`: extrae la AuthCredential del error de popup
- `vincularConContrasena(email, password, credencial)`: inicia sesion con correo y vincula la credencial

**UI (login.component):** modal de vinculacion con el correo, campo de contraseña y
botones Conectar/Cancelar. El error tipico (contraseña incorrecta) se muestra ahi mismo.

**Requisito en consola Firebase:** en Authentication -> Settings, el modo de vinculacion
debe ser "una cuenta por correo" (el comportamiento por defecto que lanza el error). Con
"multiples cuentas por correo" no se dispara este flujo.
