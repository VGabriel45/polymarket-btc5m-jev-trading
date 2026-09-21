import { composeFacts } from "./compose.js";
import { applyDry } from "./broker/dry.js";
import { assertDryRunOrThrow } from "./broker/live.js";
import {
  resolveWinner,
  secondsRemaining,
  windowHasEnded,
} from "./adapters/polymarket/wire.js";
import { appendPnL, readSummary, settlePnLUsd } from "./pnl/ledger.js";
import { planTrade, planWindowEndExit } from "./policy.js";
import {
  nowIso,
  type ActorHealth,
  type DomainMarket,
  type FactsForJev,
  type IntendedOrder,
  type JudgeOpinion,
  type PnLRecord,
  type Position,
  type Sample,
  type SessionConfig,
  type SpotPulse,
  type TickSnapshot,
  type TradeAction,
  type WindowPhase,
} from "./domain.js";

type ActorSlot<T> = {
  sample: Sample<T> | null;
  health: ActorHealth;
};

/**
 * Owns WindowPhase + Position. Position mutates only here.
 * Phases: awaiting_window → trading → settling → recorded → awaiting_window.
 */
export class WindowSession {
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
  private phase: WindowPhase = "awaiting_window";
  private position: Position = { kind: "flat" };
  private activeSlug: string | null = null;
  private lastOrder: IntendedOrder | null = null;
  private intentLog: IntendedOrder[] = [];
  private lastPnL: PnLRecord | null = null;
  private cumulativePnLUsd = 0;
  private stopLoop: (() => void) | null = null;

  private constructor(cfg: SessionConfig) {
    this.cfg = cfg;
  }

  static async open(cfg: SessionConfig): Promise<WindowSession> {
    const session = new WindowSession(cfg);
    const summary = await readSummary(cfg.pnlPath);
    session.cumulativePnLUsd = summary.cumulativeUsd;
    session.lastPnL = summary.last;
    return session;
  }

  /** Alias kept for callers that still import WatchSession. */
  static async openWatch(cfg: SessionConfig): Promise<WindowSession> {
    return WindowSession.open(cfg);
  }

  async tick(): Promise<TickSnapshot> {
    this.tickId += 1;
    const at = nowIso();

    await Promise.all([this.refreshMarket(), this.refreshSpot()]);

    if (this.phase === "awaiting_window") {
      return this.tickAwaiting(at);
    }
    if (this.phase === "settling" || this.phase === "recorded") {
      return this.tickSettleOrRecorded(at);
    }
    return this.tickTrading(at);
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
          onSnap(
            this.snapshot(
              nowIso(),
              null,
              null,
              {
                kind: "ABSTAIN",
                reason: { code: "JUDGE_FAILED", message },
              },
              null,
            ),
          );
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

  private async tickAwaiting(at: ReturnType<typeof nowIso>): Promise<TickSnapshot> {
    const m = this.market.sample;
    if (!m || !this.market.health.ok) {
      return this.snapshot(at, null, null, {
        kind: "ABSTAIN",
        reason: {
          code: "AWAITING_WINDOW",
          detail: this.market.health.ok
            ? "no market sample yet"
            : this.market.health.detail,
        },
      }, null);
    }

    const market = m.value;
    if (windowHasEnded(market, at) || !market.active) {
      return this.snapshot(at, null, null, {
        kind: "ABSTAIN",
        reason: {
          code: "AWAITING_WINDOW",
          detail: `slug=${market.eventSlug} closed/expired — polling for next 5m`,
        },
      }, secondsRemaining(market.endsAt, at));
    }

    if (this.activeSlug != null && market.eventSlug === this.activeSlug) {
      return this.snapshot(at, null, null, {
        kind: "ABSTAIN",
        reason: {
          code: "AWAITING_WINDOW",
          detail: `still on settled slug ${this.activeSlug}`,
        },
      }, secondsRemaining(market.endsAt, at));
    }

    this.activeSlug = market.eventSlug;
    this.position = { kind: "flat" };
    this.phase = "trading";
    return this.tickTrading(at);
  }

  private async tickTrading(at: ReturnType<typeof nowIso>): Promise<TickSnapshot> {
    const missing: Array<"market" | "spot"> = [];
    if (!this.market.sample) missing.push("market");
    if (!this.spot.sample) missing.push("spot");

    if (missing.length > 0) {
      const action: TradeAction =
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
      return this.snapshot(at, null, null, action, null);
    }

    const marketSample = this.market.sample!;
    const market = marketSample.value;

    if (windowHasEnded(market, at)) {
      this.phase = "settling";
      return this.tickSettleOrRecorded(at);
    }

    const composed = composeFacts(
      marketSample,
      this.spot.sample!,
      at,
      this.cfg.staleAfterMs,
      this.position,
      this.cfg.windowLengthSec,
    );

    if (!composed.ok) {
      return this.snapshot(at, null, null, {
        kind: "ABSTAIN",
        reason: { code: "STALE_INPUTS", detail: composed.detail },
      }, secondsRemaining(market.endsAt, at));
    }

    let opinion: JudgeOpinion;
    try {
      opinion = await this.cfg.judge.ask(composed.facts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.snapshot(at, composed.facts, null, {
        kind: "ABSTAIN",
        reason: { code: "JUDGE_FAILED", message },
      }, secondsRemaining(market.endsAt, at));
    }

    const action = planTrade(
      this.position,
      opinion,
      this.cfg.threshold,
      market,
      this.cfg.dryRunSize,
      at,
    );

    await this.execute(action, market, at);
    return this.snapshot(
      at,
      composed.facts,
      opinion,
      action,
      secondsRemaining(market.endsAt, at),
    );
  }

  private async tickSettleOrRecorded(
    at: ReturnType<typeof nowIso>,
  ): Promise<TickSnapshot> {
    const m = this.market.sample;
    if (!m) {
      return this.snapshot(at, null, null, {
        kind: "ABSTAIN",
        reason: { code: "SETTLING", detail: "no market for settle" },
      }, null);
    }

    const market = m.value;

    if (this.phase === "recorded") {
      if (!windowHasEnded(market, at) && market.active && market.eventSlug !== this.activeSlug) {
        this.phase = "awaiting_window";
        return this.tickAwaiting(at);
      }
      return this.snapshot(at, null, null, {
        kind: "ABSTAIN",
        reason: {
          code: "AWAITING_WINDOW",
          detail: "pnl recorded — waiting for next 5m slug",
        },
      }, secondsRemaining(market.endsAt, at));
    }

    let action: TradeAction = {
      kind: "ABSTAIN",
      reason: { code: "SETTLING", detail: `resolving ${market.eventSlug}` },
    };

    let exitPrice: number | null = null;
    const openBefore = this.position;

    if (openBefore.kind === "open") {
      const winner = resolveWinner(market);
      if (winner != null) {
        exitPrice = openBefore.side === winner ? 1 : 0;
        this.position = { kind: "flat" };
      } else {
        action = planWindowEndExit(openBefore, market, at);
        await this.execute(action, market, at);
        exitPrice = action.kind === "EXIT" ? action.order.price : null;
      }
    }

    const winner = resolveWinner(market);
    const positionSide = openBefore.kind === "open" ? openBefore.side : null;
    const entryPrice = openBefore.kind === "open" ? openBefore.entryPrice : null;
    const size = openBefore.kind === "open" ? openBefore.size : 0;
    const pnlUsd = settlePnLUsd({
      positionSide,
      winner,
      entryPrice,
      size,
      exitPrice: winner != null && openBefore.kind === "open" ? exitPrice : exitPrice,
    });

    const record: PnLRecord = {
      slug: market.eventSlug,
      settledAt: at,
      winner,
      positionSide,
      entryPrice,
      exitPrice,
      size,
      pnlUsd,
      mode: "dry-run",
    };

    await appendPnL(record, this.cfg.pnlPath);
    this.lastPnL = record;
    this.cumulativePnLUsd += pnlUsd;
    this.phase = "recorded";
    this.position = { kind: "flat" };

    return this.snapshot(
      at,
      null,
      null,
      action,
      secondsRemaining(market.endsAt, at),
    );
  }

  private async execute(
    action: TradeAction,
    market: DomainMarket,
    at: ReturnType<typeof nowIso>,
  ): Promise<void> {
    assertDryRunOrThrow(this.cfg.liveTrading);

    const result = applyDry(this.position, action, market, at);
    this.position = result.position;
    for (const order of result.orders) {
      await this.cfg.pen.record(order);
      this.lastOrder = order;
      this.intentLog.push(order);
      if (this.intentLog.length > 50) this.intentLog.shift();
    }
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

  private intentTail(): ReadonlyArray<IntendedOrder> {
    if (this.cfg.pen.tail) return this.cfg.pen.tail(12);
    return this.intentLog.slice(-12);
  }

  private snapshot(
    at: ReturnType<typeof nowIso>,
    facts: FactsForJev | null,
    opinion: JudgeOpinion | null,
    action: TradeAction,
    secondsRem: number | null | undefined,
  ): TickSnapshot {
    const m = this.market.sample;
    const s = this.spot.sample;
    const rem =
      secondsRem !== undefined
        ? secondsRem
        : m
          ? secondsRemaining(m.value.endsAt, at)
          : null;
    return {
      tickId: this.tickId,
      at,
      phase: this.phase,
      secondsRemaining: rem,
      position: this.position,
      action,
      market: m
        ? {
            slug: m.value.eventSlug,
            question: m.value.question,
            upMid: m.value.bySide.UP.mid,
            downMid: m.value.bySide.DOWN.mid,
            volume24hUsd: m.value.volume24hUsd,
            closed: m.value.closed,
            active: m.value.active,
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
      lastOrder: this.lastOrder,
      intentLogTail: this.intentTail(),
      lastPnL: this.lastPnL,
      cumulativePnLUsd: this.cumulativePnLUsd,
    };
  }
}

/** @deprecated Use WindowSession */
export const WatchSession = WindowSession;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
