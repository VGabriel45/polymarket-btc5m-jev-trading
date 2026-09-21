import { loadConfig } from "../config.js";
import { loadDotEnv } from "../loadEnv.js";
import { WindowSession } from "../session.js";
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

  const session = await WindowSession.open(cfg);
  const snap = await session.tick();
  console.log(JSON.stringify(snap, null, 2));
  await session.close();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
