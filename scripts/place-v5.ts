import { Wallet } from "@ethersproject/wallet";
import { ClobClient, Side, OrderType, AssetType } from "@polymarket/clob-client";
import { loadDotEnv } from "../src/loadEnv.js";
import { activeBtcUpDownSlug, fetchJson } from "../src/adapters/polymarket/wire.js";

loadDotEnv();
const pk = process.env.WALLET_PVK!.trim();
const host = "https://clob.polymarket.com";
const signer = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`);
console.log("addr", await signer.getAddress());

const creds = await new ClobClient(host, 137, signer).createOrDeriveApiKey();
const client = new ClobClient(
  host, 137, signer, creds, 0, await signer.getAddress(),
  undefined, true, undefined, undefined, undefined, undefined, true, // throwOnError
);

const slug = activeBtcUpDownSlug();
const events = (await fetchJson(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`)) as any[];
const m = events[0]?.markets?.[0];
const tokenIds = typeof m.clobTokenIds === "string" ? JSON.parse(m.clobTokenIds) : m.clobTokenIds;
const outcomes = typeof m.outcomes === "string" ? JSON.parse(m.outcomes) : m.outcomes;
const up = tokenIds[outcomes.findIndex((o: string) => String(o).toLowerCase() === "up")];
const tickSize = await client.getTickSize(up);
const negRisk = await client.getNegRisk(up);
const fee = await client.getFeeRateBps(up);
console.log({ slug, tickSize, negRisk, fee });

await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
console.log("bal", await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL }));

const posted = await client.createAndPostOrder(
  { tokenID: up, price: 0.01, size: 5, side: Side.BUY },
  { tickSize, negRisk },
  OrderType.GTC,
);
console.log("posted", posted);
if ((posted as any).orderID) {
  console.log("cancel", await client.cancelOrder({ orderID: (posted as any).orderID }));
}
