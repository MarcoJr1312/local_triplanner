# Triplanner — Frontend Next.js

Frontend de Triplanner migrado a **Next.js 15 (App Router)**: mismas pantallas y
diseño que la app Vite original (`../frontend`), con el proxy seguro de GraphQL.

## Stack

- Next.js 15 App Router + React 19 + TypeScript estricto
- Tailwind CSS (escala `brand` #6C3BFF, sombras card/hover, Inter Variable)
- lucide-react para iconos
- Datos vía fachada `lib/api.ts` → `fetch('/api/graphql')` (proxy)

## Arquitectura

```
Navegador → Next (:3000) → app/api/graphql/route.ts → backend local TS (:4000)
                                                        └─ SQLite + HasData (key SOLO aquí)
```

- El navegador **nunca** habla directo con :4000 ni ve credenciales.
- `HASDATA_API_KEY` vive solo en `local/.env` (backend). Prohibido `NEXT_PUBLIC_*` sensible.
- Backend URL server-side: `NEXT_PRIVATE_BACKEND_URL` (default `http://localhost:4000/graphql`).

## Rutas

| Ruta | Pantalla |
|---|---|
| `/login` | Login demo (no valida credenciales) |
| `/` | Mis viajes (mini-stats, tarjetas, presupuesto) |
| `/trip/[id]` | Detalle: días, actividades, presupuesto, miembros, presencia, búsqueda |
| `/api/graphql` | Proxy GraphQL (POST) al backend local |

## Desarrollo

```bash
bun install
bun run dev     # http://localhost:3000
bun run build   # build de producción
bun run start   # servir el build
```

Requisitos: backend local TS corriendo en `:4000` (`cd ../local/server && bun src/index.ts`).
Sin backend, el proxy devuelve 502 y la UI muestra estados vacíos.

## Reglas (ver AGENTS.md raíz)

- UI 100% en español; marca #6C3BFF.
- Componentes con hooks: `'use client'`; data fetching del servidor cuando sea posible.
- Cero credenciales en el cliente. Cero AWS.
- Verificar `npm run build` sin errores antes de commit.
