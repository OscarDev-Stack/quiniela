# Analytics: instrumentacion de eventos y guia de GA4

## Fecha: 28 de agosto 2026

## Que es GA4 y como se conecta

GA4 (Google Analytics 4) es la version actual de Google Analytics. Firebase
Analytics y GA4 son la misma cosa: la app envia eventos con el SDK de Firebase
y esos eventos se ven/analizan en la consola de GA4.

Al activar Analytics en Firebase se creo una propiedad de GA4 enlazada. El
`measurementId` de cada entorno es el identificador de esa propiedad:

- Dev (`quiniela-dev-d203d`): `G-F9Z8QCSFH2`
- Prod (`quinelav1-e23eb`): `G-N54K2C3C1T`

NOTA: en dev el `measurementId` tenia una comilla de mas (`'G-F9Z8QCSFH2"'`) que
impedia el registro. Se corrigio en esta sesion.

## Como funciona en el codigo

- `src/app/app.config.ts` provee Analytics con `provideAnalytics`, mas
  `ScreenTrackingService` (rastreo automatico de vistas) y `UserTrackingService`.
- `src/app/shared/stats.service.ts` es el punto unico para medir:
  - `evento(nombre, datos)` -> `logEvent` (eventos de uso).
  - `propiedades(props)` -> `setUserProperties` (propiedades categoricas del
    usuario para segmentar; SIN PII).
  - Todo va envuelto en try/catch: si Analytics no esta disponible
    (bloqueadores, incognito), nunca tumba la app.

### Privacidad
Los datos son agregados y anonimos. No se mandan correos ni alias reales como
parametros. Para identificar cohortes se usan propiedades categoricas.

## Catalogo de eventos

### Embudo de entrada
- `login_visto` — abrio la pantalla de acceso.
- `registro_visto` — abrio la pantalla de crear cuenta.
- `sesion_iniciada` — entro con exito. Prop: `metodo` (`correo` | `google`).
- `login_fallido` — fallo el acceso. Props: `metodo`, `motivo` (codigo de error).
- `cuenta_creada` — se creo una cuenta. Prop: `metodo` (`correo` | `google`).
- `registro_pendiente_validacion` — la cuenta nueva quedo a la espera de
  validacion del admin. Prop: `metodo`.
- `registro_fallido` — fallo el registro. Prop: `motivo`.
- `hub_visto` — llego al hub de inicio.

### Activacion
- `torneo_creado` — props: `modo` (supervivencia | quiniela), `es_grupo` (si | no).
- `bracket_creado` — props: `modo` (pronostico | duenos), `equipos`, `es_grupo`.
- `quiniela_guardada` — prop: `partidos` (cuantos marcadores).
- `torneo_union` — se unio a un torneo por codigo.
- `pronostico_hecho` — prop: `multiplicador`.
- `alias_cambiado` — cambio su nombre publico.
- `perfil_editado` — prop: `campo` (por ahora `alias`).

### Retencion / PWA
- `logout` — cierre voluntario de sesion. Prop: `origen` (`nav` | `perfil`).
- `push_activado` — activo notificaciones push.
- `app_instalada` — prop: `plataforma`.
- `instalar_pasos_vistos` — vio los pasos de instalacion en iOS.

### Propiedades de usuario (setUserProperties)
Se marcan en `src/app/app.ts` cuando hay sesion (combinando `me$` e `isAdmin$`):
- `rol`: `super_admin` | `admin_grupo` | `jugador`.
- `validado`: `si` | `no`.

## Guia de la consola de GA4 (Opcion A, sin codigo)

Requiere entrar con la cuenta de Google dueña del proyecto de Firebase.

### 1. Verificar que los eventos llegan (inmediato)
- Consola de GA4 -> Administrar -> DebugView, o Informes -> Tiempo real.
- Abre la app y navega por login/registro/inicio: deberias ver
  `login_visto`, `registro_visto`, `hub_visto`, etc. aparecer en vivo.
- Para forzar el modo debug en web se puede usar la extension "Google
  Analytics Debugger" del navegador.

### 2. Ver conteos diarios por evento
- Informes -> Interaccion -> Eventos.
- Ahi sale la lista de eventos con su conteo. Los informes estandar tardan
  24-48h en poblar la primera vez (Tiempo real es inmediato).

### 3. Armar el embudo de entrada
- Explorar -> nueva exploracion -> tecnica "Exploracion de embudo".
- Definir los pasos en orden:
  1. `login_visto`
  2. `registro_visto`
  3. `cuenta_creada`
  4. `hub_visto`
- GA4 dibuja cuantos avanzan de un paso al siguiente y donde se caen.
- Se puede agregar un paso `sesion_iniciada` para separar quienes ya tenian
  cuenta de quienes la crearon.

### 4. Marcar conversiones (eventos clave)
- Administrar -> Eventos (o "Eventos clave" en versiones nuevas).
- Marcar como conversion: `cuenta_creada`, `torneo_creado`, `pronostico_hecho`.
- Asi GA4 calcula tasas de conversion automaticamente.

### 5. Segmentar por rol y validacion
- En cualquier exploracion, agregar como dimension las propiedades de usuario
  `rol` y `validado` (hay que registrarlas primero como "dimensiones
  personalizadas con alcance de usuario" en Administrar -> Definiciones
  personalizadas).
- Con eso puedes ver, por ejemplo, cuantos jugadores validados llegan al hub
  frente a los que se quedan pendientes.

### Notas sobre latencia
- Tiempo real y DebugView: inmediatos.
- Informes estandar y exploraciones: hasta 24-48h la primera vez, luego el
  procesamiento tipico es de unas horas.

## Archivos relacionados con la instrumentacion

- `src/environments/environment.ts` — correccion del `measurementId` de dev.
- `src/app/shared/stats.service.ts` — metodos `evento` y `propiedades`.
- `src/app/app.ts` — propiedades de usuario (`rol`, `validado`).
- `src/app/features/auth/login.component.ts` — eventos de login/sesion/cuenta.
- `src/app/features/auth/register.component.ts` — eventos de registro.
- `src/app/features/inicio/inicio.component.ts` — `hub_visto`.
- `src/app/features/admin/crear-torneo.component.ts` — `torneo_creado`.
- `src/app/features/brackets/crear-bracket.component.ts` — `bracket_creado`.
- `src/app/features/torneos/torneo-detalle.component.ts` — `quiniela_guardada`.
- `src/app/features/perfil/perfil.component.ts` — `alias_cambiado`,
  `perfil_editado`, `logout`.
- `src/app/shared/nav.component.ts` — `logout`.
