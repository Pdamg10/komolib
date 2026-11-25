# 📚 KomoLib — Librería Universal Multi-Formato (App PC Electron + APK Android + Cloudflare Cloud API)

**KomoLib** es una librería digital y lector multi-formato *local-first* diseñado con estética cálida de papelería/crema, altamente personalizable y pensado para funcionar 100% offline con sincronización transparente entre **App de Escritorio PC (Electron para Linux y Windows)** y **APK Android (Capacitor)**, respaldado por **Google Drive personal**, un **API serverless en Cloudflare Workers + D1** (0 ms de arranque en frío) y un **servidor Node.js/Express opcional** para uso en red local (LAN) o VPS propio.

---

## ✨ Características Principales

### 📖 Formatos Soportados (13 formatos / 5 tipos de contenido)
- **eBooks y Documentos:** `EPUB`, `PDF` (con selección y subrayado de texto + modo pines), `MOBI`, `AZW` / `AZW3` / `PRC`, `FB2`, `DOCX`, `TXT`, `Markdown (.md)`, `HTML`
- **Mangas, Manhwas y Cómics:** `CBZ` / `ZIP`, `CBR` / `RAR` (extracción WASM 100% offline con `node-unrar-js`), `PDF` y carpetas/selecciones de imágenes (`JPG`, `PNG`, `WEBP`, `AVIF`)
- **Audiolibros:** `MP3`, `M4B`, `M4A`, `OGG`, `WAV` con reproductor integrado (`AudioPlayerBar`)

### 🖥️ Lector Auto-Adaptativo y Papelería Personalizable
- **Diseño auto-adaptativo por dispositivo:** detecta automáticamente `phone` (≤ 640 px), `tablet` (641–1024 px) y `desktop` (> 1024 px) para ajustar barras, controles y cajones sin solapamientos al redimensionar o rotar.
- **Modos de lectura de cómic/manga:**
  - **Manhwa / Webtoon:** tira vertical continua sin bordes (espaciado ajustable desde `0px`)
  - **Manga (RTL):** lectura japonesa de derecha a izquierda (1 página o doble página)
  - **Cómic (LTR):** lectura occidental de izquierda a derecha (1 o 2 páginas)
- **Libros y PDF:** 5 temas de lectura (`Cream`, `Paper`, `Sepia`, `Dark`, `OLED`), tipografía, interlineado, ancho de columna, brillo, filtro de luz cálida nocturna, vista continua o paginada, inicio instantáneo sin parpadeo de tema (`localStorage` pre-mount) y separadores visuales persistentes.
- **6 herramientas de anotación y papelería:** resaltador, lápiz, pluma, post-it, stickers y emojis (con paleta/kit personalizable y cuaderno de notas).
- **Organización y seguimiento:** estantería 3D/cuadrícula/lista, categorías, colecciones, series, favoritos, lista de deseos, diario de lectura, estadísticas y metas mensuales/anuales.

### 📦 Importación Masiva y Migración desde Otras Apps
- **Carpetas locales y Android SAF sin duplicar espacio:** en Android importa bibliotecas enteras (1,600+ libros) mediante el puente nativo SAF (`ACTION_OPEN_DOCUMENT_TREE`) leyendo archivos bajo demanda desde `content://` sin duplicar gigabytes en IndexedDB.
- **Importador universal de copias de seguridad (`externalBackupParser.ts`):** migra libros, progreso, portadas, marcadores y subrayados desde:
  - **KomoLib (`.json`)**
  - **Moon+ Reader** (`.mrpro` incluso > 2 GB en Android, `.po`, `.mrexpt`, `mrbooks.db` SQLite)
  - **ReadEra**
  - **Tachiyomi / Mihon / Aniyomi** y **Kotatsu**
  - **KOReader** (`.lua` / JSON)
  - **Goodreads**, **The StoryGraph** y **Calibre** (CSV)
  - **Kindle** (`My Clippings.txt`)

### ☁️ Sincronización, Salas Compartidas e IA
- **Google Drive personal (`Komolib/Libros`):** sincroniza libros, progreso, portadas, separadores, anotaciones, tema y ajustes de lectura (`readerSettingsUpdatedAt` LWW + tombstones) entre PC y Android, con tokens de refresco persistidos por correo en D1 para que tus dispositivos secundarios no pierdan sesión.
- **Salas de Lectura Compartida — Buddy Read (`KOMO-XXXX`):** lee el mismo libro con amigos viendo el progreso mutuo en vivo, comparte marcas opcionales, modera participantes y deja comentarios protegidos contra spoilers (bloqueados hasta alcanzar el % del comentario).
- **Estanterías Mutuas (`SHELF-XXXX`):** comparte colecciones o libros con código y QR en tiempo real.
- **Perfil sincronizado en vivo:** cambiar nombre o avatar se propaga al instante por todas las salas y estanterías activas (`PATCH /api/shared/profile`).
- **Persistencia local con auto-restauración:** salas y estanterías cacheadas en IndexedDB con diferenciación entre eliminación explícita (`410 Gone`) y restauración automática (`PUT .../restore`).
- **Asistente IA (Gemini):** chat contextual sobre tu biblioteca e identificación asistida de libros (`/api/ai/chat`, `/api/ai/identify-book`).

---

## 🏗️ Arquitectura

| Pieza | Carpeta | Stack | Destino |
| --- | --- | --- | --- |
| **Cliente SPA** | `src/` | React 19, TypeScript 5.8, Vite 6, IndexedDB (`idb`), `epubjs`, `pdfjs-dist`, `jszip`, `node-unrar-js`, `sql.js` | Empaquetado en App PC y APK Android |
| **App de Escritorio PC** | `electron/` | Electron 45, `electron-builder` 26, servidor local `127.0.0.1:41735`, puente OAuth, Wayland/GPU | **Linux (`AppImage`)** y **Windows (`NSIS`)** |
| **App Móvil Android** | `android/` | Capacitor 7 (`com.komolib.reader`), puente nativo `KomoAndroid` (SAF / MediaStore / OAuth) | **APK Android (`Komolib.apk`)** |
| **Cloud API Principal** | `cloudflare/` | Cloudflare Workers + D1 SQLite (Wrangler 4), almacenamiento en bloques de 512 KB | **Cloudflare Workers** (`0 ms` cold start) |
| **Servidor LAN / Self-Hosted** | `server/` | Node.js 22, Express 5, Multer 2, SSE, buzón LAN `/upload` y `/send` | **Red local (LAN) / VPS / Render / Railway** |

---

## 🚀 Comandos Rápidos

### 1. Desarrollo Web (Vite)
```bash
npm install
npm run dev
# http://localhost:5173
```

### 2. App de Escritorio PC (Electron)
```bash
# Compilar frontend y abrir la app de escritorio
npm run desktop

# Abrir Electron usando el dist/ ya compilado
npm run desktop:run

# Empaquetar instaladores en release/
npm run desktop:build:linux   # release/Komolib-<version>.AppImage
npm run desktop:build:win     # Instalador Windows NSIS
```
> La app de escritorio fija `userData` en `appData/komolib`, mantiene el origen estable en `http://127.0.0.1:41735` para preservar IndexedDB/localStorage entre reinicios, activa aceleración GPU/Wayland, cachea assets en RAM y usa `/oauth-bridge` para conectar Google Drive desde el navegador del sistema.

### 3. Compilar el APK Android (Capacitor)
```bash
npm run cap:sync
JAVA_HOME=/home/phame/.jdks/jdk-17.0.20.1+1 ./android/gradlew -p android assembleDebug
```
El APK generado se guarda en:
`android/app/build/outputs/apk/debug/Komolib.apk`

> También existe CI automático en `.github/workflows/build-apk.yml` que compila y publica el artefacto `Komolib-apk` en cada push a `main`.

### 4. Validación de TypeScript, Build y Memoria AIEF
```bash
npm run build           # tsc -b && vite build
npm run aief:doctor     # Diagnóstico AIEF L3
npm run aief:validate   # Verifica referencias de memoria en context/ y AGENTS.md
```

---

## ☁️ Despliegue del Backend

### Opción A (Recomendada): Cloudflare Workers + D1 (Gratis, 0 ms de arranque en frío)
Es el backend oficial en producción (`https://komolib-api.komolib.workers.dev`). Ver guía detallada en [`cloudflare/README.md`](cloudflare/README.md):

```bash
cd cloudflare
npm install
npx wrangler login
npm run db:create        # Copia el database_id generado en cloudflare/wrangler.toml
npm run db:init          # Crea las tablas SQLite en D1 (schema.sql)

npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GEMINI_API_KEY   # Opcional (Asistente IA)

npm run deploy
```
En Google Cloud Console → **URIs de redireccionamiento autorizados**, agrega:
`https://komolib-api.<tu-subdominio>.workers.dev/api/google/callback`

### Opción B: Servidor Propio Node.js / LAN / VPS (`server/`)
Ideal para sincronización en red local (incluye portal web `/upload` y `/send` para enviar libros desde el móvil/PC) o despliegue en VPS / Render / Railway:

```bash
cd server
npm install
npm start
# Escucha en http://0.0.0.0:4123
```
Configura las variables en `server/.env` o en tu proveedor (consulta `.env.example`):
- `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` (OAuth Google Drive)
- `GEMINI_API_KEY` y `GEMINI_MODEL` (opcional, por defecto `gemini-2.5-flash`)
- `KOMOLIB_TOKEN` (opcional, protege sincronización personal sin bloquear invitados a `KOMO-XXXX` / `SHELF-XXXX`)
- `PUBLIC_URL` y `KOMOLIB_STORAGE_DIR` (carpeta/volumen persistente para libros y datos)

### Variables del Cliente (`.env` en raíz)
- `VITE_SYNC_SERVER_URL`: URL del API (inyectada en tiempo de compilación; en producción usa por defecto `https://komolib-api.komolib.workers.dev`).
- `VITE_PUBLIC_APP_URL`: URL pública opcional para enlaces y QR de invitación.

### Seguridad
- Nunca subas `.env`, `server/storage/` ni `release/` a Git (ya están excluidos en `.gitignore`).

---

## 📁 Estructura del Proyecto

```text
komolib/
├── src/                  # Cliente React + TypeScript (lectores, parsers, contexto, servicios, IndexedDB)
├── electron/             # App de Escritorio PC (main.cjs, preload.cjs, icon.png)
├── android/              # Proyecto Capacitor Android + puente nativo KomoAndroid (APK)
├── cloudflare/           # Cloud API principal en Cloudflare Workers + D1 (src/index.js, schema.sql)
├── server/               # API Node.js/Express opcional para LAN / VPS / self-hosted
├── public/               # Manifiesto PWA, iconos y separadores visuales integrados
├── context/              # Base de conocimiento y memoria AIEF L3 (arquitectura, dominio, lecciones)
├── workflow/             # Flujos de ingeniería AIEF (proposal → design → implement → review)
├── docs/standards/       # Estándares y patrones AIEF L3
├── scripts/              # Utilidades AIEF (aief.mjs)
├── .github/workflows/    # CI de compilación Web + APK Android (build-apk.yml)
├── AGENTS.md             # Guía principal y reglas de ingeniería IA
├── .env.example          # Plantilla de variables de entorno
└── vite.config.ts        # Configuración Vite (base './', chunks, exclusión WASM node-unrar-js)
```
