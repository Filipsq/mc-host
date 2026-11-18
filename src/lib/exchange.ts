import "server-only";

// Złoty exchange rates from the Polish central bank (NBP, table A, published
// every working day), for the admin panel's costs. Kept for 6 hours; if NBP
// doesn't answer, the last rates are used, or none at all.

export type Rates = { date: string; perPln: Record<string, number> };

const URL = "https://api.nbp.pl/api/exchangerates/tables/A/?format=json";
const TTL = 6 * 60 * 60 * 1000;

let cached: { at: number; rates: Rates } | undefined;
let failedAt = 0;
let inflight: Promise<void> | null = null;
// After NBP failed to answer, the overview doesn't wait on it again for a while.
const RETRY_MS = 10 * 60 * 1000;

function refresh() {
  inflight ??= (async () => {
    try {
      const res = await fetch(URL, { cache: "no-store", signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`NBP ${res.status}`);
      const [table] = (await res.json()) as { effectiveDate: string; rates: { code: string; mid: number }[] }[];
      const perPln: Record<string, number> = { PLN: 1 };
      for (const r of table.rates) perPln[r.code] = r.mid;
      cached = { at: Date.now(), rates: { date: table.effectiveDate, perPln } };
    } catch (err) {
      failedAt = Date.now();
      console.error("exchange rates:", (err as Error).message);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const current = () => cached?.rates ?? null;

export async function nbpRates(): Promise<Rates | null> {
  if (cached && Date.now() - cached.at < TTL) return cached.rates;
  const retry = Date.now() - failedAt >= RETRY_MS;
  if (cached) {
    // Old rates are shown at once while new ones are fetched for the next page.
    if (retry) void refresh();
    return cached.rates;
  }
  if (retry) await refresh();
  return current();
}

/** An amount in minor units of `currency` as złoty minor units (grosze), or null without a rate. */
export function toPln(minor: number, currency: string, rates: Rates | null): number | null {
  if (currency === "PLN") return minor;
  const rate = rates?.perPln[currency];
  return rate ? Math.round(minor * rate) : null;
}
