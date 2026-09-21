import React from "react";
import { Box, Text } from "ink";
import type { TickSnapshot, TradeAction } from "../domain.js";
import {
  bigText,
  chartGrid,
  countdownBar,
  depthBook,
  formatConfHero,
  formatMmSs,
  formatUsdCompact,
  gateBar,
  polymarketBanner,
} from "./art.js";

const G = "green" as const;
const GB = "greenBright" as const;
const Y = "yellow" as const;
const R = "red" as const;
const RB = "redBright" as const;
const WINDOW_SEC = 300;

function hhmmss(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(11, 19);
  } catch {
    return iso.slice(11, 19);
  }
}

function utcNow(): string {
  return new Date().toISOString().slice(11, 19) + " UTC";
}

function actionTitle(action: TradeAction): {
  color: string;
  hero: string;
  sub: string;
} {
  switch (action.kind) {
    case "ENTER":
      return { color: GB, hero: `BUY ${action.side}`, sub: "ENTER" };
    case "HOLD":
      return { color: GB, hero: `HOLD ${action.side}`, sub: "RIDE TO END" };
    case "EXIT":
      return { color: Y, hero: `SELL ${action.side}`, sub: action.reason };
    case "SWITCH":
      return { color: Y, hero: `FLIP ${action.to}`, sub: `${action.from}->${action.to}` };
    case "ABSTAIN":
      return { color: Y, hero: "WAIT", sub: "NO TRADE" };
    default: {
      const _e: never = action;
      return { color: G, hero: "???", sub: String(_e) };
    }
  }
}

function actionWhy(action: TradeAction, threshold: number): string {
  if (action.kind === "ABSTAIN") {
    const r = action.reason;
    if (r.code === "LOW_CONFIDENCE") {
      return `Jev says: ${r.side} but confidence ${r.confidence.toFixed(3)} <= ${threshold.toFixed(2)} gate - no entry.`;
    }
    if (r.code === "NO_EDGE") {
      return `NO EDGE ${r.side}: P=${r.pWin.toFixed(3)} vs ask ${r.ask.toFixed(3)} (need >=${r.need.toFixed(3)})`;
    }
    if (r.code === "TOO_LATE") return r.detail;
    if (r.code === "COOLDOWN") return r.detail;
    if (r.code === "MAX_TRADES") return r.detail;
    if (r.code === "AWAITING_WINDOW") return r.detail;
    if (r.code === "SETTLING") return r.detail;
    if (r.code === "JUDGE_FAILED") return r.message;
    if (r.code === "MARKET_UNAVAILABLE") return r.message;
    if (r.code === "STALE_INPUTS") return r.detail;
    if (r.code === "WORLD_INCOMPLETE") return `missing ${r.missing.join(",")}`;
    return "abstain";
  }
  return action.why;
}

function jevConf(snap: TickSnapshot): number | null {
  if (snap.opinion) return snap.opinion.confidence;
  if (
    snap.action.kind === "ABSTAIN" &&
    snap.action.reason.code === "LOW_CONFIDENCE"
  ) {
    return snap.action.reason.confidence;
  }
  if (snap.action.kind === "HOLD" || snap.action.kind === "ENTER") {
    return snap.action.confidence;
  }
  if (snap.action.kind === "SWITCH") return snap.action.confidence;
  return null;
}

function healthLabel(h: { ok: boolean }): {
  label: string;
  color: string;
} {
  if (h.ok) return { label: "Connected", color: GB };
  return { label: "Down", color: R };
}

function Big({
  text,
  color,
}: {
  text: string;
  color: string;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      {bigText(text).map((line, i) => (
        <Text key={i} color={color} bold>
          {line}
        </Text>
      ))}
    </Box>
  );
}

function Cell({
  label,
  children,
  width,
  borderColor = G,
}: {
  label: string;
  children: React.ReactNode;
  width: number;
  borderColor?: string;
}): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
      width={width}
    >
      <Text color={G} bold>
        {label}
      </Text>
      {children}
    </Box>
  );
}

/** Top chrome. */
export function TopBar({
  liveTrading,
  connected,
}: {
  liveTrading: boolean;
  connected: boolean;
}): React.ReactElement {
  return (
    <Box justifyContent="space-between" width={100}>
      <Text>
        <Text color={GB} bold>
          {" ◆ "}JEV-NODE
        </Text>
        <Text color={G}> Prediction Market Trading Bot</Text>
        <Text color={G}> - </Text>
        <Text color={GB} bold>
          POLYMARKET · BTC UP/DOWN 5M · {liveTrading ? "LIVE TRADING" : "DRY-RUN"}
        </Text>
      </Text>
      <Text>
        <Text color={connected ? GB : R} bold>
          {connected ? "● CONNECTED" : "○ OFFLINE"}
        </Text>
        <Text color={G}>  {utcNow()}</Text>
      </Text>
    </Box>
  );
}

export function NavBar(): React.ReactElement {
  return (
    <Box justifyContent="space-between" width={100} marginBottom={0}>
      <Text>
        <Text backgroundColor="green" color="black" bold>
          {" 1 Dashboard "}
        </Text>
        <Text color={G}>  2 Positions   3 History   4 Settings</Text>
      </Text>
      <Text color={G} dimColor>
        q quit   ? help
      </Text>
    </Box>
  );
}

export function MarketHeader({ snap }: { snap: TickSnapshot }): React.ReactElement {
  const m = snap.market;
  const rem = formatMmSs(snap.secondsRemaining);
  const vol = m ? formatUsdCompact(m.volume24hUsd) : "—";
  const chg = snap.btc
    ? `${snap.btc.change24hPct >= 0 ? "+" : ""}${snap.btc.change24hPct.toFixed(2)}%`
    : "—";
  const ends =
    m?.question?.match(/\d{1,2}:\d{2}/)?.[0] ??
    (snap.secondsRemaining != null ? `${rem} left` : "—");
  const banner = polymarketBanner();

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={G}
      paddingX={1}
      width={100}
    >
      {banner.map((line, i) => (
        <Text key={i} color={GB} bold>
          {line}
        </Text>
      ))}
      <Box justifyContent="space-between">
        <Text>
          <Text color={Y} bold>
            ₿{" "}
          </Text>
          <Text color={GB} bold>
            BTC UP OR DOWN (5 MIN)
          </Text>
          <Text color={G}>
            {"  "}Ends {ends} · {rem} left
          </Text>
        </Text>
        <Text color={G}>
          24H Vol {vol}
          {"  "}·{"  "}
          BTC 24h{" "}
          <Text color={snap.btc && snap.btc.change24hPct >= 0 ? GB : RB} bold>
            {chg}
          </Text>
          {snap.btc
            ? `  ·  vs open ${snap.btc.moveVsWindowOpenPct >= 0 ? "+" : ""}${snap.btc.moveVsWindowOpenPct.toFixed(3)}%`
            : ""}
        </Text>
      </Box>
      {m ? (
        <Text color={G} dimColor>
          {m.slug} · {m.active && !m.closed ? "ACTIVE" : m.closed ? "CLOSED" : "INACTIVE"} · src=
          {m.source}
        </Text>
      ) : (
        <Text color={R}>no market feed</Text>
      )}
    </Box>
  );
}

export function ChartAndDepth({
  snap,
  upTrail,
}: {
  snap: TickSnapshot;
  upTrail: readonly number[];
}): React.ReactElement {
  const m = snap.market;
  const mid = m?.upMid ?? 0.5;
  const chart = chartGrid(upTrail.length ? upTrail : [mid], 56, 8);
  const depth = depthBook({
    bid: m?.upBid ?? null,
    ask: m?.upAsk ?? null,
    mid,
    barWidth: 10,
  });
  const yHi = chart.max.toFixed(2);
  const yLo = chart.min.toFixed(2);
  const last = chart.last != null ? chart.last.toFixed(3) : mid.toFixed(3);

  return (
    <Box width={100}>
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={G}
        paddingX={1}
        width={72}
      >
        <Box justifyContent="space-between">
          <Text color={G} bold>
            LIVE PRICE (POLYMARKET UP)
          </Text>
          <Text color={G} dimColor>
            [5M]
          </Text>
        </Box>
        <Box>
          <Box flexDirection="column" marginRight={1}>
            <Text color={G} dimColor>
              {yHi}
            </Text>
            <Text color={G} dimColor>
              {" "}
            </Text>
            <Text color={G} dimColor>
              {" "}
            </Text>
            <Text color={G} dimColor>
              {yLo}
            </Text>
          </Box>
          <Box flexDirection="column">
            {chart.rows.map((row, i) => (
              <Text key={i} color={GB}>
                {row}
              </Text>
            ))}
          </Box>
          <Box flexDirection="column" marginLeft={1}>
            <Text color={GB} bold>
              ${last}
            </Text>
            <Text color={G} dimColor>
              NOW
            </Text>
          </Box>
        </Box>
        <Text color={G} dimColor>
          window path · samples {upTrail.length}
        </Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={G}
        paddingX={1}
        width={28}
      >
        <Text color={G} bold>
          MARKET DEPTH
        </Text>
        <Text color={RB} dimColor>
          Price    Size
        </Text>
        {depth.map((line, i) => (
          <Text
            key={i}
            color={line.startsWith("ASK") ? RB : line.startsWith("MID") ? Y : GB}
            bold={line.startsWith("MID")}
          >
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

export function StatsRow({ snap }: { snap: TickSnapshot }): React.ReactElement {
  const m = snap.market;
  const up = m?.upMid ?? 0;
  const down = m?.downMid ?? 0;
  const spr = m?.upSpread ?? (m?.upAsk != null && m?.upBid != null ? m.upAsk - m.upBid : null);
  const sprPct =
    spr != null && up > 0 ? `${((spr / up) * 100).toFixed(1)}%` : "—";
  const rem = formatMmSs(snap.secondsRemaining);
  const cd = countdownBar(snap.secondsRemaining, WINDOW_SEC, 14);
  const chg = snap.btc
    ? `${snap.btc.change24hPct >= 0 ? "+" : ""}${snap.btc.change24hPct.toFixed(2)}%`
    : "—";

  return (
    <Box width={100} gap={0}>
      <Cell label="UP PRICE" width={20}>
        <Text color={GB} bold>
          {up.toFixed(3)} ({Math.round(up * 100)}%)
        </Text>
      </Cell>
      <Cell label="DOWN PRICE" width={20} borderColor={R}>
        <Text color={RB} bold>
          {down.toFixed(3)} ({Math.round(down * 100)}%)
        </Text>
      </Cell>
      <Cell label="SPREAD" width={18}>
        <Text color={G} bold>
          {spr != null ? spr.toFixed(3) : "—"} ({sprPct})
        </Text>
      </Cell>
      <Cell label="24H VOLUME" width={20}>
        <Text color={G} bold>
          {m ? formatUsdCompact(m.volume24hUsd) : "—"}{" "}
          <Text color={snap.btc && snap.btc.change24hPct >= 0 ? GB : RB}>
            {chg}
          </Text>
        </Text>
      </Cell>
      <Cell label="TIME LEFT" width={22}>
        <Text color={GB} bold>
          {rem}
        </Text>
        <Text color={G}>[{cd}]</Text>
      </Cell>
    </Box>
  );
}

export function DecisionPanel({
  snap,
  threshold,
}: {
  snap: TickSnapshot;
  threshold: number;
}): React.ReactElement {
  const title = actionTitle(snap.action);
  const why = actionWhy(snap.action, threshold);
  const conf = jevConf(snap);
  const o = snap.opinion;
  const confVal = o?.confidence ?? conf;
  const lean = o?.side;

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={title.color}
      paddingX={1}
      width={58}
    >
      <Text color={G} bold>
        TRADING DECISION{" "}
        <Text color={G} dimColor>
          TICK #{snap.tickId} · {hhmmss(snap.at)}
        </Text>
      </Text>
      <Box marginY={0}>
        <Big text={title.hero} color={title.color} />
      </Box>
      <Text color={title.color} bold>
        {title.sub}
      </Text>

      {confVal != null ? (
        <>
          <Text color={GB} bold>
            CONFIDENCE {formatConfHero(confVal)}
            {lean ? (
              <Text color={lean === "UP" ? GB : RB}> (leans {lean})</Text>
            ) : null}
          </Text>
          <Text color={GB} bold>
            [{gateBar(confVal, threshold, 40)}]
          </Text>
          <Text color={G} dimColor>
            {" ".repeat(Math.max(0, Math.round(threshold * 40) - 6))}gate:{" "}
            {threshold.toFixed(2)}
          </Text>
          {o?.probs ? (
            <Text color={G}>
              P(UP) <Text color={GB} bold>{o.probs.UP.toFixed(3)}</Text>
              {"  /  "}
              P(DOWN) <Text color={RB} bold>{o.probs.DOWN.toFixed(3)}</Text>
            </Text>
          ) : null}
        </>
      ) : (
        <Text color={G}>no Jev read this tick</Text>
      )}

      <Box
        borderStyle="single"
        borderColor={Y}
        paddingX={1}
        marginTop={1}
        flexDirection="column"
      >
        <Text color={Y}>{why.slice(0, 72)}</Text>
      </Box>
    </Box>
  );
}

export function PositionPanel({
  snap,
}: {
  snap: TickSnapshot;
}): React.ReactElement {
  const p = snap.position;
  const open = p.kind === "open";
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={open ? GB : G}
      paddingX={1}
      width={42}
    >
      <Text color={G} bold>
        CURRENT POSITION
      </Text>
      {open ? (
        <>
          <Big text={p.side} color={GB} />
          <Text color={GB} bold>
            {p.side} ×{p.size} @ {p.entryPrice.toFixed(3)}
          </Text>
          <Text color={G}>
            Entry {p.entryPrice.toFixed(3)}
            {snap.factsPreview?.session.position.kind === "open"
              ? ` · Mark ${snap.factsPreview.session.position.mark.toFixed(3)}`
              : ""}
          </Text>
          <Text color={GB} bold>
            Unrealized{" "}
            {snap.unrealizedPnLUsd != null
              ? `${snap.unrealizedPnLUsd >= 0 ? "+" : ""}$${snap.unrealizedPnLUsd.toFixed(2)}`
              : "—"}
          </Text>
        </>
      ) : (
        <>
          <Big text="FLAT" color={G} />
          <Text color={G} dimColor>
            No open position
          </Text>
          <Text color={G}>Entry — · Size — · Unrealized —</Text>
        </>
      )}
      <Text color={snap.cumulativePnLUsd >= 0 ? GB : RB} bold>
        PnL (session): {snap.cumulativePnLUsd >= 0 ? "+" : ""}$
        {snap.cumulativePnLUsd.toFixed(2)}
      </Text>
    </Box>
  );
}

export function StatusPanel({
  snap,
  liveTrading,
  nextSec,
}: {
  snap: TickSnapshot;
  liveTrading: boolean;
  nextSec: number;
}): React.ReactElement {
  const m = healthLabel(snap.health.market);
  const s = healthLabel(snap.health.spot);
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={G}
      paddingX={1}
      width={42}
    >
      <Text color={G} bold>
        TRADING STATUS
      </Text>
      <Text color={G}>
        API{"          "}
        <Text color={GB}>Ready</Text>
        <Text color={G} dimColor>
          {" "}
          next {Math.max(0, nextSec)}s
        </Text>
      </Text>
      <Text color={G}>
        Polymarket{"   "}
        <Text color={m.color}>{m.label}</Text>
      </Text>
      <Text color={G}>
        Spot/BTC{"     "}
        <Text color={s.color}>{s.label}</Text>
      </Text>
      <Text color={G}>
        Jev Model{"    "}
        <Text color={snap.opinion ? GB : Y}>
          {snap.opinion ? "Ready" : "Idle"}
        </Text>
      </Text>
      <Text color={G}>
        Order Engine{" "}
        <Text color={liveTrading ? RB : G}>
          {liveTrading ? "LIVE" : "Dry-run"}
        </Text>
        <Text color={G} dimColor>
          {" "}
          {snap.phase}
        </Text>
      </Text>
    </Box>
  );
}

export function DecisionsTable({
  snap,
}: {
  snap: TickSnapshot;
}): React.ReactElement {
  const rows = snap.decisionLog.slice(-6);
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={G}
      paddingX={1}
      width={58}
    >
      <Text color={G} bold>
        RECENT DECISIONS
      </Text>
      <Text color={G} dimColor>
        {"TIME     TICK  DECISION  CONF   ACTION"}
      </Text>
      {rows.length === 0 ? (
        <Text color={G} dimColor>
          empty
        </Text>
      ) : (
        rows.map((d, i) => (
          <Text key={`${d.tickId}-${i}`} color={G} dimColor>
            {hhmmss(d.at)}  #{String(d.tickId).padStart(3, "0")}  {d.kind.padEnd(8)}{" "}
            {d.conf != null ? d.conf.toFixed(3) : "  —  "}  {d.summary.slice(0, 28)}
          </Text>
        ))
      )}
    </Box>
  );
}

export function EventLog({ snap }: { snap: TickSnapshot }): React.ReactElement {
  const rows = snap.activityLog.slice(-7);
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={G}
      paddingX={1}
      width={42}
    >
      <Box justifyContent="space-between">
        <Text color={G} bold>
          EVENT LOG
        </Text>
        <Text color={GB} bold>
          ● LIVE
        </Text>
      </Box>
      {rows.length === 0 ? (
        <Text color={G} dimColor>
          empty
        </Text>
      ) : (
        rows.map((a, i) => (
          <Text
            key={`${a.at}-${a.op}-${i}`}
            color={!a.ok ? R : G}
            dimColor={a.ok}
          >
            {hhmmss(a.at)} [{a.channel}] {a.op}
            {a.ms != null ? ` ${a.ms}ms` : ""}
          </Text>
        ))
      )}
    </Box>
  );
}

export function Footer(): React.ReactElement {
  return (
    <Box width={100}>
      <Text color={GB} bold>
        JEV v0.1.0
      </Text>
    </Box>
  );
}

/** @deprecated aliases */
export const HeaderBar = TopBar;
export const MarketBoard = ChartAndDepth;
export const DecisionBoard = DecisionPanel;
export const DecisionLogPanel = DecisionsTable;
export const ActivityLogPanel = EventLog;
export const OrderLogPanel = Footer;
export const ActionBanner = DecisionPanel;
export const VoiceLine = () => null;
export const StatusRow = () => null;
export const FeedsRow = () => null;
export const BrainRow = () => null;
export const ActionPanel = DecisionPanel;
export const IntentLogPanel = Footer;
export const VerdictPanel = DecisionPanel;
