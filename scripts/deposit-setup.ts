import { createSecureClient } from "@polymarket/client";
import { privateKey } from "@polymarket/client/viem";
import { loadDotEnv } from "../src/loadEnv.js";

loadDotEnv();
const pk = process.env.WALLET_PVK!.trim();

async function main() {
  console.log("creating SecureClient (default deposit wallet)…");
  try {
    const client = await createSecureClient({
      signer: privateKey(pk.startsWith("0x") ? pk : `0x${pk}`),
    });
    console.log("account", client.account);
    console.log("wallet", (client as any).account?.wallet ?? (client as any).wallet);
    // try setupTradingApprovals if present
    if (typeof (client as any).setupTradingApprovals === "function") {
      console.log("setupTradingApprovals…");
      const r = await (client as any).setupTradingApprovals();
      console.log(r);
    }
    if (typeof (client as any).fetchBalanceAllowance === "function") {
      console.log("balance", await (client as any).fetchBalanceAllowance({ assetType: "COLLATERAL" }));
    }
  } catch (e: any) {
    console.error("failed", e?.message ?? e);
    if (e?.cause) console.error("cause", e.cause);
    if (e?.data) console.error("data", e.data);
  }
}
main();
