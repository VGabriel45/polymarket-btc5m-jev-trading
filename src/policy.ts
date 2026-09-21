import type {
  Confidence,
  DomainMarket,
  HighConfidence,
  IntendedOrder,
  IsoTime,
  JudgeOpinion,
  Position,
  Side,
  TradeAction,
} from "./domain.js";

/** Brand confidence only when strictly above threshold. */
export function gate(c: Confidence, threshold: number): HighConfidence | null {
  if (!(c > threshold)) return null;
  return c as HighConfidence;
}

function priceBand(price: number): string {
  return (Math.round(price * 100) / 100).toFixed(2);
}

export function buildIdempotencyKey(args: {
  side: "BUY" | "SELL";
  tokenId: string;
  outcome: Side;
  size: number;
  price: number;
}): string {
  return `${args.side}:${args.tokenId}:${args.outcome}:${args.size}:${priceBand(args.price)}`;
}

/**
 * Share count for a USD budget at `price`. Floors to 2dp so size×price ≤ usd.
 */
export function sizeSharesForUsd(usd: number, price: number): number {
  if (!(usd > 0) || !(price > 0)) return 0;
  return Math.floor((usd / price) * 100) / 100;
}

function buyOrder(
  market: DomainMarket,
  outcome: Side,
  betUsd: number,
  at: IsoTime,
  rationale: string,
): IntendedOrder {
  const quote = market.bySide[outcome];
  const price = quote.bestAsk ?? quote.mid;
  const size = sizeSharesForUsd(betUsd, price);
  return {
    side: "BUY",
    tokenId: quote.tokenId,
    outcome,
    price,
    size,
    at,
    idempotencyKey: buildIdempotencyKey({
      side: "BUY",
      tokenId: quote.tokenId,
      outcome,
      size,
      price,
    }),
    rationale,
  };
}

function sellOrder(
  market: DomainMarket,
  outcome: Side,
  size: number,
  at: IsoTime,
  rationale: string,
): IntendedOrder {
  const quote = market.bySide[outcome];
  const price = markBid(market, outcome);
  return {
    side: "SELL",
    tokenId: quote.tokenId,
    outcome,
    price,
    size,
    at,
    idempotencyKey: buildIdempotencyKey({
      side: "SELL",
      tokenId: quote.tokenId,
      outcome,
      size,
      price,
    }),
    rationale,
  };
}

/** Mark price for exiting a side. Ignore stub wing bids far from mid. */
export function markBid(market: DomainMarket, side: Side): number {
  const q = market.bySide[side];
  const gamma = market.outcomePrices?.[side];
  if (
    q.bestBid != null &&
    Number.isFinite(q.bestBid) &&
    Math.abs(q.bestBid - q.mid) <= 0.25
  ) {
    return q.bestBid;
  }
  if (q.lastTrade != null && Number.isFinite(q.lastTrade)) return q.lastTrade;
  if (gamma != null && Number.isFinite(gamma)) return gamma;
  return q.mid;
}

export type PlanTradeOpts = {
  /** ENTER only when conf > this (default 0.90). */
  threshold: number;
  betUsd: number;
  /** Refuse ENTER when ask > maxAsk (default 0.70). */
  maxAsk: number;
  /** Require P(win) ≥ ask + minEdge (default 0.10). */
  minEdge: number;
  /** No new ENTER when seconds left < this (default 90). */
  minSecondsToEnter: number;
  /** Window seconds remaining; null unknown. */
  secondsRemaining: number | null;
  maxEntersPerWindow: number;
  entersThisWindow: number;
};

/** P that the held (or named) side wins the window, from Jev probs or choice. */
export function heldWinProb(opinion: JudgeOpinion, side: Side): number {
  const fromProbs = opinion.probs?.[side];
  if (fromProbs != null && Number.isFinite(fromProbs)) return fromProbs;
  return opinion.side === side ? opinion.confidence : 1 - opinion.confidence;
}

/**
 * Ride-to-resolution policy.
 *
 * Flat: ENTER once when conf > threshold, ask ≤ maxAsk, P(win) ≥ ask+minEdge,
 * and enough time left. Open: HOLD until settle — no mid-window sell/flip.
 */
export function planTrade(
  position: Position,
  opinion: JudgeOpinion,
  market: DomainMarket,
  at: IsoTime,
  opts: PlanTradeOpts,
): TradeAction {
  const {
    threshold,
    betUsd,
    maxAsk,
    minEdge,
    minSecondsToEnter,
    secondsRemaining,
    maxEntersPerWindow,
    entersThisWindow,
  } = opts;
  const hi = gate(opinion.confidence, threshold);

  if (position.kind === "open") {
    const mark = markBid(market, position.side);
    const edge = mark - position.entryPrice;
    const uPnL = position.size * edge;
    const pHeld = heldWinProb(opinion, position.side);
    const why = `HOLD ${position.side} to resolution · Jev conf ${opinion.confidence.toFixed(3)} P(held)=${pHeld.toFixed(3)} · mark ${mark.toFixed(3)} entry ${position.entryPrice.toFixed(3)} uPnL $${uPnL.toFixed(2)}`;
    return {
      kind: "HOLD",
      side: position.side,
      confidence: opinion.confidence,
      why,
    };
  }

  if (!hi) {
    return {
      kind: "ABSTAIN",
      reason: {
        code: "LOW_CONFIDENCE",
        side: opinion.side,
        confidence: opinion.confidence,
      },
    };
  }

  if (entersThisWindow >= maxEntersPerWindow) {
    return {
      kind: "ABSTAIN",
      reason: {
        code: "MAX_TRADES",
        detail: `already entered this window (${entersThisWindow}/${maxEntersPerWindow}) — ride only`,
      },
    };
  }

  if (
    secondsRemaining != null &&
    secondsRemaining < minSecondsToEnter
  ) {
    return {
      kind: "ABSTAIN",
      reason: {
        code: "TOO_LATE",
        detail: `${secondsRemaining}s left < ${minSecondsToEnter}s enter cutoff — book already prices the outcome`,
      },
    };
  }

  const ask =
    market.bySide[opinion.side].bestAsk ?? market.bySide[opinion.side].mid;
  const pWin = heldWinProb(opinion, opinion.side);
  const need = ask + minEdge;

  if (ask > maxAsk) {
    return {
      kind: "ABSTAIN",
      reason: {
        code: "NO_EDGE",
        side: opinion.side,
        pWin,
        ask,
        need: maxAsk,
      },
    };
  }

  // Fair EV needs P(win) above ask by minEdge. Conf alone is not edge.
  if (!(pWin >= need)) {
    return {
      kind: "ABSTAIN",
      reason: {
        code: "NO_EDGE",
        side: opinion.side,
        pWin,
        ask,
        need,
      },
    };
  }

  const why = `ENTER ${opinion.side}: P=${pWin.toFixed(3)} vs ask ${ask.toFixed(3)} (edge ${(pWin - ask).toFixed(3)}) · conf ${opinion.confidence.toFixed(3)} · ride ≤$${betUsd}`;
  return {
    kind: "ENTER",
    side: opinion.side,
    confidence: hi,
    why,
    order: buyOrder(market, opinion.side, betUsd, at, why),
  };
}

/** Force-close at window end (bid mark or mid). */
export function planWindowEndExit(
  position: Extract<Position, { kind: "open" }>,
  market: DomainMarket,
  at: IsoTime,
): TradeAction {
  const mark = markBid(market, position.side);
  const why = `WINDOW END: force sell ${position.side} @ bid ${mark.toFixed(3)}`;
  return {
    kind: "EXIT",
    side: position.side,
    reason: "window_end",
    why,
    order: sellOrder(market, position.side, position.size, at, why),
  };
}
