import { useEffect, useState } from "react";
import { api, type Tags as TagsT, type TaxonomyOptions } from "./api";

/** Chips de etiquetas por ticker; editor manual (lo manual nunca lo pisa una regla ni el modelo). */
export function TagChips({ tags }: { tags: TagsT | null }) {
  if (!tags) return <span className="muted">sin etiquetas</span>;
  return (
    <>
      <span className={`chip ${tags.themesSource === "manual" ? "manual" : ""}`} title="clase de activo">{tags.assetClass}</span>
      <span className="chip" title="sector">{tags.sector}</span>
      {tags.themes.map((t) => <span key={t} className="chip" title="tema">{t}</span>)}
    </>
  );
}

export function TagEditor({ symbol, current, onSaved, onCancel }: { symbol: string; current: TagsT | null; onSaved: (t: TagsT) => void; onCancel: () => void }) {
  const [opts, setOpts] = useState<TaxonomyOptions | null>(null);
  const [assetClass, setAssetClass] = useState(current?.assetClass ?? "accion_us");
  const [sector, setSector] = useState(current?.sector ?? "Otros");
  const [themes, setThemes] = useState<string[]>(current?.themes ?? []);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.taxonomy.options().then(setOpts).catch((e) => setErr(String(e)));
  }, []);
  if (err) return <div className="err">{err}</div>;
  if (!opts) return <span className="muted">cargando…</span>;
  const toggle = (t: string) => setThemes(themes.includes(t) ? themes.filter((x) => x !== t) : [...themes, t]);
  return (
    <div className="card" style={{ marginTop: 6 }}>
      <div className="form-row">
        <b>{symbol}</b>
        <select value={assetClass} onChange={(e) => setAssetClass(e.target.value)}>{opts.assetClasses.map((a) => <option key={a}>{a}</option>)}</select>
        <select value={sector} onChange={(e) => setSector(e.target.value)}>{opts.sectors.map((s) => <option key={s}>{s}</option>)}</select>
      </div>
      <div style={{ marginTop: 6 }}>
        {opts.themes.map((t) => (
          <label key={t} style={{ marginRight: 10, whiteSpace: "nowrap" }}><input type="checkbox" checked={themes.includes(t)} onChange={() => toggle(t)} /> {t}</label>
        ))}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={() => api.taxonomy.put(symbol, { assetClass, sector, themes }).then(onSaved).catch((e) => setErr(String(e)))}>Guardar etiquetas</button>
        <button className="ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
