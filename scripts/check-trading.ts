/**
 * Local probe: can this wallet authenticate and see CLOB balances?
 * Does NOT place or cancel orders unless --place-min is passed (refused by default).
 */
import { Wallet } from "ethers";
import { ClobClient, AssetType, Side, OrderType } from "@polymarket/clob-client";
import { loadDotEnv } from "../src/loadEnv.js";
import {
  activeBtcUpDownSlug,
  fetchJson,
  type GammaEventWire,
} from "../src/adapters/polymarket/wire.js";

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const POLYGON_RPC =
  process.env.POLYGON_RPC_URL ?? "https://polygon-rpc.com";

function redact(s: string): string {
  if (s.length < 10) return "***";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

async function erc20Balance(address: string, token: string): Promise<string> {
  const data =
    "0x70a08231" + address.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const res = await fetch(POLYGON_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: token, data }, "latest"],
    }),
  });
  const json = (await res.json()) as { result?: string; error?: unknown };
  if (!json.result) throw new Error(`eth_call failed: ${JSON.stringify(json.error)}`);
  const raw = BigInt(json.result);
  return (Number(raw) / 1e6).toFixed(6); // USDC.e 6 decimals
}

async function nativePol(address: string): Promise<string> {
  const res = await fetch(POLYGON_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
  });
  const json = (await res.json()) as { result?: string };
  const raw = BigInt(json.result ?? "0x0");
  return (Number(raw) / 1e18).toFixed(6);
}

async function resolveUpToken(): Promise<{ slug: string; tokenId: string }> {
  const slug = process.env.BTC_UPDOWN_SLUG ?? activeBtcUpDownSlug();
  const data = await fetchJson(
    `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`,
  );
  const events = Array.isArray(data) ? data : [];
  if (events.length === 0) throw new Error(`no event for slug=${slug}`);
  const event = events[0] as GammaEventWire;
  const market = event.markets?.[0];
  if (!market) throw new Error("no markets on event");
  let tokenIds: string[] = [];
  const raw = market.clobTokenIds;
  if (typeof raw === "string") tokenIds = JSON.parse(raw) as string[];
  else if (Array.isArray(raw)) tokenIds = raw.map(String);
  let outcomes: string[] = [];
  const o = market.outcomes;
  if (typeof o === "string") outcomes = JSON.parse(o) as string[];
  else if (Array.isArray(o)) outcomes = o.map(String);
  let upIdx = outcomes.findIndex((x) => x.toLowerCase() === "up");
  if (upIdx < 0) upIdx = 0;
  return { slug, tokenId: tokenIds[upIdx]! };
}

async function main(): Promise<void> {
  loadDotEnv();
  const pk = process.env.WALLET_PVK?.trim();
  if (!pk) {
    console.error("WALLET_PVK missing from .env");
    process.exit(1);
  }

  const placeMin = process.argv.includes("--place-min");
  const funder = process.env.POLYMARKET_FUNDER?.trim();
  const sigType = Number(process.env.SIGNATURE_TYPE ?? "0"); // 0=EOA default for self-funded wallets

  const wallet = new Wallet(pk);
  const address = await wallet.getAddress();
  console.log("address", address);
  console.log("signatureType", sigType, "(0=EOA 1=POLY_PROXY 2=GNOSIS_SAFE)");
  console.log("funder", funder ?? `(defaulting to EOA ${address})`);

  const pol = await nativePol(address);
  const usdc = await erc20Balance(address, USDC_E);
  console.log("onchain POL", pol);
  console.log("onchain USDC.e", usdc);

  console.log("deriving CLOB API key…");
  const temp = new ClobClient(HOST, CHAIN_ID, wallet);
  const creds = await temp.createOrDeriveApiKey();
  console.log("apiKey", redact(creds.key ?? (creds as { apiKey?: string }).apiKey ?? ""));
  console.log("L1/L2 auth", "ok");

  const trading = new ClobClient(
    HOST,
    CHAIN_ID,
    wallet,
    creds,
    sigType,
    funder ?? address,
  );

  try {
    const bal = await trading.getBalanceAllowance({
      asset_type: AssetType.COLLATERAL,
    });
    console.log("clob collateral balance/allowance", bal);
  } catch (e) {
    console.log(
      "clob getBalanceAllowance failed",
      e instanceof Error ? e.message : e,
    );
  }

  try {
    const open = await trading.getOpenOrders();
    const n = Array.isArray(open) ? open.length : (open as { length?: number })?.length;
    console.log("openOrders count", n ?? open);
  } catch (e) {
    console.log("getOpenOrders failed", e instanceof Error ? e.message : e);
  }

  if (!placeMin) {
    console.log(
      "\nNo orders placed. Re-run with --place-min to post then cancel a tiny BUY (asks first).",
    );
    return;
  }

  console.log("\n--place-min: posting tiny BUY then cancel…");
  const { slug, tokenId } = await resolveUpToken();
  console.log("market", slug, "token", redact(tokenId));
  const tickSize = await trading.getTickSize(tokenId);
  const negRisk = await trading.getNegRisk(tokenId);
  const book = await trading.getOrderBook(tokenId);
  const bestAsk = book.asks?.[0]?.price;
  if (!bestAsk) throw new Error("empty asks — cannot place min buy");
  // Resting bid far below market so it should not fill.
  const price = 0.01;
  const size = 5; // min size often ~5 on some markets
  console.log("posting GTC BUY", { price, size, tickSize, negRisk, bestAsk });
  const posted = await trading.createAndPostOrder(
    { tokenID: tokenId, price, size, side: Side.BUY },
    { tickSize, negRisk },
    OrderType.GTC,
  );
  console.log("posted", posted);
  const orderId =
    (posted as { orderID?: string; id?: string }).orderID ??
    (posted as { id?: string }).id;
  if (orderId) {
    const cancelled = await trading.cancelOrder({ orderID: orderId });
    console.log("cancelled", cancelled);
  } else {
    console.log("no orderID in response — check open orders / cancel manually");
    const open = await trading.getOpenOrders();
    console.log("openOrders", open);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
