import { Contract, Wallet, constants, providers, utils, BigNumber } from "ethers";
import { AssetType, ClobClient } from "@polymarket/clob-client";
import { loadDotEnv } from "../src/loadEnv.js";

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;
const RPC = process.env.POLYGON_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com";
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";

const EXTRA_USDC_SPENDERS = [
  "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E", // CTF Exchange (skill)
  "0xC5d563A36AE78145C45a50134d48A1215220f80a", // Neg Risk Exchange
  "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045", // CTF
  "0xE111180000d2663C0091e4f400237545B87B996B", // from CLOB allowance map
  "0xe2222d279d744050d28e00520010520000310F59",
  "0xe3333700cA9d93003F00f0F71f8515005F6c00Aa",
];

const EXTRA_CTF_OPS = [
  "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
  "0xC5d563A36AE78145C45a50134d48A1215220f80a",
  "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
  "0xE111180000d2663C0091e4f400237545B87B996B",
  "0xe2222d279d744050d28e00520010520000310F59",
  "0xe3333700cA9d93003F00f0F71f8515005F6c00Aa",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];
const ERC1155_ABI = [
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
];

async function fees(p: providers.JsonRpcProvider) {
  const fee = await p.getFeeData();
  const tip = utils.parseUnits("35", "gwei");
  const max = tip.mul(3).add(utils.parseUnits("100", "gwei"));
  return {
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas?.gt(tip) ? fee.maxPriorityFeePerGas : tip,
    maxFeePerGas: fee.maxFeePerGas?.gt(max) ? fee.maxFeePerGas : max,
  };
}

async function main() {
  loadDotEnv();
  const provider = new providers.JsonRpcProvider(RPC, CHAIN_ID);
  const wallet = new Wallet(process.env.WALLET_PVK!.trim(), provider);
  const address = await wallet.getAddress();
  const usdc = new Contract(USDC_E, ERC20_ABI, wallet);
  const ctf = new Contract(CTF, ERC1155_ABI, wallet);
  const f = await fees(provider);

  console.log("address", address);
  console.log("USDC.e", utils.formatUnits(await usdc.balanceOf(address), 6));

  for (const spender of EXTRA_USDC_SPENDERS) {
    const a: BigNumber = await usdc.allowance(address, spender);
    if (a.gt(utils.parseUnits("1000000", 6))) {
      console.log("ok usdc", spender, a.toString());
      continue;
    }
    console.log("approve usdc", spender);
    const tx = await usdc.approve(spender, constants.MaxUint256, f);
    console.log("  ", tx.hash);
    await tx.wait(1);
  }

  for (const op of EXTRA_CTF_OPS) {
    const ok: boolean = await ctf.isApprovedForAll(address, op);
    if (ok) {
      console.log("ok ctf", op);
      continue;
    }
    console.log("approve ctf", op);
    const tx = await ctf.setApprovalForAll(op, true, f);
    console.log("  ", tx.hash);
    await tx.wait(1);
  }

  const temp = new ClobClient(HOST, CHAIN_ID, wallet);
  let creds;
  try {
    creds = await temp.createOrDeriveApiKey();
    console.log("apiKey ok", (creds.key ?? "").slice(0, 4) + "…");
  } catch (e) {
    console.error("createOrDerive failed", e instanceof Error ? e.message : e);
    // try derive only via second call path
    throw e;
  }

  const trading = new ClobClient(HOST, CHAIN_ID, wallet, creds, 0, address);
  await trading.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  const bal = await trading.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  console.log("clob collateral", JSON.stringify(bal, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
