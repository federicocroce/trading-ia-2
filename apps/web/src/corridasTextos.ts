/**
 * Textos del botón y del panel de Corridas. Puros, para poder probarlos sin dibujar nada. Horas en hora de Argentina.
 */
export function fechaHoraAR(iso: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p["day"]}/${p["month"]} ${p["hour"]}:${p["minute"]}`;
}

/**
 * Hora de la última corrida buena de un paso. Con `job_runs` viejo hasta el 15/9, cinco de seis pasos tomaban la fecha
 * de la base y mostraban "—", que se lee como "no corrió". La base tiene la fecha pero no la hora (salvo el plan, que
 * guarda cuándo se armó): se dice así.
 */
export function horaDelPaso(s: { ranAt: string | null; ranAtSource?: "registro" | "base" | null; lastDate: string | null }): string {
  if (s.ranAt) return s.ranAtSource === "base" ? `${fechaHoraAR(s.ranAt)} (según la base)` : fechaHoraAR(s.ranAt);
  if (s.lastDate) return "según la base, hora desconocida";
  return "nunca corrió";
}

/**
 * Texto del botón del encabezado. Decía "última corrida 15/09 10:24" con la hora de la tesis, como si fuera la de todo
 * el pipeline (15/9). Ahora cuenta cuántos pasos están al día y la hora conocida más nueva va con el nombre de su paso.
 */
export function textoDelBoton(st: { running: boolean; current: string | null; lastRunAt: string | null; lastRunStep?: string | null; steps: Array<{ id: string; label: string; due: boolean }> }): string {
  if (st.running) return `corriendo ${st.current ? st.steps.find((s) => s.id === st.current)?.label ?? st.current : ""}…`;
  const alDia = st.steps.filter((s) => !s.due).length;
  const ultimo = st.lastRunStep ? st.steps.find((s) => s.id === st.lastRunStep) : null;
  return `${alDia} de ${st.steps.length} pasos al día${ultimo && st.lastRunAt ? ` · ${ultimo.label} ${fechaHoraAR(st.lastRunAt)}` : ""}`;
}
