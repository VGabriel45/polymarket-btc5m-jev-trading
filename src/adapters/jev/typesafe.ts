import { TypeSafeClient, choice, type EntryType } from "@typesafe-ai/sdk";
import {
  parseConfidence,
  type FactsForJev,
  type Judge,
  type JudgeOpinion,
  type Side,
} from "../../domain.js";

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
          direction: choice(
            "Given this BTC Up/Down Polymarket window and spot pulse, which outcome is more likely?",
            {
              UP: "Bitcoin finishes UP vs the window open",
              DOWN: "Bitcoin finishes DOWN vs the window open",
            },
          ),
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
