/**
 * Smoke FOK fill helpers (no network).
 * Run: npx tsx scripts/smoke-live-fill.ts
 */
import assert from "node:assert/strict";
import type { OrderResponse } from "@polymarket/clob-client-v2";
import { asIsoTime, asTokenId, type IntendedOrder } from "../src/domain.js";
import { orderFilled, withFillAmounts } from "../src/broker/live.js";

function resp(partial: Partial<OrderResponse>): OrderResponse {
  return {
    success: true,
    errorMsg: "",
    orderID: "0x1",
    status: "live",
    takingAmount: "0",
    makingAmount: "0",
    ...partial,
  };
}

{
  assert.equal(orderFilled(resp({ status: "matched", takingAmount: "10", makingAmount: "4.8" })), true);
  assert.equal(orderFilled(resp({ status: "live" })), false);
  assert.equal(orderFilled(resp({ success: false, status: "matched" })), false);
  assert.equal(orderFilled(resp({ tradeIDs: ["t1"], takingAmount: "0", makingAmount: "0" })), true);
  console.log("ok orderFilled detection");
}

{
  const order: IntendedOrder = {
    side: "BUY",
    tokenId: asTokenId("tok"),
    outcome: "DOWN",
    price: 0.48,
    size: 10,
    at: asIsoTime("2026-01-01T00:00:00.000Z"),
    idempotencyKey: "k",
    rationale: "test",
  };
  const adj = withFillAmounts(
    order,
    resp({ status: "matched", takingAmount: "10.5", makingAmount: "5.04" }),
  );
  assert.equal(adj.size, 10.5);
  assert.ok(Math.abs(adj.price - 0.48) < 1e-9);
  console.log("ok withFillAmounts BUY");
}

{
  const order: IntendedOrder = {
    side: "SELL",
    tokenId: asTokenId("tok"),
    outcome: "DOWN",
    price: 0.5,
    size: 10,
    at: asIsoTime("2026-01-01T00:00:00.000Z"),
    idempotencyKey: "k",
    rationale: "test",
  };
  const adj = withFillAmounts(
    order,
    resp({ status: "matched", makingAmount: "10", takingAmount: "4.7" }),
  );
  assert.equal(adj.size, 10);
  assert.ok(Math.abs(adj.price - 0.47) < 1e-9);
  console.log("ok withFillAmounts SELL");
}

console.log("smoke-live-fill: all passed");
