/** Cada cuánto refrescar precios: 1 min en horario de mercado US (lun–vie 9:30–16:00 ET), 5 min fuera. Portado de v1. */
export function marketRefreshMs(now = new Date()): number {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  const open = day >= 1 && day <= 5 && mins >= 9 * 60 + 30 && mins < 16 * 60;
  return open ? 60_000 : 5 * 60_000;
}
