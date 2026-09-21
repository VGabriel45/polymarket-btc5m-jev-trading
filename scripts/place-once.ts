import { Wallet } from "ethers";
import { ClobClient, Side, OrderType, AssetType } from "@polymarket/clob-client";
import { loadDotEnv } from "../src/loadEnv.js";
import { activeBtcUpDownSlug, fetchJson } from "../src/adapters/polymarket/wire.js";

loadDotEnv();
const HOST = "https://clob.polymarket.com";
const wallet = new Wallet(process.env.WALLET_PVK!.trim());
const temp = new ClobClient(HOST, 137, wallet);
const creds = await temp.createOrDeriveApiKey();
// useServerTime = true (7th ctor arg after geoBlockToken)
const client = new ClobClient(HOST, 137, wallet, creds, 0, await wallet.getAddress(), undefined, true);
await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
console.log("bal", await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL }));

const slug = activeBtcUpDownSlug();
const events = (await fetchJson(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`)) as any[];
const m = events[0]?.markets?.[0];
const tokenIds = JSON.parse(m.clobTokenIds);
const outcomes = JSON.parse(m.outcomes);
const up = tokenIds[outcomes.findIndex((o: string) => o.toLowerCase() === "up")];
const tickSize = await client.getTickSize(up);
const negRisk = await client.getNegRisk(up);
console.log({ slug, up: up.slice(0,8), tickSize, negRisk });
try {
  const posted = await client.createAndPostOrder(
    { tokenID: up, price: 0.01, size: 5, side: Side.BUY },
    { tickSize, negRisk },
    OrderType.GTC,
  );
  console.log("posted", posted);
  if ((posted as any).orderID) {
    console.log("cancel", await client.cancelOrder({ orderID: (posted as any).orderID }));
  }
} catch (e: any) {
  console.error("order error", e?.response?.data ?? e.message ?? e);
}
