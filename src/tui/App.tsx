import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { TickSnapshot } from "../domain.js";
import { jevSplashLine, polymarketMark } from "./art.js";
import {
  ChartAndDepth,
  DecisionPanel,
  DecisionsTable,
  EventLog,
  Footer,
  MarketHeader,
  NavBar,
  PositionPanel,
  StatsRow,
  StatusPanel,
  TopBar,
} from "./panels.js";

const UP_TRAIL_CAP = 64;

export type AppProps = {
  subscribe: (emit: (snap: TickSnapshot) => void) => { stop: () => void };
  liveTrading: boolean;
  threshold: number;
  betUsd: number;
  tickMs: number;
};

export function App({
  subscribe,
  liveTrading,
  threshold,
  betUsd: _betUsd,
  tickMs,
}: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [snap, setSnap] = useState<TickSnapshot | null>(null);
  const [nextSec, setNextSec] = useState(Math.ceil(tickMs / 1000));
  const [deadline, setDeadline] = useState<number | null>(null);
  const [upTrail, setUpTrail] = useState<number[]>([]);
  const trailSlugRef = useRef<string | null>(null);

  useInput((input, key) => {
    if (input === "q" || key.escape) exit();
  });

  useEffect(() => {
    const { stop } = subscribe((s) => {
      setSnap(s);
      setDeadline(Date.now() + (s.tickMs || tickMs));

      const slug = s.market?.slug ?? null;
      setUpTrail((prev) => {
        let trail = prev;
        if (slug !== trailSlugRef.current) {
          trailSlugRef.current = slug;
          trail = [];
        }
        const mid = s.market?.upMid;
        if (mid == null || !Number.isFinite(mid)) return trail;
        const next = trail.concat(mid);
        return next.length > UP_TRAIL_CAP
          ? next.slice(next.length - UP_TRAIL_CAP)
          : next;
      });
    });
    return () => stop();
  }, [subscribe, tickMs]);

  useEffect(() => {
    if (deadline == null) return;
    const id = setInterval(() => {
      setNextSec(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 200);
    return () => clearInterval(id);
  }, [deadline]);

  if (!snap) {
    return (
      <Box padding={1} flexDirection="column" alignItems="center">
        {polymarketMark().map((line, i) => (
          <Text key={i} color="cyan" bold>
            {line}
          </Text>
        ))}
        <Text color="gray">{jevSplashLine("0.1.0")}</Text>
        <Text color="green">linking gamma + binance + jev…</Text>
        <Text color="green" dimColor>
          q quit
        </Text>
      </Box>
    );
  }

  const connected =
    snap.health.market.ok && snap.health.spot.ok;

  return (
    <Box flexDirection="column" paddingX={1} gap={0}>
      <TopBar liveTrading={liveTrading} connected={connected} />
      <NavBar />
      <MarketHeader snap={snap} />
      <ChartAndDepth snap={snap} upTrail={upTrail} />
      <StatsRow snap={snap} />
      <Box>
        <DecisionPanel snap={snap} threshold={threshold} />
        <Box flexDirection="column">
          <PositionPanel snap={snap} />
          <StatusPanel
            snap={snap}
            liveTrading={liveTrading}
            nextSec={nextSec}
          />
        </Box>
      </Box>
      <Box>
        <DecisionsTable snap={snap} />
        <EventLog snap={snap} />
      </Box>
      <Footer />
    </Box>
  );
}
