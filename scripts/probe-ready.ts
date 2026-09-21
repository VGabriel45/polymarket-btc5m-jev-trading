import { createWalletClient, http, createPublicClient, formatUnits, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import {
  ClobClient,
  Chain,
  Side,
  OrderType,
  AssetType,
  SignatureTypeV2,
} from "@polymarket/clob-client-v2";
import { createSecureClient } from "@polymarket/client";
import { privateKey } from "@polymarket/client/viem";
import { loadDotEnv } from "../src/loadEnv.js";
import { activeBtcUpDownSlug, fetchJson } from "../src/adapters/polymarket/wire.js";

loadDotEnv();
const pkRaw = process.env.WALLET_PVK!.trim();
const key = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as `0x${string}`;
const account = privateKeyToAccount(key);
const rpc = process.env.POLYGON_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com";
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

const publicClient = createPublicClient({ chain: polygon, transport: http(rpc) });
const walletClient = createWalletClient({
  account,
  chain: polygon,
  transport: http(rpc),
});

async function main() {
  const bal = await publicClient.readContract({
    address: USDC_E,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log("eoa", account.address);
  console.log("eoa USDC.e", formatUnits(bal, 6));

  // Try SecureClient deposit wallet path (may fail without builder)
  let deposit: string | undefined = process.env.POLYMARKET_FUNDER?.trim();
  try {
    const secure = await createSecureClient({
      signer: privateKey(key),
    });
    deposit = (secure as any).account?.wallet ?? deposit;
    console.log("secure account", (secure as any).account);
  } catch (e: any) {
    console.log("secureClient:", e?.message ?? e);
  }

  const funder =
    deposit ||
    process.env.POLYMARKET_FUNDER?.trim() ||
    account.address;

  const auth = new ClobClient({ host: "https://clob.polymarket.com", chain: Chain.POLYGON, signer: walletClient });
  const creds = await auth.createOrDeriveApiKey();
  console.log("apiKey", creds.key.slice(0, 4) + "…");

  for (const [label, sig, fund] of [
    ["EOA/0", SignatureTypeV2.EOA, account.address],
    ["POLY_1271/3 funder=eoa", SignatureTypeV2.POLY_1271, account.address],
    ...(funder !== account.address
      ? [["POLY_1271/3 funder=deposit", SignatureTypeV2.POLY_1271, funder] as const]
      : []),
    ["GNOSIS_SAFE/2 funder=eoa", SignatureTypeV2.POLY_GNOSIS_SAFE, account.address],
  ] as const) {
    console.log("\n--- try", label, "funder", fund);
    const client = new ClobClient({
      host: "https://clob.polymarket.com",
      chain: Chain.POLYGON,
      signer: walletClient,
      creds,
      signatureType: sig,
      funderAddress: fund,
      throwOnError: false,
    });
    try {
      await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      const b = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      console.log("clob bal", b);
    } catch (e: any) {
      console.log("bal err", e?.message ?? e);
    }

    const slug = activeBtcUpDownSlug();
    const events = (await fetchJson(
      `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`,
    )) as any[];
    const m = events[0]?.markets?.[0];
    if (!m) {
      console.log("no market", slug);
      continue;
    }
    const tokenIds = typeof m.clobTokenIds === "string" ? JSON.parse(m.clobTokenIds) : m.clobTokenIds;
    const outcomes = typeof m.outcomes === "string" ? JSON.parse(m.outcomes) : m.outcomes;
    const up = tokenIds[outcomes.findIndex((o: string) => String(o).toLowerCase() === "up")];
    const tickSize = await client.getTickSize(up);
    const negRisk = await client.getNegRisk(up);
    const posted = await client.createAndPostOrder(
      { tokenID: up, price: 0.01, size: 5, side: Side.BUY },
      { tickSize, negRisk },
      OrderType.GTC,
    );
    console.log("posted", posted);
    const orderID = (posted as any).orderID;
    if (orderID) {
      console.log("cancel", await client.cancelOrder({ orderID }));
      console.log("SUCCESS with", label);
      return;
    }
  }
  console.log("\nno successful place");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
