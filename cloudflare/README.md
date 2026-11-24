# KomoLib Cloud API — Cloudflare Workers + D1 (100% Gratis, Sin Dormir, Sin Tarjeta)

Este backend reemplaza a Render Free usando **Cloudflare Workers + D1**:
- **0 ms de arranque en frío** (nunca duerme ni se suspende como Render Free).
- **100,000 peticiones/día + 5 GB de base de datos SQLite (D1) gratis** sin tarjeta de crédito.
- Guarda tus **tokens de Google Drive por correo** en D1 (tus dispositivos secundarios jamás pierden sesión ni piden reconfirmar).
- Soporta **Salas Compartidas (`KOMO-XXXX`)**, **Estanterías Mutuas (`SHELF-XXXX`)**, transferencia de libros compartidos (en bloques de 512 KB en D1) y **Asistente IA Gemini**.

## Despliegue en 5 pasos (2 minutos)

```bash
cd cloudflare
npm install

# 1. Inicia sesión en tu cuenta gratuita de Cloudflare
npx wrangler login

# 2. Crea la base de datos D1 (copia el `database_id` que imprime y pégalo en wrangler.toml)
npm run db:create

# 3. Crea las tablas en D1
npm run db:init

# 4. Configura tus secretos (los mismos de Google Cloud OAuth y opcionalmente Gemini)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GEMINI_API_KEY

# 5. Despliega el Worker
npm run deploy
```

Al final te mostrará tu URL fija, por ejemplo:
`https://komolib-api.<tu-subdominio>.workers.dev`

## Último paso en Google Cloud Console
En tus credenciales OAuth 2.0 → **URIs de redireccionamiento autorizados**, añade:
`https://komolib-api.<tu-subdominio>.workers.dev/api/google/callback`
