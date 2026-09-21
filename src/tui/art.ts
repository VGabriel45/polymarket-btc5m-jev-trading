/** Terminal art as pure string helpers. Presentation only. */

export type AsciiBlock = readonly string[];

const BLOCKS = "▁▂▃▄▅▆▇█";

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Small hex-ish mark for the top bar. */
export function jevHexMark(): AsciiBlock {
  return [" ◆ ", "JEV"];
}

/** Loading splash: solid block POLYMARKET (CLAUDE-BOT style). */
export function polymarketMark(): AsciiBlock {
  return [
    "████   ███  █     █   █ █   █  ███  ████  █  █  ████  █████",
    "█  █  █   █ █     █   █ ██ ██ █   █ █  █  █ █   █       █  ",
    "████  █   █ █      ███  █ █ █ █████ ████  ██    ███     █  ",
    "█     █   █ █       █   █   █ █   █ █ █   █ █   █       █  ",
    "█      ███  ████    █   █   █ █   █ █  █  █  █  ████    █  ",
  ];
}

/** Dashboard label only. No diamond / cross glyph. */
export function polymarketBanner(): AsciiBlock {
  return ["P✦O✦L✦Y✦M✦A✦R✦K✦E✦T"];
}

/** Subtitle under the splash wordmark. */
export function jevSplashLine(version = "0.1.0"): string {
  return `JEV v${version}`;
}

export function meter(
  ratio: number,
  width: number,
  opts?: { fill?: string; empty?: string },
): string {
  const w = Math.max(0, Math.floor(width));
  if (w === 0) return "";
  const fill = opts?.fill ?? "█";
  const empty = opts?.empty ?? "░";
  const n = Math.round(clamp01(ratio) * w);
  return fill.repeat(n) + empty.repeat(w - n);
}

/** Confidence bar with a gate marker at threshold. */
export function gateBar(
  conf: number,
  threshold: number,
  width: number,
): string {
  const w = Math.max(8, Math.floor(width));
  const filled = Math.max(0, Math.min(w, Math.round(clamp01(conf) * w)));
  const gate = Math.max(0, Math.min(w - 1, Math.round(clamp01(threshold) * w)));
  let out = "";
  for (let i = 0; i < w; i++) {
    if (i === gate) out += "┃";
    else if (i < filled) out += "█";
    else out += "░";
  }
  return out;
}

export function sparkline(samples: readonly number[], width: number): string {
  const w = Math.max(0, Math.floor(width));
  if (w === 0) return "";
  if (samples.length === 0) return "·".repeat(w);

  const slice =
    samples.length <= w ? samples : samples.slice(samples.length - w);
  let min = Infinity;
  let max = -Infinity;
  for (const v of slice) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "·".repeat(w);

  const range = max - min || 1;
  const chars: string[] = [];
  for (const v of slice) {
    if (!Number.isFinite(v)) {
      chars.push("·");
      continue;
    }
    const t = (v - min) / range;
    chars.push(BLOCKS[Math.min(7, Math.floor(t * 8))]!);
  }
  return chars.join("").padStart(w, " ");
}

/**
 * Multi-row price chart (share or spot). Newest on the right.
 * Returns `height` plot lines + optional axis labels separately.
 */
export function chartGrid(
  samples: readonly number[],
  width: number,
  height: number,
): { rows: string[]; min: number; max: number; last: number | null } {
  const w = Math.max(8, Math.floor(width));
  const h = Math.max(4, Math.floor(height));
  if (samples.length === 0) {
    return {
      rows: Array.from({ length: h }, () => "·".repeat(w)),
      min: 0,
      max: 1,
      last: null,
    };
  }
  const slice =
    samples.length <= w ? [...samples] : samples.slice(samples.length - w);
  while (slice.length < w) slice.unshift(slice[0]!);

  let min = Infinity;
  let max = -Infinity;
  for (const v of slice) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  const pad = (max - min) * 0.08 || 0.01;
  min -= pad;
  max += pad;
  const range = max - min || 1;

  const rows: string[] = Array.from({ length: h }, () => "");
  for (let x = 0; x < w; x++) {
    const v = slice[x]!;
    const y = Math.round(((v - min) / range) * (h - 1));
    const row = h - 1 - Math.max(0, Math.min(h - 1, y));
    for (let r = 0; r < h; r++) {
      let ch = " ";
      if (r === row) ch = "█";
      else if (r > row) ch = "│";
      rows[r] = rows[r]! + ch;
    }
  }
  return { rows, min, max, last: slice[slice.length - 1]! };
}

export function countdownBar(
  secondsLeft: number | null,
  windowSec: number,
  width: number,
): string {
  if (secondsLeft == null || !(windowSec > 0)) return meter(0, width);
  return meter(secondsLeft / windowSec, width);
}

export function oddsDuel(
  upMid: number,
  downMid: number,
  width: number,
): { upBar: string; downBar: string; upPct: string; downPct: string } {
  const up = clamp01(upMid);
  const down = clamp01(downMid);
  return {
    upBar: meter(up, width),
    downBar: meter(down, width),
    upPct: `${(up * 100).toFixed(0)}%`.padStart(4),
    downPct: `${(down * 100).toFixed(0)}%`.padStart(4),
  };
}

/** Synthetic top-of-book depth rows from best bid/ask/mid. */
export function depthBook(args: {
  bid: number | null;
  ask: number | null;
  mid: number;
  barWidth?: number;
}): AsciiBlock {
  const bw = args.barWidth ?? 12;
  const mid = args.mid;
  const ask = args.ask ?? Math.min(0.99, mid + 0.01);
  const bid = args.bid ?? Math.max(0.01, mid - 0.01);
  const ask2 = Math.min(0.99, ask + 0.015);
  const bid2 = Math.max(0.01, bid - 0.015);
  const bar = (n: number) => "█".repeat(Math.max(1, Math.round(n * bw)));
  return [
    `ASK  ${ask2.toFixed(3)}  ${bar(0.35)}`,
    `ASK  ${ask.toFixed(3)}  ${bar(0.7)}`,
    `MID  ${mid.toFixed(3)}  ◄`,
    `BID  ${bid.toFixed(3)}  ${bar(0.7)}`,
    `BID  ${bid2.toFixed(3)}  ${bar(0.35)}`,
  ];
}

export function formatUsdCompact(n: number): string {
  if (!Number.isFinite(n)) return "$—";
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export function formatMmSs(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "--:--";
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** 3-row block glyphs for hero labels. */
const GLYPH: Record<string, AsciiBlock> = {
  "0": ["█▀█", "█ █", "█▄█"],
  "1": ["▄█ ", " █ ", "▄█▄"],
  "2": ["▀▀█", "█▀▀", "█▄▄"],
  "3": ["▀▀█", " ▀█", "▄▄█"],
  "4": ["█ █", "█▄█", "  █"],
  "5": ["█▀▀", "▀▀█", "▄▄█"],
  "6": ["█▀▀", "█▀█", "█▄█"],
  "7": ["▀▀█", "  █", "  █"],
  "8": ["█▀█", "█▀█", "█▄█"],
  "9": ["█▀█", "█▄█", "▄▄█"],
  ".": ["   ", "   ", " ▄ "],
  "%": ["█ █", " ▄ ", "█ █"],
  "+": ["   ", "▄█▄", " █ "],
  "-": ["   ", "▄▄▄", "   "],
  " ": ["  ", "  ", "  "],
  $: ["▄█▄", "█▀ ", "▀█▀"],
  A: ["▄█▄", "█▀█", "█ █"],
  B: ["█▀▄", "█▀▄", "█▄▀"],
  D: ["█▀▄", "█ █", "█▄▀"],
  E: ["█▀▀", "█▀ ", "█▄▄"],
  F: ["█▀▀", "█▀ ", "█  "],
  H: ["█ █", "█▀█", "█ █"],
  I: ["▀█▀", " █ ", "▄█▄"],
  L: ["█  ", "█  ", "█▄▄"],
  N: ["█▄█", "█▀█", "█ █"],
  O: ["▄█▄", "█ █", "▀█▀"],
  P: ["█▀▄", "█▀▀", "█  "],
  R: ["█▀▄", "█▀▄", "█ █"],
  S: ["▄▀▀", " ▀▄", "▄▄▀"],
  T: ["▀█▀", " █ ", " █ "],
  U: ["█ █", "█ █", "▀█▀"],
  W: ["█ █", "█▄█", "█▀█"],
  Y: ["█ █", " ▀█", " █ "],
};

const FALLBACK: AsciiBlock = ["███", "███", "███"];

export function bigText(raw: string): AsciiBlock {
  const chars = [...raw.toUpperCase()];
  const rows: string[] = ["", "", ""];
  for (const ch of chars) {
    const g = GLYPH[ch] ?? FALLBACK;
    for (let r = 0; r < 3; r++) {
      rows[r] = `${rows[r]}${rows[r] ? " " : ""}${g[r]}`;
    }
  }
  return rows;
}

export function formatConfHero(conf: number): string {
  return `${Math.round(clamp01(conf) * 100)}%`;
}
