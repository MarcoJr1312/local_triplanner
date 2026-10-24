# Triplanner — Frontend

Frontend de **Triplanner**, la app colaborativa de planificación de viajes. Corre 100% en local
con datos simulados (modo mock); no toca AWS ni requiere conexión a internet.

## Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS
- react-router-dom
- lucide-react (iconos)
- Capa de datos propia en `src/lib/` (mock-first)

## Cómo correr

```bash
npm install
npm run dev
```

El servidor de desarrollo se levanta en **http://0.0.0.0:5173** (ver `vite.config.ts`).

Para compilar y verificar tipos:

```bash
npm run build
```

## Uso de la demo

1. Entra en la pantalla de login y pulsa **"Entrar como Demo"** (entrarás como *Marco Rossi*).
2. Verás dos viajes de ejemplo:
   - **Toronto — Fin de semana** (5 días, presupuesto $1,800)
   - **Panamá — Escapada** (3 días, presupuesto $950)
3. Dentro de un viaje puedes: añadir actividades del catálogo o manuales, editar costos,
   mover ítems entre días, pedir **sugerencias de IA**, invitar miembros, cambiar roles y
   editar el presupuesto.
4. La **presencia** es simulada: cada 10–20 s un "usuario bot" (Sofía, Diego, Valeria o Mateo)
   entra o sale del viaje, y lo verás reflejado con puntitos verdes.

## Modo mock vs modo real

El modo se decide en `src/lib/config.ts` a partir de `src/aws-config.json`:

- Si todos los campos están vacíos (placeholders) → **modo mock** (`mockApi.ts`).
- Si se rellenan los endpoints → **modo real** (`realApi.ts`, hoy un stub con TODO).

## Conectar el backend real (cuando esté desplegado)

1. Rellena `src/aws-config.json` con los outputs de Terraform:

   ```json
   {
     "graphqlEndpoint": "https://xxxx.appsync-api.us-east-1.amazonaws.com/graphql",
     "realtimeEndpoint": "wss://xxxx.appsync-realtime-api.us-east-1.amazonaws.com/graphql",
     "apiId": "xxxx",
     "userPoolId": "us-east-1_xxxx",
     "userPoolClientId": "xxxx",
     "region": "us-east-1"
   }
   ```

2. Implementa `src/lib/realApi.ts` usando `@apollo/client` (HTTP + WebSocketLink para
   `onTripChanged` / `onPresenceChanged`) y Cognito Auth. El schema GraphQL real está en
   `backend/graphql/schema.graphql`; las firmas ya están reflejadas en `src/lib/types.ts`
   (interfaz `TriplannerApi`), así que solo hay que rellenar la implementación.

## Estructura

```
frontend/
├── src/
│   ├── aws-config.json          # placeholders (vacíos = modo mock)
│   ├── lib/
│   │   ├── types.ts             # tipos que reflejan el schema GraphQL
│   │   ├── config.ts            # detecta mock vs real
│   │   ├── mockApi.ts           # API local en memoria + latencia + presencia simulada
│   │   ├── realApi.ts           # stub con TODO para AppSync
│   │   ├── api.ts               # punto único de acceso (mock hoy)
│   │   ├── seed.ts              # catálogo de destinos/actividades + viajes de ejemplo
│   │   ├── format.ts            # helpers de fecha/moneda/ids
│   │   └── categories.ts        # metadatos de categorías (label, color)
│   ├── hooks/                   # useAuth, useQuery, useStore
│   ├── components/              # UI reutilizable (modales, cards, paneles…)
│   └── pages/                   # Login, Mis viajes, Detalle del viaje
└── ...
```

## Notas

- La UI está 100% en español.
- Las imágenes usan URLs de `picsum.photos` con fallback local (gradiente + icono), por lo que
  la app se ve bien incluso sin internet.
- No se realiza ningún commit ni push; todo el trabajo queda en este directorio.
