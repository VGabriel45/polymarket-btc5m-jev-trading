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

function buyOrder(
  market: DomainMarket,
  outcome: Side,
  size: number,
  at: IsoTime,
  rationale: string,
): IntendedOrder {
  const quote = market.bySide[outcome];
  const price = quote.bestAsk ?? quote.mid;
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
  const price = quote.bestBid ?? quote.mid;
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

/**
 * App-owned trade policy. Jev only supplies side + confidence; side-effects stay here.
 */
export function planTrade(
  position: Position,
  opinion: JudgeOpinion,
  threshold: number,
  market: DomainMarket,
  size: number,
  at: IsoTime,
): TradeAction {
  const hi = gate(opinion.confidence, threshold);

  if (position.kind === "flat") {
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
    return {
      kind: "ENTER",
      side: opinion.side,
      confidence: hi,
      order: buyOrder(
        market,
        opinion.side,
        size,
        at,
        `ENTER ${opinion.side} @ conf ${opinion.confidence.toFixed(3)} > ${threshold}`,
      ),
    };
  }

  if (!hi) {
    return {
      kind: "EXIT",
      side: position.side,
      reason: "low_confidence",
      order: sellOrder(
        market,
        position.side,
        position.size,
        at,
        `EXIT ${position.side} low conf ${opinion.confidence.toFixed(3)} ≤ ${threshold}`,
      ),
    };
  }

  if (opinion.side === position.side) {
    return { kind: "HOLD", side: position.side, confidence: hi };
  }

  const exit = sellOrder(
    market,
    position.side,
    position.size,
    at,
    `SWITCH exit ${position.side}`,
  );
  const enter = buyOrder(
    market,
    opinion.side,
    size,
    at,
    `SWITCH enter ${opinion.side} @ conf ${opinion.confidence.toFixed(3)}`,
  );
  return {
    kind: "SWITCH",
    from: position.side,
    to: opinion.side,
    confidence: hi,
    exit,
    enter,
  };
}

/** Force-close at window end (bid mark or mid). */
export function planWindowEndExit(
  position: Extract<Position, { kind: "open" }>,
  market: DomainMarket,
  at: IsoTime,
): TradeAction {
  return {
    kind: "EXIT",
    side: position.side,
    reason: "window_end",
    order: sellOrder(
      market,
      position.side,
      position.size,
      at,
      `EXIT ${position.side} window_end`,
    ),
  };
}
