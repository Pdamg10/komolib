# 📚 KomoLib — Librería Universal Personalizable (App PC + APK Android + Sync Server)

**KomoLib** es una librería y lector multi-formato diseñado con estética cálida de papelería/crema, totalmente personalizable y compatible con **App de Escritorio (PC)**, **APK Android (Capacitor)**, **Google Drive personal** y **servidor propio Node.js** para salas compartidas y sincronización.

## Formatos Soportados
- **eBooks y Documentos:** `EPUB`, `PDF` (con selección y subrayado de texto + modo pines), `MOBI`, `AZW` / `AZW3` / `PRC`, `FB2`, `DOCX`, `TXT`, `Markdown (.md)`, `HTML`
- **Mangas, Manhwas y Cómics:** `CBZ` / `ZIP`, `CBR` / `RAR` (WASM offline), `PDF` y carpetas/selecciones múltiples de imágenes (`JPG`, `PNG`, `WEBP`, `AVIF`)
- **Audiolibros:** `MP3`, `M4B`, `M4A`, `OGG`, `WAV`

## Modos de Lectura
- **Manhwa / Webtoon:** Tira vertical continua sin bordes (espaciado ajustable desde `0px`)
- **Manga (RTL):** Lectura japonesa de derecha a izquierda (1 página o doble página)
- **Cómic (LTR):** Lectura occidental de izquierda a derecha (1 o 2 páginas)
- **Libros y PDF:** 5 temas de lectura (`Cream`, `Paper`, `Sepia`, `Dark`, `OLED`), tipografía, interlineado, ancho de columna, brillo, filtro de luz cálida nocturna, separadores visuales persistentes y herramientas completas de subrayado/anotación.

## Arquitectura

| Pieza | Carpeta | Destino |
| --- | --- | --- |
| Cliente (React + Vite) | `src/` | **App PC** + **APK Android** (`android/`) |
| API de sync, OAuth Drive y salas | `server/` | **Render / Railway / Fly.io / VPS** (Node.js) |

## Comandos Rápidos

### 1. Ejecutar en Desarrollo
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
Configura las variables del servidor en `server/.env` o en el panel de Render (ver `.env.example`).

- **PC ↔ APK sincronizados:** libros, progreso, portadas, separadores, anotaciones y tema sincronizados por Google Drive o servidor propio.
- **Salas de Lectura Compartida (Buddy Read):** crea una sala para cualquier libro (`KOMO-XXXX`), lee viendo el progreso mutuo en vivo y deja notas protegidas contra spoilers.
- **Estanterías compartidas:** comparte varios libros o tu biblioteca con un código `SHELF-XXXX` y su QR.

### 3. Compilar el APK Android
```bash
npm run cap:sync
JAVA_HOME=/home/phame/.jdks/jdk-17.0.20.1+1 ./android/gradlew -p android assembleDebug
```
El APK generado se guarda en:
`android/app/build/outputs/apk/debug/Komolib.apk`

---

## ☁️ Desplegar el API de Sincronización en Render

El servidor está en `server/` y se despliega como Web Service en **Render**:

1. **New → Web Service** → conecta el repo.
2. **Root Directory:** `server`
3. **Build Command:** `npm install`
4. **Start Command:** `npm start`
5. **Environment:** Node 22.
6. Añade las variables:
   - `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` (para sincronización con Google Drive)
   - `GEMINI_API_KEY` (opcional, para funciones de IA)
   - `GEMINI_MODEL` (por defecto `gemini-2.5-flash`)
   - `KOMOLIB_TOKEN` (opcional, protege sincronización sin Drive)
   - `PUBLIC_URL=https://<dominio-del-api>`
   - `KOMOLIB_STORAGE_DIR=/var/data` (si montas un disco persistente)

> En planes gratuitos de Render el servicio duerme tras inactividad y tarda unos segundos en despertar en la primera petición. CORS está abierto (`origin: true`), por lo que la app PC y el APK Android pueden conectarse sin configuración extra.

### Seguridad
- No subas `.env` ni `server/storage/` a Git (ya están en `.gitignore`).

---

## Estructura del Proyecto

```text
komolib/
├── src/                 # Cliente React (componentes, contexto, lectores, servicios)
├── server/              # API Express (OAuth Google Drive, sync, salas, estanterías, IA)
├── android/             # Proyecto Capacitor Android (APK)
├── .env.example         # Variables de entorno documentadas
└── vite.config.ts
```
