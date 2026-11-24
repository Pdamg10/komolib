function trimUrl(value: string | undefined): string {
  let url = (value || '').trim();
  if (
    (url.startsWith('"') && url.endsWith('"')) ||
    (url.startsWith("'") && url.endsWith("'"))
  ) {
    url = url.slice(1, -1).trim();
  }
  return url.replace(/\/+$/, '');
}

/**
 * Normalizes a KomoLib API base URL: trims whitespace/quotes, strips accidental
 * trailing `/api` segments, and removes trailing slashes.
 */
export function normalizeServerUrl(value: string | undefined): string {
  return trimUrl(value)
    .replace(/\/api\/?$/i, '')
    .replace(/\/+$/, '');
}

const OFFICIAL_SYNC_SERVER_URL = 'https://komolib-api.komolib.workers.dev';

/**
 * URL pública del servidor de sincronización / salas compartidas.
 * Usa `VITE_SYNC_SERVER_URL` si está definida; en builds de producción (PC / APK Android)
 * usa automáticamente el servidor oficial de KomoLib para nunca caer en `http://localhost` del WebView.
 */
export const SYNC_SERVER_URL =
  normalizeServerUrl(import.meta.env.VITE_SYNC_SERVER_URL) ||
  (import.meta.env.PROD ? OFFICIAL_SYNC_SERVER_URL : '');

/**
 * URL pública opcional para enlaces y QR de invitación.
 */
export const PUBLIC_APP_URL = trimUrl(import.meta.env.VITE_PUBLIC_APP_URL);
