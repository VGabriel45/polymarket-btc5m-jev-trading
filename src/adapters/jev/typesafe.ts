import { TypeSafeClient, choice, type EntryType } from "@typesafe-ai/sdk";
import {
  parseConfidence,
  type FactsForJev,
  type Judge,
  type JudgeOpinion,
  type Side,
} from "../../domain.js";

const DIRECTION_Q = [
  "This is a Polymarket BTC Up/Down 5-minute contract.",
  "Resolution is Chainlink BTC/USD TWAP vs Price to Beat (window open), not Binance spot and not share odds.",
  "UP wins if close TWAP >= open reference. DOWN otherwise. Winning shares pay $1, losers $0.",
  "Return calibrated P(UP) and P(DOWN) for THIS window using seconds remaining and btc.moveVsWindowOpenPct.",
  "If session.position.kind is open, judge whether THAT side still resolves winner.",
  "Market mids are trader opinions, not the oracle. Prefer BTC path vs open over 24h change.",
  "Treat UP and DOWN symmetrically.",
].join(" ");

export function typeSafeJudge(opts: {
  apiKey: string;
  model: "jev-1.13.0";
}): Judge {
  if (!opts.apiKey) {
    throw new Error("TYPESAFE_API_KEY missing — refuse silent stub");
  }
  const client = new TypeSafeClient({ apiKey: opts.apiKey });

  return {
    async ask(facts: FactsForJev): Promise<JudgeOpinion> {
      const result = await client.systemOne({
        state: facts as unknown as EntryType,
        model: opts.model,
        questions: {
          direction: choice(DIRECTION_Q, {
            UP: "Bitcoin finishes UP vs the window open",
            DOWN: "Bitcoin finishes DOWN vs the window open",
          }),
        },
      });

      const answer = result.answers.direction;
      const side = answer.choice as Side;
      if (side !== "UP" && side !== "DOWN") {
        throw new Error(`unexpected Jev choice: ${String(answer.choice)}`);
      }
      const confidence = parseConfidence(answer.confidence);
      if (!confidence) {
        throw new Error(`invalid Jev confidence: ${answer.confidence}`);
      }
      const probs = {
        UP: Number(answer.probabilities.UP),
        DOWN: Number(answer.probabilities.DOWN),
      };
      return { side, confidence, probs };
    },
  };
}
