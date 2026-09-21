import {
  parseConfidence,
  type FactsForJev,
  type Judge,
  type JudgeOpinion,
  type Side,
} from "../../domain.js";

export type StubJudgeFixed = {
  side: Side;
  confidence: number;
  probs?: { UP: number; DOWN: number };
};

export function stubJudge(fixed: StubJudgeFixed): Judge {
  const confidence = parseConfidence(fixed.confidence);
  if (!confidence) {
    throw new Error(`stubJudge: invalid confidence ${fixed.confidence}`);
  }
  const opinion: JudgeOpinion = {
    side: fixed.side,
    confidence,
    probs: fixed.probs ?? {
      UP: fixed.side === "UP" ? fixed.confidence : 1 - fixed.confidence,
      DOWN: fixed.side === "DOWN" ? fixed.confidence : 1 - fixed.confidence,
    },
  };
  return {
    async ask(_facts: FactsForJev): Promise<JudgeOpinion> {
      void _facts;
      return opinion;
    },
  };
}

export class StubJudge implements Judge {
  private readonly inner: Judge;
  constructor(fixed: StubJudgeFixed) {
    this.inner = stubJudge(fixed);
  }
  ask(facts: FactsForJev): Promise<JudgeOpinion> {
    return this.inner.ask(facts);
  }
}
