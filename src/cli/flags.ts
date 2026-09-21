export type CliFlags = {
  stubJudge: boolean;
  /** Offline smoke also pins spot; set alongside stubJudge by CLI flags. */
  fixedSpot: boolean;
  stubConfidence?: number;
  stubSide?: "UP" | "DOWN";
};

export function parseCliFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { stubJudge: false, fixedSpot: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--stub-judge") {
      flags.stubJudge = true;
      flags.fixedSpot = true;
    } else if (a === "--stub-confidence" || a.startsWith("--stub-confidence=")) {
      const v = a.includes("=") ? a.split("=")[1]! : argv[++i]!;
      flags.stubConfidence = Number(v);
      flags.stubJudge = true;
      flags.fixedSpot = true;
    } else if (a === "--stub-side" || a.startsWith("--stub-side=")) {
      const v = (a.includes("=") ? a.split("=")[1]! : argv[++i]!) as "UP" | "DOWN";
      flags.stubSide = v;
      flags.stubJudge = true;
      flags.fixedSpot = true;
    } else if (a === "--fixed-spot") {
      flags.fixedSpot = true;
    }
  }
  return flags;
}
