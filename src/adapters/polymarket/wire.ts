import { asIsoTime, asTokenId, type DomainMarket, type Side } from "../../domain.js";

export type GammaMarketWire = {
  question?: string;
  conditionId?: string;
  condition_id?: string;
  clobTokenIds?: string | string[];
  outcomes?: string | string[];
  endDate?: string;
  end_date_iso?: string;
  volume24hr?: number | string;
  volume_24hr?: number | string;
};

export type GammaEventWire = {
  slug?: string;
  title?: string;
  markets?: GammaMarketWire[];
};

export type ClobSideQuotes = {
  mid: number | null;
  spread: number | null;
  lastTrade: number | null;
  bestBid: number | null;
  bestAsk: number | null;
};

function parseJsonArray(v: string | string[] | undefined): string[] {
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

export function activeBtcUpDownSlug(nowMs = Date.now()): string {
  const windowSec = Math.floor(nowMs / 1000 / 900) * 900;
  return `btc-updown-15m-${windowSec}`;
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
    const mid = q.mid ?? 0.5;
    bySide[side] = {
      tokenId: asTokenId(tokenId),
      outcomeLabel: outcomes[i]!,
      mid,
      bestBid: q.bestBid,
      bestAsk: q.bestAsk,
      spread: q.spread,
      lastTrade: q.lastTrade,
    };
  }

  if (!bySide.UP || !bySide.DOWN) {
    throw new Error("could not map Up/Down outcomes from gamma market");
  }

  const endsRaw = market.endDate ?? market.end_date_iso ?? null;
  const vol = toNum(market.volume24hr ?? market.volume_24hr) ?? 0;

  return {
    eventSlug: event.slug ?? "unknown",
    question: market.question ?? event.title ?? "Bitcoin Up or Down",
    conditionId: String(market.conditionId ?? market.condition_id ?? ""),
    endsAt: endsRaw ? asIsoTime(endsRaw) : null,
    volume24hUsd: vol,
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
