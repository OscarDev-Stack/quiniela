# Proyecto Quiniela - Contexto General

## Stack Tecnologico
- **Frontend:** Angular 20 (standalone components, lazy loading, SCSS)
- **Backend:** Firebase Cloud Functions v2 (TypeScript)
- **Base de datos:** Firestore
- **Hosting:** Firebase Hosting (PWA con Service Worker)
- **Auth:** Firebase Authentication
- **API externa:** football-data.org (resultados en vivo)
- **Notificaciones:** Firebase Cloud Messaging + Telegram Bot
- **Captcha:** Cloudflare Turnstile

## Estructura del Proyecto
```
src/app/
  core/         -> Guards, modelos, servicios
  features/     -> Componentes por feature (lazy loaded)
  shared/       -> Componentes compartidos
functions/src/  -> Cloud Functions (index.ts monolitico)
```

## Convenciones
- Componentes standalone Angular (sin NgModules)
- Lazy loading en todas las rutas
- Servicios inyectados con `providedIn: 'root'`
- Reglas de Firestore estrictas (escrituras criticas solo via Cloud Functions)
- Idioma del codigo: espanol para nombres de dominio, ingles para patrones tecnicos
- Prettier con singleQuote y printWidth 100

## Rama de trabajo
- Rama principal de desarrollo: `develop`
- Flujo: feature branches -> develop -> main (produccion)
