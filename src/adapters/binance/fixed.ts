import {
  asIsoTime,
  nowIso,
  type Sample,
  type SpotPulse,
  type SpotSource,
} from "../../domain.js";

export type FixedSpotInput = {
  last: number;
  change24hPct: number;
  volume24h: number;
  high24h?: number;
  low24h?: number;
  moveVsWindowOpenPct?: number;
};

export function fixedSpotSource(input: FixedSpotInput): SpotSource {
  return {
    async pullBtcPulse(): Promise<Sample<SpotPulse>> {
      const value: SpotPulse = {
        symbol: "BTCUSDT",
        last: input.last,
        change24hPct: input.change24hPct,
        high24h: input.high24h ?? input.last * 1.02,
        low24h: input.low24h ?? input.last * 0.98,
        volume24hQuote: input.volume24h,
        moveVsWindowOpenPct: input.moveVsWindowOpenPct ?? 0,
      };
      const pulledAt = nowIso();
      return {
        value,
        freshness: { pulledAt: asIsoTime(pulledAt), ageMs: 0 },
        source: "stub",
      };
    },
  };
}

export class FixedSpotSource implements SpotSource {
  private readonly inner: SpotSource;
  constructor(input: FixedSpotInput) {
    this.inner = fixedSpotSource(input);
  }
  pullBtcPulse(): Promise<Sample<SpotPulse>> {
    return this.inner.pullBtcPulse();
  }
}
