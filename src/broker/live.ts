import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import {
  AssetType,
  Chain,
  ClobClient,
  OrderType,
  Side as ClobSide,
  SignatureTypeV2,
  type OrderResponse,
} from "@polymarket/clob-client-v2";
import { createSecureClient } from "@polymarket/client";
import { privateKey } from "@polymarket/client/viem";
import type {
  DomainMarket,
  IntendedOrder,
  IsoTime,
  Position,
  TradeAction,
} from "../domain.js";
import { applyDry } from "./dry.js";

export type LiveBrokerOpts = {
  privateKey: string;
  /** Deposit wallet funder. If omitted, resolved via SecureClient. */
  funderAddress?: string;
  rpcUrl?: string;
  signatureType?: number;
};

const SLIPPAGE = 0.03;

function roundPrice(p: number): number {
  return Math.round(p * 100) / 100;
}

/** True when the CLOB response shows an immediate match / fill. */
export function orderFilled(resp: OrderResponse): boolean {
  if (!resp.success) return false;
  const status = String(resp.status ?? "").toLowerCase();
  if (status === "matched" || status === "filled") return true;
  if (resp.tradeIDs != null && resp.tradeIDs.length > 0) return true;
  const taking = Number(resp.takingAmount);
  const making = Number(resp.makingAmount);
  return (
    (Number.isFinite(taking) && taking > 0) ||
    (Number.isFinite(making) && making > 0)
  );
}

/** Rewrite size/price from fill amounts when the API returns them. */
export function withFillAmounts(
  order: IntendedOrder,
  resp: OrderResponse,
): IntendedOrder {
  if (order.side === "BUY") {
    const shares = Number(resp.takingAmount);
    const usd = Number(resp.makingAmount);
    if (shares > 0 && usd > 0) {
      return { ...order, size: shares, price: usd / shares };
    }
  } else {
    const shares = Number(resp.makingAmount);
    const usd = Number(resp.takingAmount);
    if (shares > 0 && usd > 0) {
      return { ...order, size: shares, price: usd / shares };
    }
  }
  return order;
}

function worstPrice(order: IntendedOrder): number {
  if (order.side === "BUY") {
    return Math.min(0.99, roundPrice(order.price + SLIPPAGE));
  }
  return Math.max(0.01, roundPrice(order.price - SLIPPAGE));
}

function marketAmount(order: IntendedOrder): number {
  if (order.side === "BUY") {
    return Math.round(order.size * order.price * 100) / 100;
  }
  return order.size;
}

/**
 * Posts FOK market orders via CLOB v2. Position updates only on fill.
 * Resting GTC leftovers are cancelled once when the client is built.
 */
export class LiveBroker {
  private clientPromise: Promise<ClobClient> | null = null;
  private readonly opts: LiveBrokerOpts;

  constructor(opts: LiveBrokerOpts) {
    this.opts = opts;
  }

  private async client(): Promise<ClobClient> {
    if (!this.clientPromise) this.clientPromise = this.buildClient();
    return this.clientPromise;
  }

  private async buildClient(): Promise<ClobClient> {
    const pkRaw = this.opts.privateKey.trim();
    const key = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as `0x${string}`;
    const account = privateKeyToAccount(key);
    const rpc =
      this.opts.rpcUrl ??
      process.env.POLYGON_RPC_URL ??
      "https://polygon-bor-rpc.publicnode.com";
    const walletClient = createWalletClient({
      account,
      chain: polygon,
      transport: http(rpc),
    });

    let funder = this.opts.funderAddress?.trim();
    if (!funder) {
      const secure = await createSecureClient({ signer: privateKey(key) });
      funder = secure.account.wallet;
    }

    const sig =
      this.opts.signatureType === 0
        ? SignatureTypeV2.EOA
        : this.opts.signatureType === 1
          ? SignatureTypeV2.POLY_PROXY
          : this.opts.signatureType === 2
            ? SignatureTypeV2.POLY_GNOSIS_SAFE
            : SignatureTypeV2.POLY_1271;

    const auth = new ClobClient({
      host: "https://clob.polymarket.com",
      chain: Chain.POLYGON,
      signer: walletClient,
    });
    const creds = await auth.createOrDeriveApiKey();
    const client = new ClobClient({
      host: "https://clob.polymarket.com",
      chain: Chain.POLYGON,
      signer: walletClient,
      creds,
      signatureType: sig,
      funderAddress: funder,
      throwOnError: true,
    });
    await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    try {
      await client.cancelAll();
      console.error("[live] cancelled resting open orders (clear GTC leftovers)");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[live] cancelAll skipped: ${msg}`);
    }
    return client;
  }

  private async postFok(
    client: ClobClient,
    order: IntendedOrder,
  ): Promise<OrderResponse> {
    const tokenID = order.tokenId;
    const tickSize = await client.getTickSize(tokenID);
    const negRisk = await client.getNegRisk(tokenID);
    const side = order.side === "BUY" ? ClobSide.BUY : ClobSide.SELL;
    const amount = marketAmount(order);
    const price = worstPrice(order);
    return client.createAndPostMarketOrder(
      {
        tokenID,
        side,
        amount,
        price,
      },
      { tickSize, negRisk },
      OrderType.FOK,
    );
  }

  async apply(
    position: Position,
    action: TradeAction,
    market: DomainMarket,
    at: IsoTime,
  ): Promise<{ position: Position; orders: IntendedOrder[]; responses: OrderResponse[] }> {
    const planned = applyDry(position, action, market, at);
    if (planned.orders.length === 0) {
      return { position, orders: [], responses: [] };
    }

    const client = await this.client();
    const responses: OrderResponse[] = [];
    const filled: IntendedOrder[] = [];

    for (const order of planned.orders) {
      try {
        const resp = await this.postFok(client, order);
        responses.push(resp);
        if (orderFilled(resp)) {
          const adj = withFillAmounts(order, resp);
          filled.push(adj);
          console.error(
            `[live] FOK FILL ${adj.side} ${adj.outcome} @${adj.price.toFixed(4)} ×${adj.size} orderID=${resp.orderID} status=${resp.status}`,
          );
        } else {
          console.error(
            `[live] FOK NO FILL ${order.side} ${order.outcome} @${order.price} ×${order.size} status=${resp.status} err=${resp.errorMsg || ""}`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[live] FOK KILLED/FAIL ${order.side} ${order.outcome} @${order.price} ×${order.size}: ${msg}`,
        );
      }
    }

    if (filled.length === 0) {
      return { position, orders: [], responses };
    }

    if (filled.length < planned.orders.length) {
      console.error(
        `[live] partial FOK set (${filled.length}/${planned.orders.length}) — keeping prior position`,
      );
      return { position, orders: [], responses };
    }

    // Rebuild action with fill-adjusted orders so position uses real size/price.
    const filledAction = actionWithFills(action, filled);
    const applied = applyDry(position, filledAction, market, at);
    return { position: applied.position, orders: filled, responses };
  }
}

function actionWithFills(
  action: TradeAction,
  filled: IntendedOrder[],
): TradeAction {
  if (action.kind === "ENTER" && filled[0]) {
    return { ...action, order: filled[0] };
  }
  if (action.kind === "EXIT" && filled[0]) {
    return { ...action, order: filled[0] };
  }
  if (action.kind === "SWITCH" && filled.length >= 2) {
    return { ...action, exit: filled[0]!, enter: filled[1]! };
  }
  return action;
}

export function assertLiveConfigured(liveTrading: boolean, hasKey: boolean): void {
  if (liveTrading && !hasKey) {
    throw new Error("LIVE_TRADING=1 requires WALLET_PVK");
  }
}
