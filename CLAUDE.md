# pos_backend

API del punto de venta. Lee también `../CLAUDE.md` (reglas de dinero, roles, flujo Git).

## Stack

Node 24 · Express 5 · TypeScript 7 (ESM, `module: NodeNext`) · Mongoose 9 · Zod 4 · jsonwebtoken · bcryptjs · pino · Vitest + Supertest + mongodb-memory-server · Biome (lint + formato).

## Comandos

| Comando                           | Qué hace                                       |
| --------------------------------- | ---------------------------------------------- |
| `npm run dev`                     | Servidor con recarga (`tsx watch`), lee `.env` |
| `npm test`                        | Pruebas (Vitest)                               |
| `npm run typecheck`               | `tsc --noEmit`                                 |
| `npm run lint` / `npm run format` | Biome                                          |
| `npm run build`                   | Compila a `dist/` (lo empaqueta Electron)      |
| `npm start`                       | Ejecuta `dist/server.js`                       |

## Estructura

```
src/
  server.ts            arranque: env, listen, conexión a BD, apagado limpio
  app.ts               createApp(): middlewares, routers, manejo de errores (sin listen → testeable)
  config/env.ts        variables de entorno validadas con Zod (loadEnv)
  db/connection.ts     conexión con reintentos, databaseState()
  common/
    http/              response.ts (sendOk/sendCreated/sendError), errors.ts (AppError y helpers)
    middleware/        error-handler, auth, authorize(roles), tenant, validate(zod)
    utils/             money.ts, qty.ts, normalize.ts, pagination.ts, dates.ts
  modules/<modulo>/
    <modulo>.model.ts      esquema Mongoose (siempre businessId + índices)
    <modulo>.schemas.ts    DTOs Zod de entrada (create/update/query)
    <modulo>.service.ts    lógica de negocio; recibe businessId explícito
    <modulo>.controller.ts adapta req/res → service
    <modulo>.routes.ts     Router con auth/authorize/validate
    <modulo>.test.ts       pruebas de integración
```

## Convenciones

- Imports relativos **con extensión `.js`** (ESM NodeNext): `import { x } from './x.js'`.
- `import type` para tipos (`verbatimModuleSyntax`).
- Respuestas: siempre `sendOk`/`sendCreated`/`sendError` → sobre `{ ok, data, message?, meta? }` o `{ ok:false, error:{ code, message, details? } }` con **status HTTP real**.
- Errores: lanza `AppError` (o `badRequest`, `notFound`, `forbidden`, `conflict`); el `errorHandler` traduce Zod, CastError, duplicados (11000) y JSON inválido.
- Rutas bajo `/api/v1/...`; salud en `GET /api/health` (siempre 200 si el proceso vive, con `db` = estado de Mongo).
- Multi-tenant: todo query de negocio incluye `businessId` tomado de `req.businessId` (lo pone el middleware `tenant`), jamás del body.
- Operaciones que tocan varias colecciones (venta, compra, cancelaciones) usan **transacción** (`session.withTransaction`).
- Dinero/cantidades: enteros (ver `../CLAUDE.md`). Usa `common/utils/money.ts`, no hagas cuentas sueltas.
- Borrado de catálogos = lógico (`active: false`).
- Mensajes al usuario en español.

## Entorno

- `.env` local (ignorado por git) con `MONGODB_URI` (incluye `/pos`), `JWT_SECRET` (≥32 chars), `PORT`, `HOST`, `CORS_ORIGINS`, `LOG_LEVEL`. Plantilla: `.env.example`.
- `PORT=0` asigna puerto libre; el servidor imprime `POS_BACKEND_READY port=<n>` en stdout (Electron lo lee).
- CORS permite el origen `"null"` (Electron con `file://`).
- Si Atlas rechaza la conexión, revisa Network Access (IP permitida) en Atlas.

## Pruebas

- Unitarias junto al archivo (`*.test.ts`). Integración con `mongodb-memory-server` en modo **ReplSet** (las transacciones lo requieren).
- Cada módulo con permisos debe probar: rol correcto ✔, rol incorrecto → 403, otro negocio → 404/403 (aislamiento).
