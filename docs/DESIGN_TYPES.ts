/**
 * btc-updown-jev — core types & signatures (candidate 1)
 *
 * Derived from USAGE.md call sites. Bodies are stubs / TODO.
 * Wire types (Gamma / CLOB / Binance JSON) are intentionally absent.
 */

// ─── branded scalars ─────────────────────────────────────────────────────────

/** Finite probability in (0, 1]. Construct only via parseConfidence. */
export type Confidence = number & { readonly __brand: "Confidence" };

/**
 * Confidence strictly greater than the session threshold (default 0.70).
 * Only constructible via gate(); ACT verdicts require this brand.
 */
export type HighConfidence = Confidence & { readonly __high: "HighConfidence" };

export type Side = "UP" | "DOWN";

/** Outcome token handle — opaque string, never a raw CLOB DTO. */
export type TokenId = string & { readonly __brand: "TokenId" };

export type IsoTime = string & { readonly __brand: "IsoTime" }; // Instant.toString()

export function parseConfidence(n: number): Confidence | null {
  // TODO: reject NaN / ≤0 / >1
  return null;
}

export function gate(c: Confidence, threshold: number): HighConfidence | null {
  // TODO: return branded high only if c > threshold
  return null;
}

// ─── per-actor samples (merge at read boundary) ──────────────────────────────

export type Freshness = {
  pulledAt: IsoTime;
  /** Milliseconds since pull; compose may mark stale. */
  ageMs: number;
};

/**
 * Latest observation held by one actor. Actors never share mutable bags;
 * composeFacts() reads both and builds FactsForJev.
 */
export type Sample<T> = {
  value: T;
  freshness: Freshness;
  source: "live" | "fixture" | "stub";
};

/** Dominant market access: index by Side → quote + token. */
export type DomainMarket = {
  eventSlug: string;
  question: string;
  conditionId: string;
  endsAt: IsoTime | null;
  volume24hUsd: number;
  /** Map is the primary access pattern — no "find by outcome string" later. */
  bySide: Record<
    Side,
    {
      tokenId: TokenId;
      outcomeLabel: string;
      mid: number; // 0–1
      bestBid: number | null;
      bestAsk: number | null;
      spread: number | null;
      lastTrade: number | null;
    }
  >;
};

/** Dominant spot access: one pulse with precomputed window stats (no raw klines). */
export type SpotPulse = {
  symbol: "BTCUSDT";
  last: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  volume24hQuote: number;
  /** Move vs window open (first candle open of the 24h pull). */
  moveVsWindowOpenPct: number;
};

export type ActorHealth =
  | { ok: true }
  | { ok: false; code: "transport" | "parse" | "empty" | "stale"; detail: string };

// ─── composed facts for Jev (app-owned arithmetic already done) ───────────────

/**
 * Exactly what TypeSafeClient.systemOne receives as `state`.
 * Flat, JSON-serializable, no nested wire leftovers.
 */
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

export function composeFacts(
  market: Sample<DomainMarket>,
  spot: Sample<SpotPulse>,
  now: IsoTime,
  staleAfterMs: number,
):
  | { ok: true; facts: FactsForJev }
  | { ok: false; reason: "stale_inputs" | "actor_unhealthy"; detail: string } {
  // TODO: if either ageMs > staleAfterMs → fail; else map DomainMarket/SpotPulse → FactsForJev
  void market;
  void spot;
  void now;
  void staleAfterMs;
  return { ok: false, reason: "stale_inputs", detail: "not implemented" };
}

// ─── judge + verdict ADT ─────────────────────────────────────────────────────

export type JudgeOpinion = {
  side: Side;
  confidence: Confidence;
  /** Optional raw probs from Jev for TUI; not used by gate. */
  probs?: { UP: number; DOWN: number };
};

/** Dry-run artifact only — no path to ClobClient.postOrder. */
export type IntendedBuy = {
  side: "BUY";
  tokenId: TokenId;
  outcome: Side;
  /** Suggested limit ≈ best ask or mid; informational. */
  price: number;
  size: number;
  rationale: string;
  at: IsoTime;
  /** Grafted from candidate 2 — pen/ledger dedupe key. */
  idempotencyKey: string;
};

/**
 * Decision ADT. ACT is unrepresentable without HighConfidence.
 * Invalid combos (ACT + low conf) cannot be typed.
 */
/** Grafted from candidate 2 — structured abstain for TUI / CI JSON. */
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

export function decide(
  market: DomainMarket,
  opinion: JudgeOpinion,
  threshold: number,
  dryRunSize: number,
  at: IsoTime,
): Verdict {
  // TODO:
  //   const hi = gate(opinion.confidence, threshold);
  //   if (!hi) return { kind: "ABSTAIN", reason: "low_confidence", ... };
  //   const q = market.bySide[opinion.side];
  //   return { kind: "ACT", side: opinion.side, confidence: hi, intended: { ... } };
  void market;
  void opinion;
  void threshold;
  void dryRunSize;
  void at;
  return {
    kind: "ABSTAIN",
    reason: { code: "JUDGE_FAILED", message: "not implemented" },
  };
}

// ─── ports (adapters implement; domain never imports wire SDKs) ─────────────

export interface MarketSource {
  /** Resolve active BTC Up/Down + quotes for both sides. */
  pullActiveBtcUpDown(): Promise<Sample<DomainMarket>>;
}

export interface SpotSource {
  pullBtcPulse(): Promise<Sample<SpotPulse>>;
}

export interface Judge {
  /**
   * Ask Jev: choice UP|DOWN given FactsForJev.
   * Implementations: TypeSafeJudge (live), StubJudge (TUI-only / tests).
   * Live path must throw/fail if TYPESAFE_API_KEY missing — no silent stub.
   */
  ask(facts: FactsForJev): Promise<JudgeOpinion>;
}

export interface DryRunPen {
  /**
   * Log intended BUY. Idempotent for identical intended within debounce window.
   * Never network-posts.
   */
  record(intended: IntendedBuy): Promise<void>;
}

// ─── session config & snapshot (TUI contract) ────────────────────────────────

export type SessionConfig = {
  polymarket: MarketSource;
  spot: SpotSource;
  judge: Judge;
  pen: DryRunPen;
  threshold: number; // default 0.70
  dryRunSize: number;
  tickMs: number;
  staleAfterMs: number;
};

/**
 * Single event type the TUI renders. No collector reach-through.
 * Access pattern: top-level fields only (verdict, market blurb, btc blurb, health).
 */
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
  /** Grafted from candidate 2 — recent dry-run intents for TUI. */
  intentLogTail: ReadonlyArray<IntendedBuy>;
};

// ─── WatchSession — the only deep public surface ─────────────────────────────

export declare class WatchSession {
  /** Factory: prefer WatchSession.open(loadConfig(env)) from CLI. */
  static open(cfg: SessionConfig): Promise<WatchSession>;

  /**
   * One tick. Call chain ≤3 files:
   *   session.tick → (actors pull) → composeFacts → judge.ask → decide → pen.record
   * Actors refresh their Sample<>; compose merges at this boundary.
   */
  tick(): Promise<TickSnapshot>;

  /** Loop: tick → onSnap → sleep(tickMs). Returns stop(). */
  run(onSnap: (s: TickSnapshot) => void): { stop: () => void };

  close(): Promise<void>;
}

// ─── adapter factories (signatures only; live behind POLYMARKET_SOURCE) ──────

export declare function liveMarketSource(opts: {
  slugOverride?: string;
}): MarketSource;

export declare function fixtureMarketSource(path: string): MarketSource;

/** Tries live; on transport failure swaps to fixture once and stays there. */
export declare function autoMarketSource(opts: {
  slugOverride?: string;
  fixturePath: string;
}): MarketSource;

export declare function binanceSpotSource(): SpotSource;

export declare function typeSafeJudge(opts: {
  apiKey: string;
  model: "jev-1.13.0";
}): Judge;

export declare function stubJudge(fixed: JudgeOpinion): Judge;

export declare function logPen(opts?: { debounceMs?: number }): DryRunPen;
