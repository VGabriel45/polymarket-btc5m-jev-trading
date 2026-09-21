export type Confidence = number & { readonly __brand: "Confidence" };

/**
 * Confidence strictly greater than the session threshold (default 0.90).
 * Only constructible via gate(); ENTER requires this brand.
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
  | {
      code: "NO_EDGE";
      side: Side;
      pWin: number;
      ask: number;
      need: number;
    }
  | { code: "TOO_LATE"; detail: string }
  | { code: "COOLDOWN"; detail: string }
  | { code: "MAX_TRADES"; detail: string }
  | { code: "WORLD_INCOMPLETE"; missing: ReadonlyArray<"market" | "spot"> }
  | { code: "JUDGE_FAILED"; message: string }
  | { code: "MARKET_UNAVAILABLE"; message: string }
  | { code: "STALE_INPUTS"; detail: string }
  | { code: "AWAITING_WINDOW"; detail: string }
  | { code: "SETTLING"; detail: string };

export type TradeAction =
  | { kind: "ABSTAIN"; reason: AbstainReason }
  | { kind: "ENTER"; side: Side; confidence: HighConfidence; order: IntendedOrder; why: string }
  | { kind: "HOLD"; side: Side; confidence: Confidence; why: string }
  | {
      kind: "EXIT";
      side: Side;
      order: IntendedOrder;
      reason: "confidence_floor" | "window_end" | "switch";
      why: string;
    }
  | {
      kind: "SWITCH";
      from: Side;
      to: Side;
      confidence: HighConfidence;
      exit: IntendedOrder;
      enter: IntendedOrder;
      why: string;
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
  mode: "dry-run" | "live";
  reason:
    | "exit"
    | "switch"
    | "window_end"
    | "settle"
    | "take_profit"
    | "confidence_floor";
};

export type QuoteSlice = {
  mid: number;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  lastTrade: number | null;
};

export type FactsForJev = {
  market: {
    slug: string;
    question: string;
    endsAt: string | null;
    volume24hUsd: number;
    up: QuoteSlice;
    down: QuoteSlice;
  };
  btc: {
    last: number;
    change24hPct: number;
    high24h: number;
    low24h: number;
    volume24hQuote: number;
    moveVsWindowOpenPct: number;
    windowOpen: number | null;
  };
  session: {
    secondsRemaining: number | null;
    windowLengthSec: number;
    position:
      | { kind: "flat" }
      | {
          kind: "open";
          side: Side;
          size: number;
          entryPrice: number;
          mark: number;
          uPnLUsd: number;
          uPnLPct: number;
          inProfit: boolean;
        };
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
  /** Optional: fetch a specific slug (for settle after rollover). */
  pullBySlug?(slug: string): Promise<Sample<DomainMarket>>;
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

export type OrderExecutor = {
  apply(
    position: Position,
    action: TradeAction,
    market: DomainMarket,
    at: IsoTime,
  ): Promise<{ position: Position; orders: IntendedOrder[] }>;
};

export type SessionConfig = {
  polymarket: MarketSource;
  spot: SpotSource;
  judge: Judge;
  pen: DryRunPen;
  /** ENTER only when conf > this (default 0.90). */
  threshold: number;
  /** Max USD notional per ENTER. */
  betUsd: number;
  /** Refuse ENTER if ask above this (default 0.70). */
  maxAsk: number;
  /** Require P(win) ≥ ask + minEdge (default 0.10). */
  minEdge: number;
  /** Abstain from new ENTER when fewer seconds remain (default 90). */
  minSecondsToEnter: number;
  /** Max ENTER actions per 5m window (default 1 — ride to end). */
  maxEntersPerWindow: number;
  tickMs: number;
  staleAfterMs: number;
  windowLengthSec: number;
  pnlPath: string;
  liveTrading: boolean;
  executor: OrderExecutor;
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
    upBid: number | null;
    upAsk: number | null;
    downBid: number | null;
    downAsk: number | null;
    upSpread: number | null;
    downSpread: number | null;
    volume24hUsd: number;
    closed: boolean;
    active: boolean;
    source: Sample<DomainMarket>["source"];
    conditionId: string;
  } | null;
  btc: {
    last: number;
    change24hPct: number;
    high24h: number;
    low24h: number;
    volume24hQuote: number;
    moveVsWindowOpenPct: number;
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
  /** Mark-to-market on open position (bid), null when flat. */
  unrealizedPnLUsd: number | null;
  /** Ring of recent policy decisions (newest last). */
  decisionLog: ReadonlyArray<{
    at: IsoTime;
    tickId: number;
    kind: string;
    summary: string;
    conf?: number;
    side?: Side;
  }>;
  /** Ring of recent API / tool activity (newest last). */
  activityLog: ReadonlyArray<{
    at: IsoTime;
    channel: string;
    op: string;
    detail: string;
    ms?: number;
    ok: boolean;
  }>;
  /** Session tick interval (for next-decision countdown). */
  tickMs: number;
  /** Pit-trader one-liner for this tick. */
  voice: string;
};
