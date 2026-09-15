/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Puerto de la API, para los precios en vivo que van directo y no por el proxy (vite.config.ts, 15/9). */
  readonly VITE_API_PORT?: string;
}
