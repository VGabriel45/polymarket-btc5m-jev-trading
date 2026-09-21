/**
 * One-shot Polymarket EOA setup per agent-skills approval matrix:
 * - Approve USDC.e for CTF, CTF Exchange, Neg Risk Exchange
 * - setApprovalForAll on CTF for both exchanges (+ Neg Risk Adapter)
 * - Derive CLOB API creds and refresh collateral allowance cache
 *
 * Does not place orders. Uses WALLET_PVK from .env.
 */
import { Contract, Wallet, constants, providers, utils, BigNumber } from "ethers";
import { AssetType, ClobClient } from "@polymarket/clob-client";
import { loadDotEnv } from "../src/loadEnv.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;
const RPC = process.env.POLYGON_RPC_URL ?? "https://polygon-bor-rpc.publicnode.com";

const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const CTF_EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

const ERC1155_ABI = [
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
];

async function waitTx(
  label: string,
  p: Promise<providers.TransactionResponse>,
): Promise<string> {
  console.log(`sending ${label}…`);
  const tx = await p;
  console.log(`  tx ${tx.hash}`);
  const receipt = await tx.wait(1);
  console.log(`  mined status=${receipt.status} gas=${receipt.gasUsed.toString()}`);
  if (receipt.status !== 1) throw new Error(`${label} failed`);
  return tx.hash;
}

/** Polygon public RPCs often reject tips below ~25 gwei. */
async function feeOverrides(
  provider: providers.JsonRpcProvider,
): Promise<providers.TransactionRequest> {
  const fee = await provider.getFeeData();
  const minTip = utils.parseUnits("30", "gwei");
  const tip = fee.maxPriorityFeePerGas && fee.maxPriorityFeePerGas.gt(minTip)
    ? fee.maxPriorityFeePerGas
    : minTip;
  const minMax = tip.mul(2).add(utils.parseUnits("50", "gwei"));
  const max =
    fee.maxFeePerGas && fee.maxFeePerGas.gt(minMax) ? fee.maxFeePerGas : minMax;
  return { maxPriorityFeePerGas: tip, maxFeePerGas: max };
}

async function ensureErc20Approve(
  token: Contract,
  owner: string,
  spender: string,
  label: string,
  fees: providers.TransactionRequest,
): Promise<void> {
  const current: BigNumber = await token.allowance(owner, spender);
  if (current.gt(utils.parseUnits("1000000", 6))) {
    console.log(`skip ${label} (allowance already ${current.toString()})`);
    return;
  }
  await waitTx(label, token.approve(spender, constants.MaxUint256, fees));
}

async function ensureErc1155Approve(
  ctf: Contract,
  owner: string,
  operator: string,
  label: string,
  fees: providers.TransactionRequest,
): Promise<void> {
  const ok: boolean = await ctf.isApprovedForAll(owner, operator);
  if (ok) {
    console.log(`skip ${label} (already approved)`);
    return;
  }
  await waitTx(label, ctf.setApprovalForAll(operator, true, fees));
}

async function main(): Promise<void> {
  // Ensure we load .env from project root even if cwd drifts
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.chdir(resolve(here, ".."));
  loadDotEnv();

  const pk = process.env.WALLET_PVK?.trim();
  if (!pk) throw new Error("WALLET_PVK missing");

  const provider = new providers.JsonRpcProvider(RPC, CHAIN_ID);
  const wallet = new Wallet(pk, provider);
  const address = await wallet.getAddress();
  const funder = process.env.POLYMARKET_FUNDER?.trim() || address;
  const sigType = Number(process.env.SIGNATURE_TYPE ?? "0");

  console.log("address", address);
  console.log("funder", funder);
  console.log("signatureType", sigType);
  console.log("rpc", RPC);

  const usdc = new Contract(USDC_E, ERC20_ABI, wallet);
  const ctf = new Contract(CTF, ERC1155_ABI, wallet);

  const bal: BigNumber = await usdc.balanceOf(address);
  const pol = await provider.getBalance(address);
  console.log("USDC.e", utils.formatUnits(bal, 6));
  console.log("POL", utils.formatEther(pol));

  if (bal.isZero()) {
    throw new Error("USDC.e balance is 0 — swap/bridge first, then re-run");
  }
  if (pol.lt(utils.parseEther("0.01"))) {
    throw new Error("POL too low for approvals (< 0.01)");
  }

  const fees = await feeOverrides(provider);
  console.log(
    "fees tip/max gwei",
    utils.formatUnits(fees.maxPriorityFeePerGas!, "gwei"),
    utils.formatUnits(fees.maxFeePerGas!, "gwei"),
  );

  // Approval matrix (EOA funder)
  await ensureErc20Approve(usdc, address, CTF, "approve USDC.e → CTF (split)", fees);
  await ensureErc20Approve(
    usdc,
    address,
    CTF_EXCHANGE,
    "approve USDC.e → CTF Exchange (buy)",
    fees,
  );
  await ensureErc20Approve(
    usdc,
    address,
    NEG_RISK_EXCHANGE,
    "approve USDC.e → Neg Risk Exchange (buy)",
    fees,
  );

  await ensureErc1155Approve(
    ctf,
    address,
    CTF_EXCHANGE,
    "CTF setApprovalForAll → CTF Exchange (sell)",
    fees,
  );
  await ensureErc1155Approve(
    ctf,
    address,
    NEG_RISK_EXCHANGE,
    "CTF setApprovalForAll → Neg Risk Exchange (sell)",
    fees,
  );
  await ensureErc1155Approve(
    ctf,
    address,
    NEG_RISK_ADAPTER,
    "CTF setApprovalForAll → Neg Risk Adapter",
    fees,
  );

  console.log("deriving CLOB API key…");
  const temp = new ClobClient(HOST, CHAIN_ID, wallet);
  const creds = await temp.createOrDeriveApiKey();
  const trading = new ClobClient(
    HOST,
    CHAIN_ID,
    wallet,
    creds,
    sigType,
    funder,
  );

  console.log("refreshing CLOB collateral allowance cache…");
  await trading.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  const after = await trading.getBalanceAllowance({
    asset_type: AssetType.COLLATERAL,
  });
  console.log("clob collateral", after);

  console.log("\nsetup complete — ready for dry-run or live order smoke");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
