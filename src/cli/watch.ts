import React from "react";
import { render } from "ink";
import { loadConfig } from "../config.js";
import { loadDotEnv } from "../loadEnv.js";
import { WatchSession } from "../session.js";
import { App } from "../tui/App.js";
import { parseCliFlags } from "./flags.js";

async function main(): Promise<void> {
  loadDotEnv();
  const flags = parseCliFlags(process.argv.slice(2));
  const cfg = loadConfig(process.env, {
    stubJudge: flags.stubJudge,
    fixedSpot: flags.fixedSpot,
    stubConfidence: flags.stubConfidence,
    stubSide: flags.stubSide,
  });

  const session = await WatchSession.open(cfg);

  const { waitUntilExit } = render(
    React.createElement(App, {
      subscribe: (emit) => session.run((snap) => emit(snap)),
    }),
  );

  await waitUntilExit();
  await session.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
