export type CliFlags = {
  stubJudge: boolean;
  stubConfidence?: number;
  stubSide?: "UP" | "DOWN";
};

/** Shared argv parse for watch / once. */
export function parseCliFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { stubJudge: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--stub-judge") {
      flags.stubJudge = true;
    } else if (a === "--stub-confidence" || a.startsWith("--stub-confidence=")) {
      const v = a.includes("=") ? a.split("=")[1]! : argv[++i]!;
      flags.stubConfidence = Number(v);
      flags.stubJudge = true;
    } else if (a === "--stub-side" || a.startsWith("--stub-side=")) {
      const v = (a.includes("=") ? a.split("=")[1]! : argv[++i]!) as "UP" | "DOWN";
      flags.stubSide = v;
      flags.stubJudge = true;
    } else if (a === "--once") {
      // accepted for `npm run tick -- --once` compatibility
    }
  }
  return flags;
}
