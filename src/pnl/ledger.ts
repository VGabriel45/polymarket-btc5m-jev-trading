import { mkdir, appendFile, readFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PnLRecord, PnLSummary } from "../domain.js";

const DEFAULT_PATH = "data/pnl.jsonl";

export function defaultPnLPath(): string {
  return resolve(DEFAULT_PATH);
}

export async function appendPnL(
  record: PnLRecord,
  path: string = defaultPnLPath(),
): Promise<void> {
  const abs = resolve(path);
  await mkdir(dirname(abs), { recursive: true });
  await appendFile(abs, `${JSON.stringify(record)}\n`, "utf8");
}

export async function readRecords(
  path: string = defaultPnLPath(),
): Promise<PnLRecord[]> {
  const abs = resolve(path);
  try {
    await access(abs);
  } catch {
    return [];
  }
  const raw = await readFile(abs, "utf8");
  const out: PnLRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as PnLRecord);
    } catch {
      // skip corrupt lines
    }
  }
  return out;
}

export async function readSummary(
  path: string = defaultPnLPath(),
): Promise<PnLSummary> {
  const records = await readRecords(path);
  const cumulativeUsd = records.reduce((s, r) => s + r.pnlUsd, 0);
  return {
    count: records.length,
    cumulativeUsd,
    last: records.length > 0 ? records[records.length - 1]! : null,
  };
}

/** Binary settle: winner shares ≈ $1, loser ≈ $0. Early exit uses exitPrice. */
export function settlePnLUsd(args: {
  positionSide: string | null;
  winner: string | null;
  entryPrice: number | null;
  size: number;
  exitPrice?: number | null;
}): number {
  if (args.positionSide == null || args.entryPrice == null || args.size <= 0) {
    return 0;
  }
  if (args.exitPrice != null) {
    return args.size * (args.exitPrice - args.entryPrice);
  }
  if (args.winner == null) return 0;
  const settlePrice = args.positionSide === args.winner ? 1 : 0;
  return args.size * (settlePrice - args.entryPrice);
}

/** Mark open shares to best bid (fallback mid). */
export function markUnrealizedUsd(
  position: { kind: "flat" } | { kind: "open"; side: string; size: number; entryPrice: number },
  market: {
    bySide: Record<
      string,
      { bestBid: number | null; mid: number }
    >;
  } | null,
): number | null {
  if (position.kind !== "open" || !market) return null;
  const q = market.bySide[position.side];
  if (!q) return null;
  const mark =
    q.bestBid != null && Math.abs(q.bestBid - q.mid) <= 0.25
      ? q.bestBid
      : q.mid;
  return position.size * (mark - position.entryPrice);
}
