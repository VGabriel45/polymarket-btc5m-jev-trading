import React from "react";
import { Box, Text } from "ink";
import type { TickSnapshot } from "../domain.js";

function healthLabel(h: TickSnapshot["health"]["market"]): string {
  if (h.ok) return "ok";
  return `${h.code}: ${h.detail.slice(0, 48)}`;
}

function verdictBanner(snap: TickSnapshot): { color: string; text: string } {
  const v = snap.verdict;
  if (v.kind === "ACT") {
    return {
      color: "green",
      text: `ACT  ${v.side}  conf=${v.confidence.toFixed(3)}  buy@${v.intended.price}`,
    };
  }
  const r = v.reason;
  switch (r.code) {
    case "LOW_CONFIDENCE":
      return {
        color: "yellow",
        text: `ABSTAIN LOW_CONFIDENCE  ${r.side}  conf=${r.confidence.toFixed(3)}`,
      };
    case "WORLD_INCOMPLETE":
      return {
        color: "red",
        text: `ABSTAIN WORLD_INCOMPLETE  missing=${r.missing.join(",")}`,
      };
    case "JUDGE_FAILED":
      return { color: "red", text: `ABSTAIN JUDGE_FAILED  ${r.message}` };
    case "MARKET_UNAVAILABLE":
      return { color: "red", text: `ABSTAIN MARKET_UNAVAILABLE  ${r.message}` };
    case "STALE_INPUTS":
      return { color: "magenta", text: `ABSTAIN STALE_INPUTS  ${r.detail}` };
    default: {
      const _exhaustive: never = r;
      return { color: "white", text: String(_exhaustive) };
    }
  }
}

export function MarketPanel({ snap }: { snap: TickSnapshot }): React.ReactElement {
  const m = snap.market;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={46}>
      <Text color="cyan" bold>
        Polymarket BTC Up/Down
      </Text>
      {m ? (
        <>
          <Text dimColor>{m.slug}</Text>
          <Text>{m.question.slice(0, 42)}</Text>
          <Text>
            <Text color="green">UP {m.upMid.toFixed(3)}</Text>
            {"  "}
            <Text color="red">DOWN {m.downMid.toFixed(3)}</Text>
          </Text>
          <Text dimColor>
            vol24h ${Math.round(m.volume24hUsd).toLocaleString()} · src={m.source}
          </Text>
        </>
      ) : (
        <Text color="red">no market sample</Text>
      )}
    </Box>
  );
}

export function BtcPanel({ snap }: { snap: TickSnapshot }): React.ReactElement {
  const b = snap.btc;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} width={36}>
      <Text color="yellow" bold>
        BTC Pulse
      </Text>
      {b ? (
        <>
          <Text>
            last <Text bold>${b.last.toLocaleString()}</Text>
          </Text>
          <Text color={b.change24hPct >= 0 ? "green" : "red"}>
            24h {b.change24hPct >= 0 ? "+" : ""}
            {b.change24hPct.toFixed(2)}%
          </Text>
          <Text dimColor>
            quoteVol {b.volume24hQuote.toExponential(2)} · src={b.source}
          </Text>
        </>
      ) : (
        <Text color="red">no spot sample</Text>
      )}
    </Box>
  );
}

export function HealthPanel({ snap }: { snap: TickSnapshot }): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} width={40}>
      <Text bold>Health</Text>
      <Text>
        market{" "}
        <Text color={snap.health.market.ok ? "green" : "red"}>
          {healthLabel(snap.health.market)}
        </Text>
      </Text>
      <Text>
        spot{" "}
        <Text color={snap.health.spot.ok ? "green" : "red"}>
          {healthLabel(snap.health.spot)}
        </Text>
      </Text>
      <Text dimColor>
        tick #{snap.tickId} · {snap.at}
      </Text>
    </Box>
  );
}

export function OpinionPanel({ snap }: { snap: TickSnapshot }): React.ReactElement {
  const o = snap.opinion;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} width={40}>
      <Text color="magenta" bold>
        Jev Opinion
      </Text>
      {o ? (
        <>
          <Text>
            side <Text bold>{o.side}</Text> · conf {o.confidence.toFixed(3)}
          </Text>
          {o.probs ? (
            <Text dimColor>
              P(UP)={o.probs.UP.toFixed(3)} P(DOWN)={o.probs.DOWN.toFixed(3)}
            </Text>
          ) : null}
        </>
      ) : (
        <Text dimColor>no opinion this tick</Text>
      )}
    </Box>
  );
}

export function VerdictPanel({ snap }: { snap: TickSnapshot }): React.ReactElement {
  const banner = verdictBanner(snap);
  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={banner.color}
      paddingX={1}
      width={82}
    >
      <Text color={banner.color} bold>
        {banner.text}
      </Text>
    </Box>
  );
}

export function IntentLogPanel({ snap }: { snap: TickSnapshot }): React.ReactElement {
  const tail = snap.intentLogTail;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} width={82}>
      <Text color="green" bold>
        Intent log (dry-run)
      </Text>
      {tail.length === 0 ? (
        <Text dimColor>empty</Text>
      ) : (
        tail.slice(-6).map((row, i) => (
          <Text key={`${row.idempotencyKey}-${i}`} dimColor={i < tail.length - 1}>
            BUY {row.outcome} @{row.price} ×{row.size} · {row.idempotencyKey.slice(0, 24)}…
          </Text>
        ))
      )}
    </Box>
  );
}
