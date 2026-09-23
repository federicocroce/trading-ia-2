import { api } from "./api";
import { invalidatePlan } from "./plan";
import { crearSeguidor } from "./seguimiento";

/**
 * El seguidor de la app: uno solo para todas las pantallas. Cuando el análisis de un alta termina, el plan ya se
 * rearmó en el servidor: se invalida el plan compartido y se avisa con "watchlist:refreshed" para que la barra, el
 * Radar y la ficha vuelvan a pedir lo suyo. No es "watchlist:changed": ese lo dispara quien agrega o saca un ticker.
 */
export const seguirRefresco = crearSeguidor({
  pedir: () => api.radar.watchlist().catch(() => null),
  despues: (fn, ms) => { setTimeout(fn, ms); },
  avisar: () => { invalidatePlan(); window.dispatchEvent(new Event("watchlist:refreshed")); },
});
