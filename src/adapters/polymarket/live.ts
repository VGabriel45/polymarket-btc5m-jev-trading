import { ClobClient } from "@polymarket/clob-client";
import {
  asIsoTime,
  nowIso,
  type DomainMarket,
  type MarketSource,
  type Sample,
} from "../../domain.js";
import {
  activeBtcUpDownSlug,
  domainMarketFromGamma,
  fetchJson,
  type ClobSideQuotes,
  type GammaEventWire,
} from "./wire.js";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

async function resolveEvent(slug: string): Promise<GammaEventWire> {
  const data = await fetchJson(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`);
  if (Array.isArray(data) && data.length > 0) {
    return data[0] as GammaEventWire;
  }
  const markets = await fetchJson(
    `${GAMMA}/markets?slug=${encodeURIComponent(slug)}`,
  );
  if (Array.isArray(markets) && markets.length > 0) {
    return { slug, markets: markets as GammaEventWire["markets"] };
  }
  throw new Error(`no gamma event/market for slug=${slug}`);
}

function numField(v: unknown, key: string): number | null {
  if (v == null || typeof v !== "object") return null;
  const raw = (v as Record<string, unknown>)[key];
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function clobQuotes(tokenId: string): Promise<ClobSideQuotes> {
  const client = new ClobClient(CLOB_HOST, CHAIN_ID);
  const [midR, spreadR, lastR, bookR] = await Promise.allSettled([
    client.getMidpoint(tokenId),
    client.getSpread(tokenId),
    client.getLastTradePrice(tokenId),
    client.getOrderBook(tokenId),
  ]);

  const mid =
    midR.status === "fulfilled" ? numField(midR.value, "mid") : null;
  const spread =
    spreadR.status === "fulfilled" ? numField(spreadR.value, "spread") : null;
  const lastTrade =
    lastR.status === "fulfilled" ? numField(lastR.value, "price") : null;

  let bestBid: number | null = null;
  let bestAsk: number | null = null;
  if (bookR.status === "fulfilled") {
    const book = bookR.value as {
      bids?: Array<{ price: string }>;
      asks?: Array<{ price: string }>;
    };
    const bid = book.bids?.[0]?.price;
    const ask = book.asks?.[0]?.price;
    bestBid = bid != null ? Number(bid) : null;
    bestAsk = ask != null ? Number(ask) : null;
    if (bestBid != null && !Number.isFinite(bestBid)) bestBid = null;
    if (bestAsk != null && !Number.isFinite(bestAsk)) bestAsk = null;
  }

  return { mid, spread, lastTrade, bestBid, bestAsk };
}

export function liveMarketSource(opts: {
  slugOverride?: string;
}): MarketSource {
  return {
    async pullActiveBtcUpDown(): Promise<Sample<DomainMarket>> {
      const slug = opts.slugOverride ?? activeBtcUpDownSlug();
      const event = await resolveEvent(slug);
      const market = event.markets?.[0];
      if (!market) throw new Error("live gamma: empty markets");

      let tokenIds: string[] = [];
      const raw = market.clobTokenIds;
      if (typeof raw === "string") {
        try {
          tokenIds = JSON.parse(raw) as string[];
        } catch {
          tokenIds = [];
        }
      } else if (Array.isArray(raw)) {
        tokenIds = raw.map(String);
      }

      const quotesByToken: Record<string, ClobSideQuotes> = {};
      await Promise.all(
        tokenIds.map(async (tid) => {
          quotesByToken[tid] = await clobQuotes(tid);
        }),
      );

      const value = domainMarketFromGamma(event, quotesByToken);
      const pulledAt = nowIso();
      return {
        value,
        freshness: { pulledAt: asIsoTime(pulledAt), ageMs: 0 },
        source: "live",
      };
    },
  };
}
