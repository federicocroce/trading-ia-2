import type { AssetInfo, SnapshotLite } from "@thesis/core";
import type { HttpClient } from "../http/index.js";
import { ALPACA_DATA, alpacaHeaders, alpacaTradingBase, type AlpacaConfig } from "./client.js";

interface AssetResp {
  symbol: string;
  name: string;
  exchange: string;
  tradable: boolean;
}
interface SnapshotResp {
  latestTrade?: { p?: number };
  dailyBar?: { c?: number; v?: number };
  prevDailyBar?: { c?: number; v?: number };
}

/** Universo bruto de acciones US y precios/volúmenes por lote (spec etapa 2 §4). */
export class AlpacaAssets {
  constructor(
    private readonly http: HttpClient,
    private readonly cfg: AlpacaConfig,
  ) {}
  async list(): Promise<AssetInfo[]> {
    const rows = await this.http.getJson<AssetResp[]>(`${alpacaTradingBase(this.cfg.paper)}/v2/assets?status=active&asset_class=us_equity`, alpacaHeaders(this.cfg));
    return rows.map((a) => ({ symbol: a.symbol, name: a.name, exchange: a.exchange, tradable: a.tradable }));
  }
  /** 100 símbolos por llamada. Precio = último trade o cierre diario; volumen = barra diaria (IEX). */
  async snapshots(symbols: string[]): Promise<SnapshotLite[]> {
    const out: SnapshotLite[] = [];
    for (let i = 0; i < symbols.length; i += 100) {
      const batch = symbols.slice(i, i + 100);
      const r = await this.http.getJson<Record<string, SnapshotResp>>(`${ALPACA_DATA}/v2/stocks/snapshots?symbols=${batch.join(",")}&feed=iex`, alpacaHeaders(this.cfg));
      for (const s of batch) {
        const snap = r[s];
        const price = snap?.latestTrade?.p ?? snap?.dailyBar?.c ?? snap?.prevDailyBar?.c ?? null;
        const vol = snap?.dailyBar?.v ?? snap?.prevDailyBar?.v ?? null;
        out.push({ symbol: s, price, iexVolume: vol });
      }
    }
    return out;
  }
}
