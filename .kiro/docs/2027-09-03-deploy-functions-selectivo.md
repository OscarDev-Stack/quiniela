# Deploy de Cloud Functions: selectivo y quota 429

Fecha: 03 de septiembre de 2027

El proyecto tiene ~65 Cloud Functions en un solo entry point. Desplegar **todas**
a la vez es lento y a veces choca con el límite de tasa de Google:

```
HTTP Error: 429, Quota exceeded for quota metric 'Per project mutation requests'
and limit 'Per project mutation requests per minute per region'
```

No es un problema de facturación (el deploy es gratis): es un límite operativo de
Google Cloud sobre cuántas operaciones de despliegue admite por minuto y región.
El CLI reintenta solo ("Waiting to retry..."), pero conviene evitarlo.

## Regla práctica: desplegar SOLO lo que cambió

En vez de redesplegar las 65, sube únicamente las funciones tocadas:

```bash
# Una función
firebase deploy --only functions:consultarBracket --project quiniela-dev-d203d

# Varias (separadas por coma, sin espacios)
firebase deploy --only functions:hacerAdminGrupo,functions:quitarAdminGrupo --project quiniela-dev-d203d
```

Esto baja el deploy de varios minutos a segundos y evita el 429, porque hace pocas
mutaciones.

- Proyecto **dev**: `--project quiniela-dev-d203d`
- Proyecto **prod**: `--project quinelav1-e23eb`

> Nota: el `predeploy` de `firebase.json` compila las functions antes de subir.

## Cuándo desplegar TODO

Solo cuando de verdad haga falta (cambios transversales, o dudas de sincronía):

```bash
firebase deploy --only functions --project quiniela-dev-d203d
```

Si da 429 a media tanda: espera ~1 minuto y vuelve a correr el MISMO comando. El
deploy es idempotente y retoma las que faltan.

## Reglas de Firestore aparte

Si solo cambiaron reglas, no toques functions:

```bash
firebase deploy --only firestore:rules --project quiniela-dev-d203d
```

## En el CI (GitHub Actions)

El workflow `deploy-firebase.yml` ahora despliega de forma condicional:

- **Functions**: solo si el push tocó algún archivo dentro de `functions/`. Se
  despliega `--only functions` con reintento (hasta 3 intentos, 60s de espera) para
  tolerar el 429 transitorio.
- **Reglas de Firestore**: solo si cambió `firestore.rules`.
- **Hosting**: siempre (es barato y rápido).

Así, un push que solo toca el front NO redespliega las funciones, evitando el 429.

> Limitación actual: como todas las funciones viven en un solo `index.ts`, cuando
> SÍ cambia `functions/` se redesplegan todas. Una vez partido el monolito por
> dominios, se podrá afinar a desplegar solo las funciones del dominio cambiado.
