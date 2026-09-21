import type {
  DomainMarket,
  FactsForJev,
  IsoTime,
  Sample,
  SpotPulse,
} from "./domain.js";

function ageMsOf(pulledAt: IsoTime, now: IsoTime): number {
  return Math.max(0, Date.parse(now) - Date.parse(pulledAt));
}

export function composeFacts(
  market: Sample<DomainMarket>,
  spot: Sample<SpotPulse>,
  now: IsoTime,
  staleAfterMs: number,
):
  | { ok: true; facts: FactsForJev }
  | { ok: false; reason: "stale_inputs" | "actor_unhealthy"; detail: string } {
  const marketAge = ageMsOf(market.freshness.pulledAt, now);
  const spotAge = ageMsOf(spot.freshness.pulledAt, now);

  if (marketAge > staleAfterMs || spotAge > staleAfterMs) {
    return {
      ok: false,
      reason: "stale_inputs",
      detail: `marketAgeMs=${marketAge} spotAgeMs=${spotAge} staleAfterMs=${staleAfterMs}`,
    };
  }

  const m = market.value;
  const s = spot.value;
  const up = m.bySide.UP;
  const down = m.bySide.DOWN;

  const facts: FactsForJev = {
    market: {
      slug: m.eventSlug,
      question: m.question,
      endsAt: m.endsAt,
      volume24hUsd: m.volume24hUsd,
      up: { mid: up.mid, spread: up.spread, lastTrade: up.lastTrade },
      down: { mid: down.mid, spread: down.spread, lastTrade: down.lastTrade },
    },
    btc: {
      last: s.last,
      change24hPct: s.change24hPct,
      high24h: s.high24h,
      low24h: s.low24h,
      volume24hQuote: s.volume24hQuote,
      moveVsWindowOpenPct: s.moveVsWindowOpenPct,
    },
    meta: {
      marketSource: market.source,
      spotSource: spot.source,
      composedAt: now,
    },
  };

  return { ok: true, facts };
}
