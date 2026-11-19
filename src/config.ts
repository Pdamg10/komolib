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
 * URL pública del servidor de sincronización / salas compartidas.
 * En Netlify debe configurarse como variable de entorno `VITE_SYNC_SERVER_URL`
 * (por ejemplo https://komolib-api.onrender.com).
 */
export const SYNC_SERVER_URL = trimUrl(import.meta.env.VITE_SYNC_SERVER_URL);

/**
 * URL pública de la app web, usada en los enlaces y QR de invitación.
 * Si no se define, se usa el origen actual cuando la app se abre en un navegador.
 * Es útil para el APK Android, donde el origen local no es accesible para invitados.
 */
export const PUBLIC_APP_URL = trimUrl(import.meta.env.VITE_PUBLIC_APP_URL);
