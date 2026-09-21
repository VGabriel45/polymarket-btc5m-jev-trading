import { Contract, Wallet, providers, utils } from "ethers";
import { loadDotEnv } from "../src/loadEnv.js";
loadDotEnv();
const RPC = "https://polygon-bor-rpc.publicnode.com";
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const spenders = [
  "0xE111180000d2663C0091e4f400237545B87B996B",
  "0xe2222d279d744050d28e00520010520000310F59",
  "0xe3333700cA9d93003F00f0F71f8515005F6c00Aa",
  "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
];
async function main() {
  const p = new providers.JsonRpcProvider(RPC, 137);
  const w = new Wallet(process.env.WALLET_PVK!.trim(), p);
  const a = await w.getAddress();
  const usdc = new Contract(USDC_E, ["function allowance(address,address) view returns (uint256)","function balanceOf(address) view returns (uint256)"], p);
  console.log("bal", utils.formatUnits(await usdc.balanceOf(a), 6));
  for (const s of spenders) {
    const al = await usdc.allowance(a, s);
    console.log(s, utils.formatUnits(al, 6).slice(0, 20), al.gt(0) ? "OK" : "ZERO");
  }
}
main();
