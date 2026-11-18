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

## Comandos Rápidos

### 1. Ejecutar en Web (Desarrollo)
```bash
npm run dev
```

### 2. Iniciar el Servidor de Sincronización y Salas Compartidas (Node.js)
```bash
# Modo Wi-Fi local (escucha en http://0.0.0.0:4123)
npm run dev:server

# Modo Internet automático (abre además un túnel HTTPS con Cloudflare Quick Tunnel)
npm run dev:tunnel
```
- **Web ↔ APK en vivo:** En la app entra en **Lectura Compartida y Sync → Red, Túnel y APK**. Puedes emparejar tu APK Android copiando/pegando el enlace de emparejamiento o escaneando el QR privado. Los cambios de progreso, libros, notas, marcadores, tema y sesión activa (*"Continuar desde Web PC / APK Android"*) se sincronizan automáticamente en tiempo real (SSE).
- **Salas de Lectura Compartida (Buddy Read):** Crea una sala para cualquier libro (genera código `KOMO-XXXX`, enlace y QR), lee viendo el progreso mutuo en vivo y deja notas protegidas contra spoilers hasta que el otro lector alcance tu porcentaje.
- **Internet / Túnel / VPS:**
  - Con `cloudflared` disponible, pulsa **Activar túnel** desde la UI o arranca con `npm run dev:tunnel`.
  - O usa tu propio túnel/VPS (`ngrok`, Tailscale Funnel, Cloudflare Tunnel nombrado o Nginx/Caddy) configurando `PUBLIC_URL=https://tu-dominio` en `.env` (o en la UI).
  - Recomendado para Internet: define `KOMOLIB_TOKEN=tu_clave` en `.env` para proteger tu biblioteca personal; los invitados de salas compartidas seguirán pudiendo entrar solo a su sala usando el código `KOMO-XXXX`.

### 3. Compilar el APK Android
```bash
npm run cap:sync
cd android
JAVA_HOME=/home/phame/.jdks/jdk-17.0.20.1+1 ./gradlew assembleDebug
```
El APK generado se guarda en:
`android/app/build/outputs/apk/debug/app-debug.apk`
