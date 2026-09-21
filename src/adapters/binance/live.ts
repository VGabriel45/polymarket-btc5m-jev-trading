import {
  asIsoTime,
  nowIso,
  type Sample,
  type SpotPulse,
  type SpotSource,
} from "../../domain.js";

const BINANCE = "https://api.binance.com";

async function getJson(path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${BINANCE}${path}`, {
      signal: AbortSignal.timeout(12_000),
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    (err as Error & { status?: number }).status = 0;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} binance ${path}`);
  }
  return res.json();
}

export function binanceSpotSource(): SpotSource {
  return {
    async pullBtcPulse(): Promise<Sample<SpotPulse>> {
      const [ticker24, price, klines] = await Promise.all([
        getJson("/api/v3/ticker/24hr?symbol=BTCUSDT") as Promise<Record<string, string>>,
        getJson("/api/v3/ticker/price?symbol=BTCUSDT") as Promise<{ price: string }>,
        getJson("/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=24") as Promise<
          unknown[]
        >,
      ]);

      const last = Number(price.price);
      const change24hPct = Number(ticker24.priceChangePercent);
      const high24h = Number(ticker24.highPrice);
      const low24h = Number(ticker24.lowPrice);
      const volume24hQuote = Number(ticker24.quoteVolume);

      // kline: [openTime, open, high, low, close, ...]
      const first = klines[0] as unknown[] | undefined;
      const windowOpen = first ? Number(first[1]) : last;
      const moveVsWindowOpenPct =
        windowOpen > 0 ? ((last - windowOpen) / windowOpen) * 100 : 0;

      if (![last, change24hPct, high24h, low24h, volume24hQuote].every(Number.isFinite)) {
        throw new Error("binance ticker parse failed");
      }

      const value: SpotPulse = {
        symbol: "BTCUSDT",
        last,
        change24hPct,
        high24h,
        low24h,
        volume24hQuote,
        moveVsWindowOpenPct: Number.isFinite(moveVsWindowOpenPct)
          ? moveVsWindowOpenPct
          : 0,
      };
      const pulledAt = nowIso();
      return {
        value,
        freshness: { pulledAt: asIsoTime(pulledAt), ageMs: 0 },
        source: "live",
      };
    },
  };
}
