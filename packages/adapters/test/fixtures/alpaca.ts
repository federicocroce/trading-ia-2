export const snapshotXXXX = { XXXX: { latestTrade: { p: 10.5, t: "2026-09-04T15:00:00Z" }, dailyBar: { c: 10.4, v: 800000, t: "2026-09-04T00:00:00Z" } } };
export const barsXXXX = { bars: { XXXX: Array.from({ length: 30 }, (_, i) => ({ c: 10, v: 500000 + i * 1000, t: `2026-08-${String((i % 28) + 1).padStart(2, "0")}` })) } };
export const optionsXXXX = {
  snapshots: {
    XXXX260918C00010000: { latestQuote: { bp: 1.0, ap: 1.2 } },
    XXXX260918P00010000: { latestQuote: { bp: 0.7, ap: 0.9 } },
    XXXX260918C00012000: { latestQuote: { bp: 0.4, ap: 0.6 } },
    XXXX261016C00010000: { latestQuote: { bp: 1.5, ap: 1.7 } },
    XXXX261016P00010000: { latestQuote: { bp: 1.2, ap: 1.4 } },
  },
  next_page_token: null,
};
