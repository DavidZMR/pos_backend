# pos_backend

API del punto de venta multi-negocio (Express 5 + TypeScript + MongoDB).

## Requisitos
- Node.js 24+
- Acceso a MongoDB Atlas (la IP de tu equipo debe estar en *Network Access*)

## Inicio rápido
```bash
npm install
cp .env.example .env    # llena MONGODB_URI y JWT_SECRET
npm run dev             # http://127.0.0.1:3000/api/health
```

## Scripts
| Script | Descripción |
|---|---|
| `npm run dev` | Servidor en desarrollo con recarga |
| `npm test` | Pruebas |
| `npm run typecheck` | Verificación de tipos |
| `npm run lint` / `npm run format` | Lint y formato (Biome) |
| `npm run build` / `npm start` | Compilar y ejecutar producción |

## API
- `GET /api/health` → `{ ok, data: { status, db, uptimeSeconds } }`
- Endpoints de negocio bajo `/api/v1`.

Las convenciones del proyecto están en [`CLAUDE.md`](CLAUDE.md).
