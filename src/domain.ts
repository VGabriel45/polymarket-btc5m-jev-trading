export type Confidence = number & { readonly __brand: "Confidence" };

/**
 * Confidence strictly greater than the session threshold (default 0.70).
 * Only constructible via gate(); ENTER/HOLD/SWITCH require this brand.
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
  closed: boolean;
  active: boolean;
  /** Parallel to Up/Down outcomes when Gamma provides them; used at settle. */
  outcomePrices: { UP: number | null; DOWN: number | null } | null;
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

export type WindowPhase = "awaiting_window" | "trading" | "settling" | "recorded";

export type Position =
  | { kind: "flat" }
  | {
      kind: "open";
      side: Side;
      tokenId: TokenId;
      size: number;
      entryPrice: number;
      openedAt: IsoTime;
      slug: string;
    };

export type IntendedOrder = {
  side: "BUY" | "SELL";
  tokenId: TokenId;
  outcome: Side;
  price: number;
  size: number;
  at: IsoTime;
  idempotencyKey: string;
  rationale: string;
};

export type AbstainReason =
  | { code: "LOW_CONFIDENCE"; side: Side; confidence: Confidence }
  | { code: "WORLD_INCOMPLETE"; missing: ReadonlyArray<"market" | "spot"> }
  | { code: "JUDGE_FAILED"; message: string }
  | { code: "MARKET_UNAVAILABLE"; message: string }
  | { code: "STALE_INPUTS"; detail: string }
  | { code: "AWAITING_WINDOW"; detail: string }
  | { code: "SETTLING"; detail: string };

export type TradeAction =
  | { kind: "ABSTAIN"; reason: AbstainReason }
  | { kind: "ENTER"; side: Side; confidence: HighConfidence; order: IntendedOrder }
  | { kind: "HOLD"; side: Side; confidence: HighConfidence }
  | {
      kind: "EXIT";
      side: Side;
      order: IntendedOrder;
      reason: "low_confidence" | "window_end" | "switch";
    }
  | {
      kind: "SWITCH";
      from: Side;
      to: Side;
      confidence: HighConfidence;
      exit: IntendedOrder;
      enter: IntendedOrder;
    };

export type PnLRecord = {
  slug: string;
  settledAt: IsoTime;
  winner: Side | null;
  positionSide: Side | null;
  entryPrice: number | null;
  exitPrice: number | null;
  size: number;
  pnlUsd: number;
  mode: "dry-run";
};

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
  session: {
    secondsRemaining: number | null;
    windowLengthSec: number;
    position: { kind: "flat" } | { kind: "open"; side: Side };
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
  record(order: IntendedOrder): Promise<void>;
  /** Recent recorded intents for TUI / snapshot (newest last). */
  tail?(limit?: number): ReadonlyArray<IntendedOrder>;
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
  windowLengthSec: number;
  pnlPath: string;
  liveTrading: boolean;
};

export type PnLSummary = {
  count: number;
  cumulativeUsd: number;
  last: PnLRecord | null;
};

export type TickSnapshot = {
  tickId: number;
  at: IsoTime;
  phase: WindowPhase;
  secondsRemaining: number | null;
  position: Position;
  action: TradeAction;
  market: {
    slug: string;
    question: string;
    upMid: number;
    downMid: number;
    volume24hUsd: number;
    closed: boolean;
    active: boolean;
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
  lastOrder: IntendedOrder | null;
  intentLogTail: ReadonlyArray<IntendedOrder>;
  lastPnL: PnLRecord | null;
  cumulativePnLUsd: number;
};
