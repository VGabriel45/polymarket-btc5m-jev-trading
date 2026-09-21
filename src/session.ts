import { composeFacts } from "./compose.js";
import {
  resolveWinner,
  secondsRemaining,
  shouldCloseWindow,
  windowHasEnded,
  effectiveEndsAt,
} from "./adapters/polymarket/wire.js";
import { appendPnL, markUnrealizedUsd, readSummary, settlePnLUsd } from "./pnl/ledger.js";
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
import { summarizeAction, TraceRing, voiceLine } from "./trace.js";

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
  private readonly trace = new TraceRing();
  private tickId = 0;
  private phase: WindowPhase = "awaiting_window";
  private position: Position = { kind: "flat" };
  private activeSlug: string | null = null;
  /** Last market sample for the window we are/were trading (settle after rollover). */
  private heldMarket: DomainMarket | null = null;
  /** BTC price when the current 5m window was entered (for true moveVsWindowOpenPct). */
  private windowOpenBtc: number | null = null;
  private entersThisWindow = 0;
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
    session.trace.pushActivity({
      channel: "sys",
      op: "boot",
      detail: `live=${cfg.liveTrading} threshold=${cfg.threshold} betUsd=${cfg.betUsd}`,
      ok: true,
    });
    return session;
  }

  /** Alias kept for callers that still import WatchSession. */
  static async openWatch(cfg: SessionConfig): Promise<WindowSession> {
    return WindowSession.open(cfg);
  }

  async tick(): Promise<TickSnapshot> {
    this.tickId += 1;
    const at = nowIso();
    this.trace.pushActivity({
      channel: "sys",
      op: "tick",
      detail: `#${this.tickId} phase=${this.phase}`,
      ok: true,
      at,
    });

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
          this.trace.pushActivity({
            channel: "sys",
            op: "tick_error",
            detail: message.slice(0, 80),
            ok: false,
          });
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
    this.trace.pushActivity({
      channel: "sys",
      op: "shutdown",
      detail: "operator quit",
      ok: true,
    });
  }

  private async tickAwaiting(at: ReturnType<typeof nowIso>): Promise<TickSnapshot> {
    const m = this.market.sample;
    if (!m || !this.market.health.ok) {
      return this.snapshot(
        at,
        null,
        null,
        {
          kind: "ABSTAIN",
          reason: {
            code: "AWAITING_WINDOW",
            detail: this.market.health.ok
              ? "no market sample yet"
              : this.market.health.detail,
          },
        },
        null,
      );
    }

    const market = m.value;
    if (windowHasEnded(market, at) || !market.active) {
      return this.snapshot(
        at,
        null,
        null,
        {
          kind: "ABSTAIN",
          reason: {
            code: "AWAITING_WINDOW",
            detail: `slug=${market.eventSlug} closed/expired — polling for next 5m`,
          },
        },
        secondsRemaining(market.endsAt, at),
      );
    }

    if (this.activeSlug != null && market.eventSlug === this.activeSlug) {
      return this.snapshot(
        at,
        null,
        null,
        {
          kind: "ABSTAIN",
          reason: {
            code: "AWAITING_WINDOW",
            detail: `still on settled slug ${this.activeSlug}`,
          },
        },
        secondsRemaining(market.endsAt, at),
      );
    }

    this.activeSlug = market.eventSlug;
    this.heldMarket = market;
    this.position = { kind: "flat" };
    this.windowOpenBtc = this.spot.sample?.value.last ?? null;
    this.entersThisWindow = 0;
    this.phase = "trading";
    this.trace.pushActivity({
      channel: "sys",
      op: "window_open",
      detail: `${market.eventSlug} btcOpen=${this.windowOpenBtc ?? "?"}`,
      ok: true,
    });
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

    // Keep a snapshot of the window we are trading so settle works after Gamma rolls.
    if (
      this.activeSlug != null &&
      market.eventSlug === this.activeSlug
    ) {
      this.heldMarket = market;
    } else if (
      this.position.kind === "open" &&
      market.eventSlug === this.position.slug
    ) {
      this.heldMarket = market;
    }

    if (
      shouldCloseWindow({
        activeSlug: this.activeSlug,
        position: this.position,
        market,
        now: at,
      })
    ) {
      this.trace.pushActivity({
        channel: "sys",
        op: "window_close",
        detail: `held=${this.activeSlug ?? (this.position.kind === "open" ? this.position.slug : "?")} feed=${market.eventSlug}`,
        ok: true,
      });
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
      this.windowOpenBtc,
    );

    if (!composed.ok) {
      return this.snapshot(
        at,
        null,
        null,
        {
          kind: "ABSTAIN",
          reason: { code: "STALE_INPUTS", detail: composed.detail },
        },
        secondsRemaining(effectiveEndsAt(market), at),
      );
    }

    let opinion: JudgeOpinion;
    try {
      opinion = await this.trace.timed(
        "jev",
        "ask",
        () => this.cfg.judge.ask(composed.facts),
        (o) => `${o.side} conf=${o.confidence.toFixed(3)}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.snapshot(
        at,
        composed.facts,
        null,
        {
          kind: "ABSTAIN",
          reason: { code: "JUDGE_FAILED", message },
        },
        secondsRemaining(effectiveEndsAt(market), at),
      );
    }

    const rem = secondsRemaining(effectiveEndsAt(market), at);
    const action = planTrade(this.position, opinion, market, at, {
      threshold: this.cfg.threshold,
      betUsd: this.cfg.betUsd,
      maxAsk: this.cfg.maxAsk,
      minEdge: this.cfg.minEdge,
      minSecondsToEnter: this.cfg.minSecondsToEnter,
      secondsRemaining: rem,
      maxEntersPerWindow: this.cfg.maxEntersPerWindow,
      entersThisWindow: this.entersThisWindow,
    });
    this.trace.pushActivity({
      channel: "policy",
      op: "planTrade",
      detail: summarizeAction(action).summary,
      ok: true,
    });

    await this.execute(action, market, at);
    return this.snapshot(at, composed.facts, opinion, action, rem);
  }

  /** Resolve the DomainMarket that matches an open position's slug. */
  private async marketForSettle(
    openSlug: string,
    feed: DomainMarket,
  ): Promise<DomainMarket> {
    if (feed.eventSlug === openSlug) return feed;
    if (this.heldMarket?.eventSlug === openSlug) {
      // Prefer a fresh pull of the closed slug for outcomePrices when possible.
      if (this.cfg.polymarket.pullBySlug) {
        try {
          const sample = await this.trace.timed(
            "gamma",
            "pullBySlug",
            () => this.cfg.polymarket.pullBySlug!(openSlug),
            (s) =>
              `${s.value.closed ? "closed" : "open"} winner? prices=${JSON.stringify(s.value.outcomePrices)}`,
          );
          this.heldMarket = sample.value;
          return sample.value;
        } catch {
          return this.heldMarket;
        }
      }
      return this.heldMarket;
    }
    if (this.cfg.polymarket.pullBySlug) {
      try {
        const sample = await this.cfg.polymarket.pullBySlug(openSlug);
        this.heldMarket = sample.value;
        return sample.value;
      } catch {
        /* fall through */
      }
    }
    return this.heldMarket ?? feed;
  }

  private async tickSettleOrRecorded(
    at: ReturnType<typeof nowIso>,
  ): Promise<TickSnapshot> {
    const m = this.market.sample;
    if (!m) {
      return this.snapshot(
        at,
        null,
        null,
        {
          kind: "ABSTAIN",
          reason: { code: "SETTLING", detail: "no market for settle" },
        },
        null,
      );
    }

    const feed = m.value;

    if (this.phase === "recorded") {
      // Ready for next window once feed is a live, different slug.
      if (
        !windowHasEnded(feed, at) &&
        feed.active &&
        !feed.closed &&
        feed.eventSlug !== this.activeSlug
      ) {
        this.phase = "awaiting_window";
        this.activeSlug = null;
        this.heldMarket = null;
        this.windowOpenBtc = null;
        return this.tickAwaiting(at);
      }
      return this.snapshot(
        at,
        null,
        null,
        {
          kind: "ABSTAIN",
          reason: {
            code: "AWAITING_WINDOW",
            detail: "pnl recorded — waiting for next 5m slug",
          },
        },
        secondsRemaining(effectiveEndsAt(feed), at),
      );
    }

    let action: TradeAction = {
      kind: "ABSTAIN",
      reason: {
        code: "SETTLING",
        detail: `closing ${this.activeSlug ?? (this.position.kind === "open" ? this.position.slug : feed.eventSlug)}`,
      },
    };

    const openBefore = this.position;

    if (openBefore.kind === "open") {
      const settleMkt = await this.marketForSettle(openBefore.slug, feed);
      const winner = resolveWinner(settleMkt);

      this.trace.pushActivity({
        channel: "sys",
        op: "settle",
        detail: `slug=${openBefore.slug} winner=${winner ?? "unknown"} closed=${settleMkt.closed}`,
        ok: true,
      });

      if (winner != null) {
        const exitPrice = openBefore.side === winner ? 1 : 0;
        await this.bookRealized({
          slug: openBefore.slug,
          at,
          side: openBefore.side,
          entryPrice: openBefore.entryPrice,
          exitPrice,
          size: openBefore.size,
          winner,
          reason: "settle",
        });
        this.position = { kind: "flat" };
        action = {
          kind: "ABSTAIN",
          reason: {
            code: "SETTLING",
            detail: `settled ${openBefore.side} → winner ${winner} @$${exitPrice}`,
          },
        };
      } else {
        // No official winner yet — flatten. If the book is already dead, mark PnL
        // locally instead of posting a CLOB sell into a closed market.
        action = planWindowEndExit(openBefore, settleMkt, at);
        const bookDead =
          settleMkt.closed || windowHasEnded(settleMkt, at);
        if (bookDead && action.kind === "EXIT") {
          await this.bookRealized({
            slug: openBefore.slug,
            at,
            side: openBefore.side,
            entryPrice: openBefore.entryPrice,
            exitPrice: action.order.price,
            size: openBefore.size,
            winner: null,
            reason: "window_end",
          });
          this.position = { kind: "flat" };
          this.trace.pushActivity({
            channel: "sys",
            op: "force_flat",
            detail: `closed book — marked exit @${action.order.price}`,
            ok: true,
          });
        } else {
          await this.execute(action, settleMkt, at);
        }
      }
    }

    this.phase = "recorded";
    this.position = { kind: "flat" };

    // If feed already shows the next window, roll forward immediately.
    if (
      !windowHasEnded(feed, at) &&
      feed.active &&
      !feed.closed &&
      feed.eventSlug !== this.activeSlug
    ) {
      this.phase = "awaiting_window";
      this.activeSlug = null;
      this.heldMarket = null;
      this.windowOpenBtc = null;
      return this.tickAwaiting(at);
    }

    return this.snapshot(
      at,
      null,
      null,
      action,
      secondsRemaining(effectiveEndsAt(feed), at),
    );
  }

  private async bookRealized(args: {
    slug: string;
    at: ReturnType<typeof nowIso>;
    side: import("./domain.js").Side;
    entryPrice: number;
    exitPrice: number;
    size: number;
    winner: import("./domain.js").Side | null;
    reason: PnLRecord["reason"];
  }): Promise<void> {
    const pnlUsd = settlePnLUsd({
      positionSide: args.side,
      winner: args.winner,
      entryPrice: args.entryPrice,
      size: args.size,
      exitPrice: args.exitPrice,
    });
    const record: PnLRecord = {
      slug: args.slug,
      settledAt: args.at,
      winner: args.winner,
      positionSide: args.side,
      entryPrice: args.entryPrice,
      exitPrice: args.exitPrice,
      size: args.size,
      pnlUsd,
      mode: this.cfg.liveTrading ? "live" : "dry-run",
      reason: args.reason,
    };
    await this.trace.timed(
      "pnl",
      "append",
      async () => {
        await appendPnL(record, this.cfg.pnlPath);
      },
      () => `${args.reason} pnl=$${pnlUsd.toFixed(2)}`,
    );
    this.lastPnL = record;
    this.cumulativePnLUsd += pnlUsd;
  }

  private async execute(
    action: TradeAction,
    market: DomainMarket,
    at: ReturnType<typeof nowIso>,
  ): Promise<void> {
    const openBefore = this.position;

    const channel = this.cfg.liveTrading ? "clob" : "policy";
    const result = await this.trace.timed(
      channel,
      this.cfg.liveTrading ? "live.apply" : "dry.apply",
      () => this.cfg.executor.apply(this.position, action, market, at),
      (r) =>
        r.orders.length === 0
          ? "no-op"
          : r.orders.map((o) => `${o.side} ${o.outcome}`).join(","),
    );

    // Book realized PnL only after a real fill changed the position.
    if (openBefore.kind === "open" && result.position.kind === "flat") {
      const exitOrder =
        action.kind === "EXIT"
          ? result.orders[0]
          : action.kind === "SWITCH"
            ? result.orders[0]
            : null;
      if (exitOrder) {
        await this.bookRealized({
          slug: market.eventSlug,
          at,
          side: openBefore.side,
          entryPrice: openBefore.entryPrice,
          exitPrice: exitOrder.price,
          size: openBefore.size,
          winner: null,
          reason:
            action.kind === "SWITCH"
              ? "switch"
              : action.kind === "EXIT" && action.reason === "window_end"
                ? "window_end"
                : action.kind === "EXIT" && action.reason === "confidence_floor"
                  ? "confidence_floor"
                  : "exit",
        });
      }
    } else if (
      openBefore.kind === "open" &&
      action.kind === "SWITCH" &&
      result.position.kind === "open" &&
      result.orders.length >= 2
    ) {
      await this.bookRealized({
        slug: market.eventSlug,
        at,
        side: openBefore.side,
        entryPrice: openBefore.entryPrice,
        exitPrice: result.orders[0]!.price,
        size: openBefore.size,
        winner: null,
        reason: "switch",
      });
    }

    this.position = result.position;
    // Count ENTER only when we actually opened (FOK may kill with no fill).
    if (
      action.kind === "ENTER" &&
      openBefore.kind === "flat" &&
      result.position.kind === "open"
    ) {
      this.entersThisWindow += 1;
    }
    for (const order of result.orders) {
      await this.cfg.pen.record(order);
      this.lastOrder = order;
      this.intentLog.push(order);
      if (this.intentLog.length > 50) this.intentLog.shift();
    }
  }

  private async refreshMarket(): Promise<void> {
    try {
      this.market.sample = await this.trace.timed(
        "gamma",
        "pullActiveBtcUpDown",
        () => this.cfg.polymarket.pullActiveBtcUpDown(),
        (s) => `${s.source} ${s.value.eventSlug}`,
      );
      this.market.health = { ok: true };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.market.health = { ok: false, code: "transport", detail };
    }
  }

  private async refreshSpot(): Promise<void> {
    try {
      this.spot.sample = await this.trace.timed(
        "binance",
        "pullBtcPulse",
        () => this.cfg.spot.pullBtcPulse(),
        (s) => `${s.source} $${s.value.last.toFixed(0)}`,
      );
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
          ? secondsRemaining(effectiveEndsAt(m.value), at)
          : null;

    const sum = summarizeAction(action);
    this.trace.pushDecision({
      at,
      tickId: this.tickId,
      kind: sum.kind,
      summary: sum.summary,
      conf: sum.conf,
      side: sum.side,
    });

    const voice = voiceLine(action, opinion, this.cfg.threshold);

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
            upBid: m.value.bySide.UP.bestBid,
            upAsk: m.value.bySide.UP.bestAsk,
            downBid: m.value.bySide.DOWN.bestBid,
            downAsk: m.value.bySide.DOWN.bestAsk,
            upSpread: m.value.bySide.UP.spread,
            downSpread: m.value.bySide.DOWN.spread,
            volume24hUsd: m.value.volume24hUsd,
            closed: m.value.closed,
            active: m.value.active,
            source: m.source,
            conditionId: m.value.conditionId,
          }
        : null,
      btc: s
        ? {
            last: s.value.last,
            change24hPct: s.value.change24hPct,
            high24h: s.value.high24h,
            low24h: s.value.low24h,
            volume24hQuote: s.value.volume24hQuote,
            moveVsWindowOpenPct: s.value.moveVsWindowOpenPct,
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
      unrealizedPnLUsd: markUnrealizedUsd(
        this.position,
        m?.value ?? null,
      ),
      decisionLog: this.trace.decisions.slice(),
      activityLog: this.trace.activity.slice(),
      tickMs: this.cfg.tickMs,
      voice,
    };
  }
}

/** @deprecated Use WindowSession */
export const WatchSession = WindowSession;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
