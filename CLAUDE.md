# pos_backend

API del punto de venta. Lee también `../CLAUDE.md` (reglas de dinero, roles, flujo Git).

## Stack

Node 24 · Express 5 · TypeScript 7 (ESM, `module: NodeNext`) · Mongoose 9 · Zod 4 · jsonwebtoken · bcryptjs · pino · Vitest + Supertest + mongodb-memory-server · Biome (lint + formato).

## Comandos

| Comando                           | Qué hace                                                                                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Servidor con recarga (`tsx watch`), lee `.env`                                                                                                                                                                                                  |
| `npm run dev:memory -- --seed`    | Servidor SIN Atlas: replica set en memoria + marisquería demo (demo.root / demo.admin / demo.caja, clave `Demo12345`). Datos efímeros                                                                                                           |
| `npm run dev:memory -- --history` | Lo anterior + ~14 meses de historial ficticio (ventas, compras, cortes, cambios de precio, cancelaciones) para reportes; cajeros demo.caja2/demo.caja3 y negocio Abarrotes La Esquina (demo.esquina). `--months=N`. Reproducible (semilla fija) |
| `npm test`                        | Pruebas (Vitest)                                                                                                                                                                                                                                |
| `npm run typecheck`               | `tsc --noEmit`                                                                                                                                                                                                                                  |
| `npm run lint` / `npm run format` | Biome                                                                                                                                                                                                                                           |
| `npm run build`                   | Compila a `dist/` (lo empaqueta Electron)                                                                                                                                                                                                       |
| `npm start`                       | Ejecuta `dist/server.js`                                                                                                                                                                                                                        |

## Estructura

```
src/
  server.ts            arranque: env, listen, conexión a BD, apagado limpio
  app.ts               createApp(): middlewares, routers, manejo de errores (sin listen → testeable)
  config/env.ts        esquema Zod del entorno (loadEnv); config/index.ts exporta `env` ya validado
  db/connection.ts     conexión con reintentos, databaseState()
  db/schema-options.ts jsonOptions: toJSON con `id`, sin `_id`/`__v`/searchName/passwordHash
  types/express.d.ts   req.user (AuthUser) y req.businessId
  common/
    http/              response.ts (sendOk/sendCreated/sendError), errors.ts (AppError y helpers)
    middleware/        error-handler (+ notFoundHandler)
    utils/             decimal, money, qty, text (normalizeText/containsRegex), pagination, flatten,
                       dates (dayRange/startOfDayInZone: días en la zona horaria del negocio)
    validation.ts      objectIdSchema, idParamsSchema, optionalText
  db/transaction.ts    withTransaction(session => …) — requiere replica set
  modules/
    auth/              login/me/change-password, token (JWT), password (bcrypt),
                       auth.middleware (authenticate, authorize, requireUser),
                       tenant.middleware (resolveTenant, requireBusinessId, BUSINESS_HEADER)
    businesses/        CRUD superadmin + /current (negocio propio)
    users/             CRUD con reglas por rol
    categories/, suppliers/  catálogos simples (handlers directamente en *.routes.ts)
    products/          productos (código corto único, barcode opcional único), price-history
    inventory/         movement.model: kárdex + applyStockChange() (ÚNICO camino para tocar stock)
    counters/          nextSequence(businessId, key, session): folios consecutivos (E-, V-, C-)
    purchases/         entradas de mercancía (costo promedio, cambio de precio, cancelación)
    cash-sessions/     turnos de caja: abrir, entradas/salidas de efectivo, corte (summarize())
    sales/             ventas: precio/costo/IVA congelados por renglón, pagos informativos,
                       409 PRICE_CHANGED si el total visto no coincide; cancelar = admin
    pos/               GET /pos/catalog: catálogo ligero para la caja (todos los roles)
    reports/           GET /reports/{summary,sales-series,top-products,categories,payments,purchases}
                       (admin: su negocio; superadmin: x-business-id o TODOS) y /reports/businesses
                       (comparativa, superadmin). Solo snapshots de venta/compra; periodos con
                       $dateTrunc en la zona del negocio (semana desde lunes), huecos en cero
                       summary acepta until=HH:MM (corta el último día de ambos rangos: "a esta
                       hora") y compareFrom/compareTo (periodo de comparación; si no, el anterior)
    <entidad>/
      <entidad>.model.ts      esquema Mongoose (businessId + índices compuestos)
      <entidad>.schemas.ts    Zod de entrada (create/update/list query)
      <entidad>.service.ts    lógica; recibe actor/businessId explícitos
      <entidad>.controller.ts opcional: en módulos simples los handlers viven en routes
      <entidad>.routes.ts     authenticate → authorize(roles) → resolveTenant() → handlers
      <entidad>.test.ts       integración con Supertest
  scripts/seed-superadmin.ts  crea el primer superadmin
  dev/                 solo desarrollo (excluido del build): dev-memory, demo-seed, local-mongod,
                       history/ (simulador puro del historial + history-seed; probado en simulate.test.ts)
  test/                global-setup (ReplSet en memoria), db.ts (useTestDatabase), factories.ts
```

## Convenciones

- Imports relativos **con extensión `.js`** (ESM NodeNext): `import { x } from './x.js'`.
- `import type` para tipos (`verbatimModuleSyntax`).
- Respuestas: siempre `sendOk`/`sendCreated`/`sendError` → sobre `{ ok, data, message?, meta? }` o `{ ok:false, error:{ code, message, details? } }` con **status HTTP real**.
- Errores: lanza `AppError` (o `badRequest`, `notFound`, `forbidden`, `conflict`); el `errorHandler` traduce Zod, CastError, duplicados (11000) y JSON inválido.
- Rutas bajo `/api/v1/...`; salud en `GET /api/health` (siempre 200 si el proceso vive, con `db` = estado de Mongo).
- Validación: el controller hace `schema.parse(req.body|req.query|req.params)`; un `ZodError` se vuelve 400 `VALIDATION_ERROR` con `details.fieldErrors`. Express 5 propaga errores de handlers async (no hace falta try/catch).
- Multi-tenant: todo query de negocio incluye `businessId` tomado de `requireBusinessId(req)` (lo pone `resolveTenant()`), jamás del body. Admin/empleado: siempre su negocio. Superadmin: encabezado `x-business-id`.
- Recursos de otro negocio responden **404** (no se revela que existen); acciones no permitidas por rol, **403**.
- Hooks de Mongoose 9: tipa `this` explícitamente (`function (this: XDocument) {…}`).
- Operaciones que tocan varias colecciones (venta, compra, cancelaciones, alta con existencia) usan **`withTransaction`** y pasan `{ session }` a cada lectura/escritura. El MongoDB local standalone NO soporta transacciones: usar `npm run dev:memory` o Atlas.
- **Existencias**: nunca asignar `product.stock` a mano; usar `applyStockChange()` (actualiza stock + renglón de kárdex con antes/después, usuario y referencia).
- **Precios**: cada cambio de `salePriceCents`/`costCents` se registra con `recordPriceChange()` (fuente create/manual/purchase).
- Conflictos atribuibles a un campo: `fieldConflict('code', mensaje)` → 409 con `details.fieldErrors` (el frontend lo pinta en el input).
- Filtros por fecha: recibir `YYYY-MM-DD` y convertir con `dayRange(business.timezone, from, to)`.
- Dinero/cantidades: enteros (ver `../CLAUDE.md`). Usa `common/utils/money.ts`, no hagas cuentas sueltas.
- Borrado de catálogos = lógico (`active: false`).
- Mensajes al usuario en español. Zod usa su traducción al español para todo el API (`common/zod-locale.ts`, importado en `app.ts`); pon mensaje propio cuando el genérico no ayude.

## Entorno

- `.env` local (ignorado por git) con `MONGODB_URI` (incluye `/pos`), `JWT_SECRET` (≥32 chars), `PORT`, `HOST`, `CORS_ORIGINS`, `LOG_LEVEL`. Plantilla: `.env.example`.
- `PORT=0` asigna puerto libre; el servidor imprime `POS_BACKEND_READY port=<n>` en stdout (Electron lo lee).
- CORS permite el origen `"null"` (Electron con `file://`).
- Si Atlas rechaza la conexión, revisa Network Access (IP permitida) en Atlas.

## Pruebas

- Unitarias junto al archivo (`*.test.ts`). Integración con `mongodb-memory-server` en modo **ReplSet** (las transacciones lo requieren), levantado una vez en `src/test/global-setup.ts`.
- Binario de Mongo: usa `MONGOMS_SYSTEM_BINARY` o el `mongod` instalado en `C:\Program Files\MongoDB\Server\<versión>` (evita la descarga de ~600 MB). Instalar dependencias con `MONGOMS_DISABLE_POSTINSTALL=1`.
- En cada archivo de integración: `useTestDatabase()` (BD propia, índices creados, colecciones limpias por prueba) y `testApp()`, `seedTwoBusinesses()`, `bearer(user)` de `test/factories.ts`.
- Cada módulo con permisos debe probar: rol correcto ✔, rol incorrecto → 403, otro negocio → 404 (aislamiento), validación → 400, duplicado → 409.

## Primer arranque

`npm run seed:superadmin -- --username <usuario> --password <contraseña> --name "<Nombre>"` crea el superadmin en la BD del `.env`.
