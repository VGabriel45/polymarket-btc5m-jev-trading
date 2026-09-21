import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { TickSnapshot } from "../domain.js";
import {
  ActionPanel,
  BtcPanel,
  HealthPanel,
  IntentLogPanel,
  MarketPanel,
  OpinionPanel,
  PhasePanel,
  PnLPanel,
  PositionPanel,
} from "./panels.js";

export type AppProps = {
  subscribe: (emit: (snap: TickSnapshot) => void) => { stop: () => void };
};

export function App({ subscribe }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [snap, setSnap] = useState<TickSnapshot | null>(null);

  useInput((input, key) => {
    if (input === "q" || key.escape) exit();
  });

  useEffect(() => {
    const { stop } = subscribe((s) => setSnap(s));
    return () => stop();
  }, [subscribe]);

  if (!snap) {
    return (
      <Box padding={1}>
        <Text color="cyan">btc-updown-jev · waiting for first tick… (q quit)</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1} gap={1}>
      <Text bold color="whiteBright">
        btc-updown-jev{" "}
        <Text dimColor>5m dry-run · never posts · press q to quit</Text>
      </Text>
      <Box gap={1}>
        <PhasePanel snap={snap} />
        <PositionPanel snap={snap} />
        <PnLPanel snap={snap} />
      </Box>
      <Box gap={1}>
        <MarketPanel snap={snap} />
        <BtcPanel snap={snap} />
        <HealthPanel snap={snap} />
      </Box>
      <Box gap={1}>
        <OpinionPanel snap={snap} />
      </Box>
      <ActionPanel snap={snap} />
      <IntentLogPanel snap={snap} />
    </Box>
  );
}
