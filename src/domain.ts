/**
 * Core domain types. Wire (Gamma / CLOB / Binance JSON) stays in adapters.
 */

export type Confidence = number & { readonly __brand: "Confidence" };

/**
 * Confidence strictly greater than the session threshold (default 0.70).
 * Only constructible via gate(); ACT verdicts require this brand.
 */
export type HighConfidence = Confidence & { readonly __high: "HighConfidence" };

export type Side = "UP" | "DOWN";

export type TokenId = string & { readonly __brand: "TokenId" };

export type IsoTime = string & { readonly __brand: "IsoTime" };

export function asTokenId(s: string): TokenId {
  return s as TokenId;
}

export function asIsoTime(s: string): IsoTime {
  return s as IsoTime;
}

export function nowIso(): IsoTime {
  return asIsoTime(new Date().toISOString());
}

/** Finite probability in (0, 1]. */
export function parseConfidence(n: number): Confidence | null {
  if (!Number.isFinite(n) || n <= 0 || n > 1) return null;
  return n as Confidence;
}

export type Freshness = {
  pulledAt: IsoTime;
  ageMs: number;
};

export type Sample<T> = {
  value: T;
  freshness: Freshness;
  source: "live" | "fixture" | "stub";
};

export type DomainMarket = {
  eventSlug: string;
  question: string;
  conditionId: string;
  endsAt: IsoTime | null;
  volume24hUsd: number;
  bySide: Record<
    Side,
    {
      tokenId: TokenId;
      outcomeLabel: string;
      mid: number;
      bestBid: number | null;
      bestAsk: number | null;
      spread: number | null;
      lastTrade: number | null;
    }
  >;
};

export type SpotPulse = {
  symbol: "BTCUSDT";
  last: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  volume24hQuote: number;
  moveVsWindowOpenPct: number;
};

export type ActorHealth =
  | { ok: true }
  | { ok: false; code: "transport" | "parse" | "empty" | "stale"; detail: string };

export type FactsForJev = {
  market: {
    slug: string;
    question: string;
    endsAt: string | null;
    volume24hUsd: number;
    up: { mid: number; spread: number | null; lastTrade: number | null };
    down: { mid: number; spread: number | null; lastTrade: number | null };
  };
  btc: {
    last: number;
    change24hPct: number;
    high24h: number;
    low24h: number;
    volume24hQuote: number;
    moveVsWindowOpenPct: number;
  };
  meta: {
    marketSource: "live" | "fixture" | "stub";
    spotSource: "live" | "fixture" | "stub";
    composedAt: string;
  };
};

export type JudgeOpinion = {
  side: Side;
  confidence: Confidence;
  probs?: { UP: number; DOWN: number };
};

export type IntendedBuy = {
  side: "BUY";
  tokenId: TokenId;
  outcome: Side;
  price: number;
  size: number;
  rationale: string;
  at: IsoTime;
  idempotencyKey: string;
};

export type AbstainReason =
  | { code: "LOW_CONFIDENCE"; side: Side; confidence: Confidence }
  | { code: "WORLD_INCOMPLETE"; missing: ReadonlyArray<"market" | "spot"> }
  | { code: "JUDGE_FAILED"; message: string }
  | { code: "MARKET_UNAVAILABLE"; message: string }
  | { code: "STALE_INPUTS"; detail: string };

export type Verdict =
  | {
      kind: "ACT";
      side: Side;
      confidence: HighConfidence;
      intended: IntendedBuy;
    }
  | {
      kind: "ABSTAIN";
      reason: AbstainReason;
    };

export interface MarketSource {
  pullActiveBtcUpDown(): Promise<Sample<DomainMarket>>;
}

export interface SpotSource {
  pullBtcPulse(): Promise<Sample<SpotPulse>>;
}

export interface Judge {
  ask(facts: FactsForJev): Promise<JudgeOpinion>;
}

export interface DryRunPen {
  record(intended: IntendedBuy): Promise<void>;
  /** Recent recorded intents for TUI / snapshot (newest last). */
  tail?(limit?: number): ReadonlyArray<IntendedBuy>;
}

export type SessionConfig = {
  polymarket: MarketSource;
  spot: SpotSource;
  judge: Judge;
  pen: DryRunPen;
  threshold: number;
  dryRunSize: number;
  tickMs: number;
  staleAfterMs: number;
};

export type TickSnapshot = {
  tickId: number;
  at: IsoTime;
  market: {
    slug: string;
    question: string;
    upMid: number;
    downMid: number;
    volume24hUsd: number;
    source: Sample<DomainMarket>["source"];
  } | null;
  btc: {
    last: number;
    change24hPct: number;
    volume24hQuote: number;
    source: Sample<SpotPulse>["source"];
  } | null;
  health: {
    market: ActorHealth;
    spot: ActorHealth;
  };
  factsPreview: FactsForJev | null;
  opinion: JudgeOpinion | null;
  verdict: Verdict;
  lastIntended: IntendedBuy | null;
  intentLogTail: ReadonlyArray<IntendedBuy>;
};
