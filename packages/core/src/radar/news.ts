import type { AnalystAction, AnalystTargets, EventKind, NewsItem } from "./types.js";

/**
 * Noticias → posibles eventos materiales (spec verificación §5) y acciones de analistas (§6). Puro.
 * El prefiltro es deliberadamente amplio: el modelo separa grave / moderado / ruido; acá solo se evita mandarle todo.
 */
export const EVENT_PATTERNS: Array<{ kind: EventKind; re: RegExp }> = [
  { kind: "regulatorio", re: /negative opinion|\bCHMP\b|complete response letter|\bCRL\b|refus(?:e|es|ed|al) to (?:file|approve)|\breject(?:s|ed)?\b|declin(?:e|es|ed) to approve|clinical hold|withdr(?:aw|aws|ew|awn) (?:its |the )?(?:application|NDA|BLA|MAA)|FDA (?:rejects|declines)|opini[oó]n negativa|rechaz(?:a|o|ó)\b/i },
  { kind: "continuidad", re: /going concern|bankruptcy|chapter 11|\bdefault(?:s|ed)?\b|concurso de acreedores|quiebra/i },
  { kind: "contable", re: /\brestate(?:s|d|ment)?\b|material weakness|SEC (?:investigation|subpoena|probe)|accounting (?:irregularit|probe|investigation)|reexpres/i },
  { kind: "listado", re: /delist|non-?compliance notice|nasdaq (?:notice|deficiency)|minimum bid price/i },
  { kind: "guidance", re: /(?:cuts?|lowers?|slashes|trims|withdraws?|reduces?) (?:its |full[- ]year |fy ?\d* |annual )?(?:guidance|outlook|forecast)|guidance cut|recorta (?:la )?(?:gu[ií]a|previsiones)/i },
  { kind: "dilucion", re: /public offering|registered direct|at-the-market|convertible (?:senior )?notes|private placement|priced (?:its |an? )?(?:public |underwritten )?offering|shelf registration|ampliaci[oó]n de capital/i },
  { kind: "litigio", re: /class action|securities fraud|investigat(?:es|ion|ing) (?:claims|on behalf|potential)|shareholder alert|investor alert|lawsuit|demanda colectiva/i },
  { kind: "gestion", re: /\b(?:CEO|CFO|chief executive|chief financial)\b.*\b(?:resigns|steps down|departs|departure|to step down|exits)\b|auditor resign/i },
  { kind: "analista", re: /price target|\b(?:maintains|reiterates|downgrades?|upgrades?|initiates coverage)\b/i },
];

export function materialHeadlines(items: NewsItem[]): Array<{ item: NewsItem; kind: EventKind }> {
  const out: Array<{ item: NewsItem; kind: EventKind }> = [];
  for (const item of items) {
    const hit = EVENT_PATTERNS.find((p) => p.re.test(item.headline));
    if (hit) out.push({ item, kind: hit.kind });
  }
  return out;
}

const BENZINGA_MAINTAIN = /^(?<firm>.+?) (?<verb>Maintains|Reiterates) (?<rating>[A-Za-z][A-Za-z -]*?) on (?<company>.+?), (?:Lowers|Raises|Maintains|Announces|Sets|Adjusts) (?:\$[\d.]+ )?Price Target(?: to| of)? \$(?<target>[\d.]+)/i;
const BENZINGA_GRADE = /^(?<firm>.+?) (?<verb>Upgrades|Downgrades) (?<company>.+?) to (?<rating>[A-Za-z][A-Za-z -]*?)(?:, (?:Lowers|Raises|Maintains|Announces|Sets) (?:\$[\d.]+ )?Price Target(?: to| of)? \$(?<target>[\d.]+))?$/i;
const BENZINGA_INIT = /^(?<firm>.+?) Initiates Coverage On (?<company>.+?) with (?<rating>[A-Za-z][A-Za-z -]*?) Rating(?:, Announces \$(?<target>[\d.]+) Price Target)?/i;
const THEFLY = /price target (?<dir>lowered|raised) to \$?(?<target>[\d.]+) from \$?[\d.]+ at (?<firm>.+)$/i;
const num = (s: string | undefined): number | null => (s === undefined ? null : Number(s));

/** Reconoce los formatos de Benzinga y TheFly; cualquier otro → null (informativo, no decide). */
export function parseAnalystAction(item: NewsItem): AnalystAction | null {
  const h = item.headline.trim();
  const base = { symbol: item.symbol, date: item.date, url: item.url };
  let m = BENZINGA_MAINTAIN.exec(h);
  if (m?.groups) return { ...base, firm: m.groups["firm"]!, action: "mantiene", rating: m.groups["rating"]!, target: num(m.groups["target"]) };
  m = BENZINGA_GRADE.exec(h);
  if (m?.groups) return { ...base, firm: m.groups["firm"]!, action: /^Upgrades$/i.test(m.groups["verb"]!) ? "sube" : "baja", rating: m.groups["rating"]!, target: num(m.groups["target"]) };
  m = BENZINGA_INIT.exec(h);
  if (m?.groups) return { ...base, firm: m.groups["firm"]!, action: "inicia", rating: m.groups["rating"]!, target: num(m.groups["target"]) };
  m = THEFLY.exec(h);
  if (m?.groups) return { ...base, firm: m.groups["firm"]!.trim(), action: "mantiene", rating: null, target: num(m.groups["target"]) };
  return null;
}

const DAY = 86_400_000;
/** Resumen de objetivos de los últimos `days` días. null si no hay ninguno con objetivo. */
export function analystTargets(actions: AnalystAction[], today: string, days = 90): AnalystTargets | null {
  const since = new Date(Date.parse(today) - days * DAY).toISOString().slice(0, 10);
  const xs = actions.filter((a) => a.date >= since && a.target !== null).sort((a, b) => a.target! - b.target!);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mid]!.target! : (xs[mid - 1]!.target! + xs[mid]!.target!) / 2;
  return { n: xs.length, median, min: xs[0]!.target!, max: xs[xs.length - 1]!.target!, latestDate: xs.map((a) => a.date).sort().at(-1) ?? null };
}
