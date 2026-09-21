import { loadConfig } from "../config.js";
import { WatchSession } from "../session.js";
import { parseCliFlags } from "./flags.js";

async function main(): Promise<void> {
  const flags = parseCliFlags(process.argv.slice(2));
  const cfg = loadConfig(process.env, {
    stubJudge: flags.stubJudge,
    stubConfidence: flags.stubConfidence,
    stubSide: flags.stubSide,
  });

  const session = await WatchSession.open(cfg);
  const snap = await session.tick();
  console.log(JSON.stringify(snap, null, 2));
  await session.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
