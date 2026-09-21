import type {
  Confidence,
  DomainMarket,
  HighConfidence,
  IntendedBuy,
  IsoTime,
  JudgeOpinion,
  Side,
  Verdict,
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
  tokenId: string;
  outcome: Side;
  size: number;
  price: number;
}): string {
  return `${args.tokenId}:${args.outcome}:${args.size}:${priceBand(args.price)}`;
}

export function decide(
  market: DomainMarket,
  opinion: JudgeOpinion,
  threshold: number,
  dryRunSize: number,
  at: IsoTime,
): Verdict {
  const hi = gate(opinion.confidence, threshold);
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

  const quote = market.bySide[opinion.side];
  const price = quote.bestAsk ?? quote.mid;
  const intended: IntendedBuy = {
    side: "BUY",
    tokenId: quote.tokenId,
    outcome: opinion.side,
    price,
    size: dryRunSize,
    rationale: `Jev ${opinion.side} @ conf ${opinion.confidence.toFixed(3)} > ${threshold}`,
    at,
    idempotencyKey: buildIdempotencyKey({
      tokenId: quote.tokenId,
      outcome: opinion.side,
      size: dryRunSize,
      price,
    }),
  };

  return {
    kind: "ACT",
    side: opinion.side,
    confidence: hi,
    intended,
  };
}
