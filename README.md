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

### 2. Iniciar el Servidor de Sincronización (Node.js)
```bash
npm run dev:server
```
El servidor escucha en `http://0.0.0.0:4123` (puedes protegerlo definiendo `KOMOLIB_TOKEN=tu_clave`).  
Desde la app (Web o APK), entra en **Panel Derecho → Notas → Servidor de Sincronización**, ingresa la IP local de tu PC (ej. `http://192.168.1.50:4123`) y pulsa **Sincronizar ahora**.

### 3. Compilar el APK Android
```bash
npm run cap:sync
cd android
JAVA_HOME=/home/phame/.jdks/jdk-17.0.20.1+1 ./gradlew assembleDebug
```
El APK generado se guarda en:
`android/app/build/outputs/apk/debug/app-debug.apk`
