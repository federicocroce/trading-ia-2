import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type UsageCallRow, type UsageDay, type UsageSummary } from "./api";
import { coberturaTexto, corteDelDia, cuotaDiaria, horaAR } from "./usoTextos";

/**
 * Pestaña Uso: cuánto se le pide a cada fuente externa (Gemini, Finnhub, Alpaca, SEC, Yahoo), contra sus límites,
 * por día, por paso y llamada por llamada. Todo sale del registro `external_calls` (una fila por pedido saliente).
 */
const SOURCES = ["gemini", "finnhub", "alpaca", "sec", "yahoo", "otro"] as const;
/** Paleta categórica en orden fijo (slots 1–6, validada en claro y oscuro con el validador de dataviz). */
const LIGHT: Record<string, string> = { gemini: "#2a78d6", finnhub: "#eb6834", alpaca: "#1baf7a", sec: "#eda100", yahoo: "#e87ba4", otro: "#008300" };
const DARK: Record<string, string> = { gemini: "#3987e5", finnhub: "#d95926", alpaca: "#199e70", sec: "#c98500", yahoo: "#d55181", otro: "#008300" };
const RESULTS = ["ok", "rpm", "rpd", "limite", "saturado", "validacion", "error"] as const;
const RESULT_LABEL: Record<string, string> = { ok: "ok", rpm: "429 por minuto", rpd: "429 por día", limite: "429 sin detalle", saturado: "503 saturado", validacion: "no validó", error: "error" };

const n = (v: number) => v.toLocaleString("es-AR");
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);
const usd = (v: number) => `USD ${v.toFixed(3)}`;
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const hhmm = (iso: string) => horaAR(iso, true);

function useDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

/** Barras apiladas por día y fuente: marcas finas, hueco de 2px entre segmentos, tooltip al pasar, leyenda siempre. */
function DailyChart({ days, colors, selected, onPick }: { days: UsageDay[]; colors: Record<string, string>; selected: string; onPick: (date: string) => void }) {
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null);
  const W = 720, H = 180, PAD = { l: 40, r: 8, t: 8, b: 24 };
  const max = Math.max(1, ...days.map((d) => d.calls));
  const iw = (W - PAD.l - PAD.r) / Math.max(1, days.length);
  const bw = Math.max(4, Math.min(28, iw * 0.7));
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Llamadas por día y por fuente">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="var(--muted)">{n(t)}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = PAD.l + i * iw + (iw - bw) / 2;
          // Día anterior al registro (10 al 13/9): no es cero, no hay datos. Se marca con un contorno punteado.
          if (d.coverage === "sin_registro") {
            return (
              <g key={d.date} onMouseEnter={() => setHover({ i, x: x + bw / 2 })} onMouseLeave={() => setHover(null)}>
                <rect x={x} y={PAD.t} width={bw} height={H - PAD.t - PAD.b} fill="none" stroke="var(--line)" strokeDasharray="3 3" rx={2} />
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--muted)">{d.date.slice(5)}</text>
              </g>
            );
          }
          let acc = 0;
          const segs = SOURCES.filter((s) => (d.bySource[s] ?? 0) > 0).map((s) => {
            const v = d.bySource[s] ?? 0;
            const y1 = y(acc + v), y0 = y(acc);
            acc += v;
            return <rect key={s} x={x} y={y1} width={bw} height={Math.max(0, y0 - y1 - 2)} fill={colors[s]} rx={2} />;
          });
          const label = d.date.slice(5);
          return (
            <g key={d.date} onMouseEnter={() => setHover({ i, x: x + bw / 2 })} onMouseLeave={() => setHover(null)} onClick={() => onPick(d.date)} style={{ cursor: "pointer" }}>
              <rect x={PAD.l + i * iw} y={PAD.t} width={iw} height={H - PAD.t - PAD.b} fill="transparent" />
              {segs}
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill={d.date === selected ? "var(--fg)" : "var(--muted)"} fontWeight={d.date === selected ? 600 : 400}>{label}</text>
            </g>
          );
        })}
      </svg>
      {hover && days[hover.i] && (
        <div className="card" style={{ position: "absolute", left: `${(hover.x / W) * 100}%`, top: 0, transform: "translateX(-50%)", padding: "6px 10px", fontSize: 12, pointerEvents: "none", whiteSpace: "nowrap" }}>
          {days[hover.i]!.coverage === "sin_registro" ? <><b>{days[hover.i]!.date}</b> · sin registro: ese día no se registraban las llamadas</> : <>
            <b>{days[hover.i]!.date}</b> · {n(days[hover.i]!.calls)} llamadas · {n(days[hover.i]!.errors)} con error · {usd(days[hover.i]!.costUsd)}{days[hover.i]!.coverage === "parcial" && " · el registro empezó ese día"}
            {SOURCES.filter((s) => (days[hover.i]!.bySource[s] ?? 0) > 0).map((s) => <div key={s}><span style={{ color: colors[s] }}>●</span> {s} {n(days[hover.i]!.bySource[s] ?? 0)}</div>)}
          </>}
        </div>
      )}
      <div className="row" style={{ gap: 12, marginTop: 4, flexWrap: "wrap" }}>
        {SOURCES.map((s) => <span key={s} className="muted" style={{ fontSize: 12 }}><span style={{ color: colors[s] }}>●</span> {s}</span>)}
        {days.some((d) => d.coverage === "sin_registro") && <span className="muted" style={{ fontSize: 12 }}>· punteado: sin registro (no es cero)</span>}
        <span className="muted" style={{ fontSize: 12 }}>· click en un día para verlo abajo</span>
      </div>
    </div>
  );
}

export function Uso() {
  const dark = useDark();
  const colors = dark ? DARK : LIGHT;
  const [date, setDate] = useState(localToday());
  const [range, setRange] = useState<7 | 14 | 30>(14);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [days, setDays] = useState<UsageDay[]>([]);
  const [calls, setCalls] = useState<UsageCallRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<{ source: string; step: string; result: string; symbol: string }>({ source: "", step: "", result: "", symbol: "" });
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null);
    api.usage.summary(date).then(setSummary).catch((e) => setErr(String(e)));
    api.usage.daily(range).then(setDays).catch((e) => setErr(String(e)));
  }, [date, range]);
  useEffect(() => { load(); const id = window.setInterval(load, 60_000); return () => window.clearInterval(id); }, [load]);
  useEffect(() => {
    setCalls(null);
    api.usage.calls({ date, source: filter.source, step: filter.step, result: filter.result, symbol: filter.symbol, limit: 200 }).then((r) => { setCalls(r.calls); setTotal(r.total); }).catch((e) => setErr(String(e)));
  }, [date, filter]);

  const steps = useMemo(() => [...new Set(summary?.byStep.map((r) => r.step) ?? [])].sort(), [summary]);
  const closest = useMemo(() => {
    const rows = summary?.bySource.filter((r) => r.pctMinute !== null || r.pctDay !== null) ?? [];
    return rows.map((r) => ({ source: r.source, pct: Math.max(r.pctMinute ?? 0, r.pctDay ?? 0) })).sort((a, b) => b.pct - a.pct)[0] ?? null;
  }, [summary]);
  // Un día anterior al registro (10 al 13/9) no tuvo cero llamadas: no tiene datos (15/9).
  const sinRegistro = summary?.coverage?.state === "sin_registro";
  const cobertura = summary?.coverage ? coberturaTexto(summary.coverage.state, summary.coverage.from) : null;

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <b>Uso de fuentes externas</b>
            <div className="muted" style={{ fontSize: 12 }}>Una fila por pedido a Gemini, Finnhub, Alpaca, SEC o Yahoo, con su paso y resultado. Gemini: cuota por modelo y por clave (cada clave es un proyecto), 10 por minuto; la cuota diaria real no la publica Google (el 10/9 se agotó con 15 a 20 llamadas, y la búsqueda integrada con menos de 10), así que "agotada" sale de un 429 diario real sin ninguna respuesta buena después. {corteDelDia(summary?.quotaResetAt ?? null)} El costo es lo que valdría en el plan pago.</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <input type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value || localToday())} />
            <div className="seg">
              {([7, 14, 30] as const).map((r) => <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>{r} días</button>)}
            </div>
            <button className="ghost" onClick={load}>Actualizar</button>
          </div>
        </div>
        {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
        {summary && sinRegistro && <div className="warn" style={{ marginTop: 10 }}>{summary.date}: {cobertura}. Los ceros de abajo no son "no hubo llamadas": no hay datos.</div>}
        {summary && !sinRegistro && cobertura && <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>{summary.date}: {cobertura}.</div>}
        {summary && !sinRegistro && (
          <div className="kpis" style={{ marginTop: 10 }}>
            <div className="kpi"><b>{n(summary.total.calls)}</b><span>llamadas el {summary.date}</span></div>
            <div className="kpi"><b className={summary.total.errors ? "bad" : ""}>{n(summary.total.errors)}</b><span>con error</span></div>
            <div className="kpi"><b>{usd(summary.total.costUsd)}</b><span>costo equivalente (Gemini)</span></div>
            <div className="kpi"><b className={summary.gemini.failedPct !== null && summary.gemini.failedPct >= 20 ? "warn" : ""}>{pct(summary.gemini.failedPct)}</b><span>Gemini falló</span></div>
            <div className="kpi"><b className={closest && closest.pct >= 80 ? "warn" : ""}>{closest ? `${closest.source} ${pct(closest.pct)}` : "—"}</b><span>fuente más cerca de su límite</span></div>
          </div>
        )}
        {summary && summary.warnings.length > 0 && <div className="card bad" style={{ marginTop: 8 }}>{summary.warnings.map((w) => <div key={w}>⚠ {w}</div>)}</div>}
      </div>

      <div className="card">
        <b>Por día</b> <span className="muted">últimos {range} días, llamadas por fuente</span>
        <div style={{ marginTop: 8 }}>{days.length ? <DailyChart days={days} colors={colors} selected={date} onPick={setDate} /> : <div className="muted">sin datos</div>}</div>
      </div>

      {summary && (
        <div className="card">
          <b>Por fuente</b> <span className="muted">{summary.date}</span>
          {summary.bySource.length === 0 ? <div className="muted">{sinRegistro ? cobertura : "sin pedidos ese día"}</div> : (
            <table style={{ marginTop: 6 }}>
              <thead><tr><th>fuente</th><th>llamadas</th><th>con error</th><th>pico por minuto</th><th>límite por minuto</th><th title="Pico del minuto dividido por el límite por minuto.">% del límite por minuto</th></tr></thead>
              <tbody>
                {summary.bySource.map((r) => (
                  <tr key={r.source} style={{ cursor: "pointer" }} onClick={() => setFilter((f) => ({ ...f, source: f.source === r.source ? "" : r.source }))}>
                    <td><span style={{ color: colors[r.source] ?? "inherit" }}>●</span> <b>{r.source}</b></td>
                    <td className="mono">{n(r.calls)}</td>
                    <td className={r.errors ? "bad mono" : "mono"}>{n(r.errors)}</td>
                    <td className="mono">{n(r.peakPerMinute)}</td>
                    <td className="mono muted">{r.limitPerMinute ?? "—"}</td>
                    <td className={r.pctMinute !== null && r.pctMinute >= 80 ? "warn mono" : "mono"}>{pct(r.pctMinute)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {summary.gemini.rows.length > 0 && (
            <>
              <div style={{ marginTop: 12 }}><b>Gemini por modelo y clave</b> <span className="muted">tokens {n(summary.gemini.tokensIn)} entrada / {n(summary.gemini.tokensOut)} salida / {n(summary.gemini.tokensThink)} pensamiento · {usd(summary.gemini.costUsd)}</span></div>
              <div className="muted" style={{ fontSize: 12 }}>{corteDelDia(summary.quotaResetAt ?? null)}</div>
              <div style={{ overflowX: "auto" }}>
              <table style={{ marginTop: 6 }}>
                <thead><tr><th>modelo</th><th>clave</th><th>llamadas</th><th>ok</th><th>429 minuto</th><th>429 día</th><th title="429 sin decir qué límite: no es la cuota diaria (por ejemplo, búsqueda en un modelo que el plan gratis no tiene).">429 sin detalle</th><th>503</th><th>no validó</th><th>error</th><th>tokens entrada</th><th>salida + pensamiento</th><th>costo</th><th>cuota diaria</th></tr></thead>
                <tbody>
                  {summary.gemini.rows.map((g) => {
                    const cuota = cuotaDiaria(g);
                    return (
                      <tr key={`${g.model}#${g.keyIndex}`}>
                        <td className="mono">{g.model}</td>
                        <td className="mono">{g.keyIndex}</td>
                        <td className="mono">{n(g.calls)}</td>
                        <td className="mono ok">{n(g.ok)}</td>
                        <td className={g.rpm ? "warn mono" : "mono muted"}>{n(g.rpm)}</td>
                        <td className={g.rpd ? "bad mono" : "mono muted"}>{n(g.rpd)}</td>
                        <td className={g.limite ? "warn mono" : "mono muted"}>{n(g.limite ?? 0)}</td>
                        <td className={g.saturado ? "warn mono" : "mono muted"}>{n(g.saturado)}</td>
                        <td className={g.validacion ? "warn mono" : "mono muted"}>{n(g.validacion)}</td>
                        <td className={g.error ? "bad mono" : "mono muted"}>{n(g.error)}</td>
                        <td className="mono">{n(g.tokensIn)}</td>
                        <td className="mono">{n(g.tokensOut + g.tokensThink)}</td>
                        <td className="mono">{usd(g.costUsd)}</td>
                        <td className={cuota.tono}>{cuota.texto}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}
          {summary.byStep.length > 0 && (
            <>
              <div style={{ marginTop: 12 }}><b>Por paso</b> <span className="muted">click filtra la lista de abajo</span></div>
              <table style={{ marginTop: 6 }}>
                <thead><tr><th>paso</th><th>fuente</th><th>llamadas</th><th>con error</th><th>tiempo total</th></tr></thead>
                <tbody>
                  {summary.byStep.map((r) => (
                    <tr key={`${r.step}|${r.source}`} style={{ cursor: "pointer" }} onClick={() => setFilter({ source: r.source, step: r.step, result: "", symbol: "" })}>
                      <td><b>{r.step}</b></td>
                      <td><span style={{ color: colors[r.source] ?? "inherit" }}>●</span> {r.source}</td>
                      <td className="mono">{n(r.calls)}</td>
                      <td className={r.errors ? "bad mono" : "mono"}>{n(r.errors)}</td>
                      <td className="mono muted">{(r.ms / 1000).toFixed(1)} s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div><b>Llamadas</b> <span className="muted">{date} · {calls ? `${n(calls.length)} de ${n(total)}` : "…"}, las más recientes primero</span></div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <select value={filter.source} onChange={(e) => setFilter((f) => ({ ...f, source: e.target.value }))}><option value="">todas las fuentes</option>{SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <select value={filter.step} onChange={(e) => setFilter((f) => ({ ...f, step: e.target.value }))}><option value="">todos los pasos</option>{steps.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <select value={filter.result} onChange={(e) => setFilter((f) => ({ ...f, result: e.target.value }))}><option value="">todos los resultados</option>{RESULTS.map((r) => <option key={r} value={r}>{RESULT_LABEL[r]}</option>)}</select>
            <input placeholder="símbolo" value={filter.symbol} onChange={(e) => setFilter((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))} style={{ width: 90 }} />
            {(filter.source || filter.step || filter.result || filter.symbol) && <button className="ghost" onClick={() => setFilter({ source: "", step: "", result: "", symbol: "" })}>Limpiar</button>}
          </div>
        </div>
        {calls === null ? <div className="muted" style={{ marginTop: 6 }}>Cargando…</div> : calls.length === 0 ? <div className="muted" style={{ marginTop: 6 }}>Ninguna llamada con esos filtros.</div> : (
          <table style={{ marginTop: 6 }}>
            <thead><tr><th>hora</th><th>fuente</th><th>paso</th><th>propósito</th><th>símbolo</th><th>endpoint</th><th>modelo · clave</th><th>estado</th><th>resultado</th><th>tokens in/out/think</th><th>ms</th></tr></thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{hhmm(c.at)}</td>
                  <td><span style={{ color: colors[c.source] ?? "inherit" }}>●</span> {c.source}</td>
                  <td>{c.step}</td>
                  <td className="muted">{c.purpose ?? "—"}</td>
                  <td className="mono">{c.symbol ?? "—"}</td>
                  <td className="mono muted" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.endpoint}>{c.endpoint}</td>
                  <td className="mono muted">{c.model ? `${c.model} · ${c.keyIndex ?? "—"}` : "—"}</td>
                  <td className="mono">{c.status ?? "—"}</td>
                  <td className={c.result === "ok" ? "ok" : c.result === "rpm" || c.result === "saturado" || c.result === "validacion" ? "warn" : "bad"}>{RESULT_LABEL[c.result] ?? c.result}</td>
                  <td className="mono muted">{c.tokensIn !== null ? `${n(c.tokensIn)}/${n(c.tokensOut ?? 0)}/${n(c.tokensThink ?? 0)}` : "—"}</td>
                  <td className="mono muted">{n(c.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
