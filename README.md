# 📚 KomoLib — Librería Universal Personalizable (Web + APK Android + Sync Server)

**KomoLib** es una librería y lector multi-formato diseñado con estética cálida de papelería/crema, totalmente personalizable y compatible con **Web (PWA)**, **APK Android (Capacitor)** y **sincronización en servidor propio Node.js**.

## Formatos Soportados
- **eBooks y Documentos:** `EPUB`, `PDF`, `MOBI`, `AZW` / `AZW3` / `PRC`, `FB2`, `DOCX`, `TXT`, `Markdown (.md)`, `HTML`
- **Mangas, Manhwas y Cómics:** `CBZ` / `ZIP`, `CBR` / `RAR` (WASM offline), `PDF` y carpetas/selecciones múltiples de imágenes (`JPG`, `PNG`, `WEBP`, `AVIF`)
- **Audiolibros:** `MP3`, `M4B`, `M4A`, `OGG`, `WAV`

## Modos de Lectura
- **Manhwa / Webtoon:** Tira vertical continua sin bordes (espaciado ajustable desde `0px`)
- **Manga (RTL):** Lectura japonesa de derecha a izquierda (1 página o doble página)
- **Cómic (LTR):** Lectura occidental de izquierda a derecha (1 o 2 páginas)
- **Libros:** 5 temas de lectura (`Cream`, `Paper`, `Sepia`, `Dark`, `OLED`), tipografía, interlineado, ancho de columna, brillo y filtro de luz cálida nocturna

## Arquitectura

KomoLib tiene dos piezas independientes:

| Pieza | Carpeta | Se despliega en |
| --- | --- | --- |
| Frontend (React + Vite) | raíz del repo | **Netlify** (sitio estático) |
| API de sync y salas | `server/` | **Render / Railway / Fly.io / VPS** (Node.js + disco persistente) |

> **Importante:** Netlify solo publica el frontend. El servidor Express **no puede ejecutarse en Netlify** porque necesita un proceso Node permanente, disco para los libros y conexiones SSE en tiempo real. Sin un API desplegado, la web funciona como lector local, pero los códigos QR, las salas `KOMO-XXXX` y la sincronización Web ↔ APK no funcionarán.

## Comandos Rápidos

### 1. Ejecutar en Web (Desarrollo)
```bash
npm install
npm run dev
```

### 2. Iniciar el Servidor de Sincronización y Salas Compartidas (Node.js)
```bash
cd server
npm install
npm start
# Escucha en http://0.0.0.0:4123
```
Configura las variables del servidor en `server/.env` o en el panel de tu hosting (ver `.env.example`).

- **Web ↔ APK en vivo:** los cambios de progreso, libros, notas, marcadores, tema y sesión activa (*"Continuar desde Web PC / APK Android"*) se sincronizan en tiempo real (SSE) contra el API.
- **Salas de Lectura Compartida (Buddy Read):** crea una sala para cualquier libro (genera código `KOMO-XXXX`, enlace y QR), lee viendo el progreso mutuo en vivo y deja notas protegidas contra spoilers hasta que el otro lector alcance tu porcentaje.
- **Estanterías compartidas:** comparte una selección de libros con un código `SHELF-XXXX` y su QR.
- El enlace/QR de invitación abre la **app web** (Netlify) y añade `&server=<url-del-api>` para que el invitado se conecte aunque su build no tenga configurada la variable de entorno.

### 3. Compilar el APK Android
```bash
npm run cap:sync
cd android
JAVA_HOME=/home/phame/.jdks/jdk-17.0.20.1+1 ./gradlew assembleDebug
```
El APK generado se guarda en:
`android/app/build/outputs/apk/debug/app-debug.apk`

---

## 🚀 Desplegar el Frontend en Netlify

El repo ya incluye `netlify.toml` con la configuración necesaria:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "22"
```

Pasos:

1. Entra en [netlify.com](https://www.netlify.com) → **Add new site → Import an existing project**.
2. Conecta el repositorio de KomoLib.
3. Netlify detecta `netlify.toml`; si no, usa:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
4. En **Site configuration → Environment variables**, añade:

   | Variable | Obligatoria | Valor |
   | --- | --- | --- |
   | `VITE_SYNC_SERVER_URL` | ✅ Sí | URL pública del API, p. ej. `https://komolib-api.onrender.com` |
   | `VITE_PUBLIC_APP_URL` | Opcional | URL del sitio en Netlify, p. ej. `https://komolib.netlify.app` |

5. Pulsa **Deploy site**.

> Las variables `VITE_*` se insertan en el bundle **en tiempo de build**. Si cambias `VITE_SYNC_SERVER_URL`, vuelve a desplegar (`Deploys → Trigger deploy → Clear cache and deploy site`).

**¿Qué variable debo agregar?** Como mínimo:

```text
VITE_SYNC_SERVER_URL=https://<dominio-de-tu-api>
```

`VITE_PUBLIC_APP_URL` solo es necesaria si generas enlaces/QR desde el APK y quieres que apunten a tu dominio de Netlify.

---

## ☁️ Desplegar el API de Sincronización

El servidor está en `server/` y se despliega aparte. Ejemplo con **Render**:

1. **New → Web Service** → conecta el repo.
2. **Root Directory:** `server`
3. **Build Command:** `npm install`
4. **Start Command:** `npm start`
5. **Environment:** Node 22.
6. Añade las variables:
   - `GEMINI_API_KEY` (opcional, para funciones de IA)
   - `GEMINI_MODEL` (por defecto `gemini-2.5-flash`)
   - `KOMOLIB_TOKEN` (recomendado si el API es público)
   - `PUBLIC_URL=https://<dominio-del-api>`
   - `KOMOLIB_STORAGE_DIR=/var/data` (si montas un disco persistente)
7. Monta un **disco persistente** en `/var/data` y asígnalo a `KOMOLIB_STORAGE_DIR`. Sin disco, los libros subidos se pierden al reiniciar o redeployar.
8. Copia la URL pública del servicio (p. ej. `https://komolib-api.onrender.com`) y úsala como `VITE_SYNC_SERVER_URL` en Netlify.

> En planes gratuitos el servicio puede “dormir” y tardar unos segundos en la primera petición. CORS está abierto (`origin: true`), por lo que el dominio de Netlify y el APK pueden conectarse sin configuración extra.

### Seguridad

- Define `KOMOLIB_TOKEN` para proteger tu biblioteca personal y las subidas.
- Los invitados pueden entrar a una sala o estantería concreta usando su código `KOMO-XXXX` / `SHELF-XXXX` sin conocer tu token.
- No subas `.env` ni `server/storage/` a Git (ya están en `.gitignore`).

---

## Estructura del Proyecto

```text
komolib/
├── src/                 # Frontend React (componentes, contexto, servicios)
├── server/              # API Express (sync, salas, estanterías, archivos)
├── android/             # Proyecto Capacitor Android
├── netlify.toml         # Build + redirects SPA para Netlify
├── .env.example         # Variables de entorno documentadas
└── vite.config.ts
```
