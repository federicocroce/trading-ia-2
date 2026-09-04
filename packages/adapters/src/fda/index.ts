import type { EventType, Ingestor, RawEvent } from "@thesis/core";
import { EventType as EventTypeSchema } from "@thesis/core";
import { newEvent } from "../util.js";

/**
 * Ingestor manual por CSV. Cubre lo que no tiene API gratuita y estructurada:
 * fechas PDUFA/AdCom (FDA), fallos con fecha, licitaciones y datos macro AR con fecha.
 *
 * Formato (con header): ticker,event_type,event_date,title,ref
 * Ej: XXXX,fda,2026-11-20,PDUFA decisión para XYZ-123 en indicación ABC,pdufa:xyz123
 */
export interface CsvSource {
  read(): Promise<string>;
}

export class ManualCsvIngestor implements Ingestor {
  readonly source = "manual" as const;
  constructor(private readonly csv: CsvSource) {}

  async fetch(since: string): Promise<RawEvent[]> {
    const text = await this.csv.read();
    const out: RawEvent[] = [];
    for (const row of parseCsv(text)) {
      if (!row.ticker || !row.event_type || !row.event_date) continue;
      const parsed = EventTypeSchema.safeParse(row.event_type);
      if (!parsed.success) continue;
      if (row.event_date < since.slice(0, 10)) continue;
      out.push(
        newEvent({
          ticker: row.ticker.toUpperCase(),
          eventType: parsed.data as EventType,
          source: "manual",
          eventDate: row.event_date,
          sourceRef: row.ref || `manual:${row.ticker}:${row.event_type}:${row.event_date}`,
          title: row.title ?? "",
          payload: { ...row },
        }),
      );
    }
    return out;
  }
}

export function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  const header = lines.shift();
  if (!header) return [];
  const cols = header.split(",").map((c) => c.trim());
  return lines.map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    cols.forEach((c, i) => (row[c] = (cells[i] ?? "").trim()));
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
