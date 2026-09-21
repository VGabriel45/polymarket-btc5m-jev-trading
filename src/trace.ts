import type { IsoTime, JudgeOpinion, Side, TradeAction } from "./domain.js";
import { nowIso } from "./domain.js";

export type ActivityChannel =
  | "gamma"
  | "binance"
  | "jev"
  | "clob"
  | "policy"
  | "pnl"
  | "sys";

export type ActivityEntry = {
  at: IsoTime;
  channel: ActivityChannel;
  op: string;
  detail: string;
  ms?: number;
  ok: boolean;
};

export type DecisionEntry = {
  at: IsoTime;
  tickId: number;
  kind: string;
  summary: string;
  conf?: number;
  side?: Side;
};

const MAX_ACT = 48;
const MAX_DEC = 24;

export class TraceRing {
  readonly activity: ActivityEntry[] = [];
  readonly decisions: DecisionEntry[] = [];

  pushActivity(entry: Omit<ActivityEntry, "at"> & { at?: IsoTime }): void {
    this.activity.push({ at: entry.at ?? nowIso(), ...entry });
    while (this.activity.length > MAX_ACT) this.activity.shift();
  }

  pushDecision(entry: Omit<DecisionEntry, "at"> & { at?: IsoTime }): void {
    this.decisions.push({ at: entry.at ?? nowIso(), ...entry });
    while (this.decisions.length > MAX_DEC) this.decisions.shift();
  }

  async timed<T>(
    channel: ActivityChannel,
    op: string,
    fn: () => Promise<T>,
    detailOk?: (v: T) => string,
  ): Promise<T> {
    const t0 = Date.now();
    try {
      const v = await fn();
      this.pushActivity({
        channel,
        op,
        detail: detailOk ? detailOk(v) : "ok",
        ms: Date.now() - t0,
        ok: true,
      });
      return v;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.pushActivity({
        channel,
        op,
        detail: detail.slice(0, 80),
        ms: Date.now() - t0,
        ok: false,
      });
      throw err;
    }
  }
}

/** Dry pit-trader / console cowboy one-liners. */
export function voiceLine(
  action: TradeAction,
  _opinion: JudgeOpinion | null,
  threshold: number,
): string {
  switch (action.kind) {
    case "ENTER":
      return `// ${action.why}`;
    case "HOLD":
      return `// ${action.why}`;
    case "EXIT":
      return `// ${action.why}`;
    case "SWITCH":
      return `// ${action.why}`;
    case "ABSTAIN": {
      const r = action.reason;
      if (r.code === "LOW_CONFIDENCE") {
        return `// NO ENTRY. Jev ${r.side} @ ${r.confidence.toFixed(3)} — need >${threshold.toFixed(2)}.`;
      }
      if (r.code === "NO_EDGE") {
        return `// NO EDGE ${r.side}: P=${r.pWin.toFixed(3)} need ≥${r.need.toFixed(3)} (ask ${r.ask.toFixed(3)}).`;
      }
      if (r.code === "COOLDOWN") {
        return `// COOLDOWN — ${r.detail}`;
      }
      if (r.code === "MAX_TRADES") {
        return `// MAX TRADES — ${r.detail}`;
      }
      if (r.code === "AWAITING_WINDOW") {
        return `// SCANNING… next 5m window.`;
      }
      if (r.code === "SETTLING") {
        return `// WINDOW END. Counting chips.`;
      }
      if (r.code === "JUDGE_FAILED") {
        return `// JEV LINK DOWN: ${r.message.slice(0, 60)}`;
      }
      if (r.code === "MARKET_UNAVAILABLE") {
        return `// GAMMA SILENT: ${r.message.slice(0, 60)}`;
      }
      if (r.code === "STALE_INPUTS") {
        return `// STALE FEED — ${r.detail.slice(0, 50)}.`;
      }
      if (r.code === "WORLD_INCOMPLETE") {
        return `// MISSING NODES: ${r.missing.join("+")}.`;
      }
      return `// ABSTAIN. Watching the board.`;
    }
    default: {
      const _e: never = action;
      return String(_e);
    }
  }
}

export function summarizeAction(action: TradeAction): {
  kind: string;
  summary: string;
  conf?: number;
  side?: Side;
} {
  switch (action.kind) {
    case "ENTER":
      return {
        kind: "ENTER",
        summary: action.why.slice(0, 72),
        conf: action.confidence,
        side: action.side,
      };
    case "HOLD":
      return {
        kind: "HOLD",
        summary: action.why.slice(0, 72),
        conf: action.confidence,
        side: action.side,
      };
    case "EXIT":
      return {
        kind: "EXIT",
        summary: action.why.slice(0, 72),
        side: action.side,
      };
    case "SWITCH":
      return {
        kind: "SWITCH",
        summary: action.why.slice(0, 72),
        conf: action.confidence,
        side: action.to,
      };
    case "ABSTAIN": {
      const r = action.reason;
      if (r.code === "LOW_CONFIDENCE") {
        return {
          kind: "ABSTAIN",
          summary: `wait ${r.side} ${r.confidence.toFixed(3)}`,
          conf: r.confidence,
          side: r.side,
        };
      }
      if (r.code === "NO_EDGE") {
        return {
          kind: "ABSTAIN",
          summary: `no_edge ${r.side} P=${r.pWin.toFixed(2)} ask=${r.ask.toFixed(2)}`,
          side: r.side,
        };
      }
      if (r.code === "COOLDOWN" || r.code === "MAX_TRADES") {
        return { kind: "ABSTAIN", summary: r.detail.slice(0, 56) };
      }
      return { kind: "ABSTAIN", summary: r.code.toLowerCase() };
    }
    default: {
      const _e: never = action;
      return { kind: "?", summary: String(_e) };
    }
  }
}

export function confBar(conf: number, threshold: number, width = 24): string {
  const filled = Math.max(0, Math.min(width, Math.round(conf * width)));
  const gate = Math.max(0, Math.min(width - 1, Math.round(threshold * width)));
  let out = "";
  for (let i = 0; i < width; i++) {
    if (i === gate) out += "║";
    else if (i < filled) out += "█";
    else out += "░";
  }
  return out;
}
