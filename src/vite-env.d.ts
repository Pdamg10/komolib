/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SYNC_SERVER_URL?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'sql.js';
