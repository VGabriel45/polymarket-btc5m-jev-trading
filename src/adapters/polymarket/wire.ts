import {
  asIsoTime,
  asTokenId,
  type DomainMarket,
  type IsoTime,
  type Side,
} from "../../domain.js";

export type GammaMarketWire = {
  question?: string;
  conditionId?: string;
  condition_id?: string;
  clobTokenIds?: string | string[];
  outcomes?: string | string[];
  outcomePrices?: string | string[] | number[];
  endDate?: string;
  end_date_iso?: string;
  volume24hr?: number | string;
  volume_24hr?: number | string;
  closed?: boolean;
  active?: boolean;
};

export type GammaEventWire = {
  slug?: string;
  title?: string;
  closed?: boolean;
  active?: boolean;
  markets?: GammaMarketWire[];
};

export type ClobSideQuotes = {
  mid: number | null;
  spread: number | null;
  lastTrade: number | null;
  bestBid: number | null;
  bestAsk: number | null;
};

const WINDOW_SEC = 300;

function parseJsonArray(v: string | string[] | number[] | undefined): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(String);
  try {
    const parsed = JSON.parse(v) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function classifyOutcome(label: string): Side | null {
  const t = label.trim().toLowerCase();
  if (t === "up" || t === "yes") return "UP";
  if (t === "down" || t === "no") return "DOWN";
  return null;
}

/** Active Polymarket BTC Up/Down 5-minute window slug. */
export function activeBtcUpDownSlug(nowMs = Date.now()): string {
  const windowSec = Math.floor(nowMs / 1000 / WINDOW_SEC) * WINDOW_SEC;
  return `btc-updown-5m-${windowSec}`;
}

export function secondsRemaining(
  endsAt: IsoTime | string | null,
  now: IsoTime | string | number = Date.now(),
): number | null {
  if (endsAt == null) return null;
  const endMs = Date.parse(String(endsAt));
  if (!Number.isFinite(endMs)) return null;
  const nowMs = typeof now === "number" ? now : Date.parse(String(now));
  if (!Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.floor((endMs - nowMs) / 1000));
}

/** Derive window end from `btc-updown-5m-{unixStart}` when Gamma omits endDate. */
export function endsAtFromSlug(slug: string): IsoTime | null {
  const m = /btc-updown-(?:5m|15m)-(\d+)$/.exec(slug);
  if (!m) return null;
  const startSec = Number(m[1]);
  if (!Number.isFinite(startSec)) return null;
  const windowSec = slug.includes("-15m-") ? 900 : WINDOW_SEC;
  return asIsoTime(new Date((startSec + windowSec) * 1000).toISOString());
}

export function effectiveEndsAt(market: DomainMarket): IsoTime | null {
  return market.endsAt ?? endsAtFromSlug(market.eventSlug);
}

export function windowHasEnded(
  market: DomainMarket,
  now: IsoTime | string | number = Date.now(),
): boolean {
  if (market.closed) return true;
  const rem = secondsRemaining(effectiveEndsAt(market), now);
  return rem !== null && rem <= 0;
}

/**
 * True when the live feed has moved on from the window we were trading,
 * or the held window's clock/closed flag says it's over.
 */
export function shouldCloseWindow(args: {
  activeSlug: string | null;
  position: { kind: "flat" } | { kind: "open"; slug: string };
  market: DomainMarket;
  now?: IsoTime | string | number;
}): boolean {
  const { activeSlug, position, market } = args;
  const now = args.now ?? Date.now();
  const heldSlug =
    position.kind === "open" ? position.slug : activeSlug;

  if (heldSlug != null && market.eventSlug !== heldSlug) {
    return true; // gamma already serving next window
  }
  if (heldSlug != null && activeBtcUpDownSlug(
    typeof now === "number" ? now : Date.parse(String(now)),
  ) !== heldSlug) {
    return true; // wall clock rolled past held slug
  }
  if (heldSlug == null || market.eventSlug === heldSlug) {
    if (market.closed || !market.active) return true;
    if (windowHasEnded(market, now)) return true;
  }
  return false;
}

/**
 * Resolve binary winner from Gamma outcomePrices / closed mids.
 * Winning share price ≈ 1, losing ≈ 0.
 */
export function resolveWinner(market: DomainMarket): Side | null {
  const prices = market.outcomePrices;
  if (prices) {
    const up = prices.UP;
    const down = prices.DOWN;
    if (up != null && down != null) {
      if (up >= 0.95 && down <= 0.05) return "UP";
      if (down >= 0.95 && up <= 0.05) return "DOWN";
      if (up > down && up >= 0.7) return "UP";
      if (down > up && down >= 0.7) return "DOWN";
    }
  }
  if (market.closed) {
    const upMid = market.bySide.UP.mid;
    const downMid = market.bySide.DOWN.mid;
    if (upMid >= 0.95 && downMid <= 0.05) return "UP";
    if (downMid >= 0.95 && upMid <= 0.05) return "DOWN";
  }
  return null;
}

function mapOutcomePrices(
  outcomes: string[],
  rawPrices: string[],
): DomainMarket["outcomePrices"] {
  if (rawPrices.length === 0) return null;
  const mapped: { UP: number | null; DOWN: number | null } = {
    UP: null,
    DOWN: null,
  };
  for (let i = 0; i < outcomes.length; i++) {
    const side = classifyOutcome(outcomes[i]!);
    if (!side) continue;
    mapped[side] = toNum(rawPrices[i]);
  }
  return mapped;
}

/** Drop a CLOB top-of-book print that is a stub wing far from mid. */
function saneTop(top: number | null, mid: number): number | null {
  if (top == null || !Number.isFinite(top)) return null;
  if (Math.abs(top - mid) > 0.25) return null;
  return top;
}

/**
 * Map a Gamma event (+ optional CLOB quotes) into DomainMarket.
 * Outcomes matched by name (Up/Down); token IDs from clobTokenIds.
 */
export function domainMarketFromGamma(
  event: GammaEventWire,
  quotesByToken: Record<string, ClobSideQuotes>,
): DomainMarket {
  const market = event.markets?.[0];
  if (!market) {
    throw new Error("gamma event has no markets");
  }

  const outcomes = parseJsonArray(market.outcomes);
  const tokenIds = parseJsonArray(market.clobTokenIds);
  if (outcomes.length < 2 || tokenIds.length < 2) {
    throw new Error("gamma market missing outcomes or clobTokenIds");
  }

  const mappedPrices = mapOutcomePrices(
    outcomes,
    parseJsonArray(market.outcomePrices),
  );

  const bySide = {} as DomainMarket["bySide"];
  for (let i = 0; i < outcomes.length; i++) {
    const side = classifyOutcome(outcomes[i]!);
    if (!side) continue;
    const tokenId = tokenIds[i]!;
    const q = quotesByToken[tokenId] ?? {
      mid: null,
      spread: null,
      lastTrade: null,
      bestBid: null,
      bestAsk: null,
    };
    const gammaPx = mappedPrices?.[side] ?? null;
    const mid = q.mid ?? gammaPx ?? 0.5;
    const bestBid = saneTop(q.bestBid, mid);
    const bestAsk = saneTop(q.bestAsk, mid);
    bySide[side] = {
      tokenId: asTokenId(tokenId),
      outcomeLabel: outcomes[i]!,
      mid,
      bestBid,
      bestAsk,
      spread: q.spread,
      lastTrade: q.lastTrade,
    };
  }

  if (!bySide.UP || !bySide.DOWN) {
    throw new Error("could not map Up/Down outcomes from gamma market");
  }

  const endsRaw = market.endDate ?? market.end_date_iso ?? null;
  const vol = toNum(market.volume24hr ?? market.volume_24hr) ?? 0;
  const closed = Boolean(market.closed ?? event.closed ?? false);
  const active = market.active ?? event.active ?? !closed;
  const eventSlug = event.slug ?? "unknown";
  const endsAt = endsRaw
    ? asIsoTime(endsRaw)
    : endsAtFromSlug(eventSlug);

  return {
    eventSlug,
    question: market.question ?? event.title ?? "Bitcoin Up or Down",
    conditionId: String(market.conditionId ?? market.condition_id ?? ""),
    endsAt,
    volume24hUsd: vol,
    closed,
    active: Boolean(active),
    outcomePrices: mappedPrices,
    bySide,
  };
}

/** Domain-shaped fixture JSON → DomainMarket (re-brands token ids). */
export function domainMarketFromDomainJson(raw: unknown): DomainMarket {
  const o = raw as DomainMarket;
  if (!o?.bySide?.UP?.tokenId || !o?.bySide?.DOWN?.tokenId) {
    throw new Error("fixture missing bySide.UP/DOWN");
  }
  return {
    eventSlug: o.eventSlug,
    question: o.question,
    conditionId: o.conditionId,
    endsAt: o.endsAt ? asIsoTime(o.endsAt) : null,
    volume24hUsd: o.volume24hUsd,
    closed: Boolean(o.closed ?? false),
    active: o.active !== false,
    outcomePrices: o.outcomePrices ?? null,
    bySide: {
      UP: {
        ...o.bySide.UP,
        tokenId: asTokenId(String(o.bySide.UP.tokenId)),
      },
      DOWN: {
        ...o.bySide.DOWN,
        tokenId: asTokenId(String(o.bySide.DOWN.tokenId)),
      },
    },
  };
}

export class TransportError extends Error {
  readonly kind = "transport" as const;
  readonly status: number;
  readonly code?: string;

  constructor(message: string, opts?: { status?: number; code?: string; cause?: unknown }) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "TransportError";
    this.status = opts?.status ?? 0;
    this.code = opts?.code;
  }
}

export function isTransportFailure(err: unknown): boolean {
  if (err instanceof TransportError) return err.status === 0;
  if (err == null) return false;
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|UND_ERR/.test(code);
}

export async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(12_000),
    });
  } catch (e) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code: unknown }).code)
        : undefined;
    throw new TransportError(`fetch failed: ${url}`, {
      status: 0,
      code,
      cause: e,
    });
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  return res.json();
}
