import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import {
  ClobClient,
  Chain,
  Side,
  OrderType,
  AssetType,
} from "@polymarket/clob-client-v2";
import { loadDotEnv } from "../src/loadEnv.js";
import { activeBtcUpDownSlug, fetchJson } from "../src/adapters/polymarket/wire.js";

loadDotEnv();
const pk = process.env.WALLET_PVK!.trim();
const key = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
const account = privateKeyToAccount(key);
const walletClient = createWalletClient({
  account,
  chain: polygon,
  transport: http(process.env.POLYGON_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com"),
});

const host = "https://clob.polymarket.com";
const auth = new ClobClient({ host, chain: Chain.POLYGON, signer: walletClient });
const creds = await auth.createOrDeriveApiKey();
console.log("apiKey", creds.key.slice(0, 4) + "…");

const client = new ClobClient({
  host,
  chain: Chain.POLYGON,
  signer: walletClient,
  creds,
  signatureType: 0,
  funderAddress: account.address,
  throwOnError: true,
});

await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
console.log("bal", await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL }));

const slug = activeBtcUpDownSlug();
const events = (await fetchJson(
  `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`,
)) as any[];
const m = events[0]?.markets?.[0];
if (!m) throw new Error("no market " + slug);
const tokenIds = typeof m.clobTokenIds === "string" ? JSON.parse(m.clobTokenIds) : m.clobTokenIds;
const outcomes = typeof m.outcomes === "string" ? JSON.parse(m.outcomes) : m.outcomes;
const up = tokenIds[outcomes.findIndex((o: string) => String(o).toLowerCase() === "up")];
const tickSize = await client.getTickSize(up);
const negRisk = await client.getNegRisk(up);
console.log({ slug, tickSize, negRisk, up: String(up).slice(0, 10) });

const posted = await client.createAndPostOrder(
  { tokenID: up, price: 0.01, size: 5, side: Side.BUY },
  { tickSize, negRisk },
  OrderType.GTC,
);
console.log("posted", posted);
const orderID = (posted as any).orderID;
if (orderID) {
  console.log("cancel", await client.cancelOrder({ orderID }));
} else {
  console.log("open", await client.getOpenOrders());
}
