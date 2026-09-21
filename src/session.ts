import { composeFacts } from "./compose.js";
import { decide } from "./decide.js";
import {
  nowIso,
  type ActorHealth,
  type DomainMarket,
  type FactsForJev,
  type IntendedBuy,
  type JudgeOpinion,
  type Sample,
  type SessionConfig,
  type SpotPulse,
  type TickSnapshot,
  type Verdict,
} from "./domain.js";

type ActorSlot<T> = {
  sample: Sample<T> | null;
  health: ActorHealth;
};

/**
 * Sole deep public surface. Holds two private Sample slots; merge only in tick().
 */
export class WatchSession {
  private readonly cfg: SessionConfig;
  private readonly market: ActorSlot<DomainMarket> = {
    sample: null,
    health: { ok: true },
  };
  private readonly spot: ActorSlot<SpotPulse> = {
    sample: null,
    health: { ok: true },
  };
  private tickId = 0;
  private lastIntended: IntendedBuy | null = null;
  private intentLog: IntendedBuy[] = [];
  private stopLoop: (() => void) | null = null;

  private constructor(cfg: SessionConfig) {
    this.cfg = cfg;
  }

  static async open(cfg: SessionConfig): Promise<WatchSession> {
    return new WatchSession(cfg);
  }

  async tick(): Promise<TickSnapshot> {
    this.tickId += 1;
    const at = nowIso();

    await Promise.all([this.refreshMarket(), this.refreshSpot()]);

    const missing: Array<"market" | "spot"> = [];
    if (!this.market.sample) missing.push("market");
    if (!this.spot.sample) missing.push("spot");

    if (missing.length > 0) {
      const verdict: Verdict =
        missing.includes("market") && !this.market.health.ok
          ? {
              kind: "ABSTAIN",
              reason: {
                code: "MARKET_UNAVAILABLE",
                message:
                  this.market.health.ok === false
                    ? this.market.health.detail
                    : "market sample missing",
              },
            }
          : {
              kind: "ABSTAIN",
              reason: { code: "WORLD_INCOMPLETE", missing },
            };
      return this.snapshot(at, null, null, verdict);
    }

    const composed = composeFacts(
      this.market.sample!,
      this.spot.sample!,
      at,
      this.cfg.staleAfterMs,
    );

    if (!composed.ok) {
      return this.snapshot(at, null, null, {
        kind: "ABSTAIN",
        reason: { code: "STALE_INPUTS", detail: composed.detail },
      });
    }

    let opinion: JudgeOpinion;
    try {
      opinion = await this.cfg.judge.ask(composed.facts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.snapshot(at, composed.facts, null, {
        kind: "ABSTAIN",
        reason: { code: "JUDGE_FAILED", message },
      });
    }

    const verdict = decide(
      this.market.sample!.value,
      opinion,
      this.cfg.threshold,
      this.cfg.dryRunSize,
      at,
    );

    if (verdict.kind === "ACT") {
      await this.cfg.pen.record(verdict.intended);
      this.lastIntended = verdict.intended;
      this.intentLog.push(verdict.intended);
      if (this.intentLog.length > 50) this.intentLog.shift();
    }

    return this.snapshot(at, composed.facts, opinion, verdict);
  }

  run(onSnap: (s: TickSnapshot) => void): { stop: () => void } {
    let stopped = false;
    const loop = async () => {
      while (!stopped) {
        try {
          const snap = await this.tick();
          if (!stopped) onSnap(snap);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          onSnap({
            tickId: this.tickId,
            at: nowIso(),
            market: null,
            btc: null,
            health: {
              market: this.market.health,
              spot: this.spot.health,
            },
            factsPreview: null,
            opinion: null,
            verdict: {
              kind: "ABSTAIN",
              reason: { code: "JUDGE_FAILED", message },
            },
            lastIntended: this.lastIntended,
            intentLogTail: this.intentTail(),
          });
        }
        if (stopped) break;
        await sleep(this.cfg.tickMs);
      }
    };
    void loop();
    const stop = () => {
      stopped = true;
    };
    this.stopLoop = stop;
    return { stop };
  }

  async close(): Promise<void> {
    this.stopLoop?.();
    this.stopLoop = null;
  }

  private async refreshMarket(): Promise<void> {
    try {
      this.market.sample = await this.cfg.polymarket.pullActiveBtcUpDown();
      this.market.health = { ok: true };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.market.health = { ok: false, code: "transport", detail };
    }
  }

  private async refreshSpot(): Promise<void> {
    try {
      this.spot.sample = await this.cfg.spot.pullBtcPulse();
      this.spot.health = { ok: true };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.spot.health = { ok: false, code: "transport", detail };
    }
  }

  private intentTail(): ReadonlyArray<IntendedBuy> {
    if (this.cfg.pen.tail) return this.cfg.pen.tail(12);
    return this.intentLog.slice(-12);
  }

  private snapshot(
    at: ReturnType<typeof nowIso>,
    facts: FactsForJev | null,
    opinion: JudgeOpinion | null,
    verdict: Verdict,
  ): TickSnapshot {
    const m = this.market.sample;
    const s = this.spot.sample;
    return {
      tickId: this.tickId,
      at,
      market: m
        ? {
            slug: m.value.eventSlug,
            question: m.value.question,
            upMid: m.value.bySide.UP.mid,
            downMid: m.value.bySide.DOWN.mid,
            volume24hUsd: m.value.volume24hUsd,
            source: m.source,
          }
        : null,
      btc: s
        ? {
            last: s.value.last,
            change24hPct: s.value.change24hPct,
            volume24hQuote: s.value.volume24hQuote,
            source: s.source,
          }
        : null,
      health: {
        market: this.market.health,
        spot: this.spot.health,
      },
      factsPreview: facts,
      opinion,
      verdict,
      lastIntended: this.lastIntended,
      intentLogTail: this.intentTail(),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
