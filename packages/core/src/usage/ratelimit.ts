/** Limitador de ventana deslizante (N llamadas por minuto). Reloj y espera inyectables para testear. */
export class RateLimiter {
  private readonly stamps: number[] = [];
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}
  async acquire(): Promise<void> {
    for (;;) {
      const t = this.now();
      while (this.stamps.length && t - this.stamps[0]! >= 60_000) this.stamps.shift();
      if (this.stamps.length < this.perMinute) {
        this.stamps.push(t);
        return;
      }
      await this.sleep(60_000 - (t - this.stamps[0]!) + 1);
    }
  }
}

/** Un limitador por clave (p. ej. modelo+key de Gemini), creados a demanda con el mismo tope. */
export class KeyedRateLimiter {
  private readonly limiters = new Map<string, RateLimiter>();
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
    private readonly sleep?: (ms: number) => Promise<void>,
  ) {}
  acquire(key: string): Promise<void> {
    let l = this.limiters.get(key);
    if (!l) {
      l = this.sleep ? new RateLimiter(this.perMinute, this.now, this.sleep) : new RateLimiter(this.perMinute, this.now);
      this.limiters.set(key, l);
    }
    return l.acquire();
  }
}
