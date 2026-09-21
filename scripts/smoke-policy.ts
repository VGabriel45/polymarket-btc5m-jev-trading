/**
 * Smoke planTrade without a live session.
 * Run: npx tsx scripts/smoke-policy.ts
 */
import assert from "node:assert/strict";
import { asIsoTime, asTokenId, parseConfidence, type DomainMarket, type Position } from "../src/domain.js";
import { planTrade } from "../src/policy.js";

const at = asIsoTime("2026-01-01T00:00:00.000Z");
const market: DomainMarket = {
  eventSlug: "btc-updown-5m-smoke",
  question: "smoke",
  conditionId: "0x1",
  endsAt: asIsoTime("2099-01-01T00:00:00.000Z"),
  volume24hUsd: 1,
  closed: false,
  active: true,
  outcomePrices: null,
  bySide: {
    UP: {
      tokenId: asTokenId("up"),
      outcomeLabel: "Up",
      mid: 0.55,
      bestBid: 0.54,
      bestAsk: 0.56,
      spread: 0.02,
      lastTrade: 0.55,
    },
    DOWN: {
      tokenId: asTokenId("down"),
      outcomeLabel: "Down",
      mid: 0.45,
      bestBid: 0.44,
      bestAsk: 0.46,
      spread: 0.02,
      lastTrade: 0.45,
    },
  },
};

const confHi = parseConfidence(0.81)!;
const confLo = parseConfidence(0.5)!;
const threshold = 0.7;
const size = 10;
const flat: Position = { kind: "flat" };
const openUp: Position = {
  kind: "open",
  side: "UP",
  tokenId: asTokenId("up"),
  size: 10,
  entryPrice: 0.56,
  openedAt: at,
  slug: market.eventSlug,
};

{
  const a = planTrade(flat, { side: "UP", confidence: confLo }, threshold, market, size, at);
  assert.equal(a.kind, "ABSTAIN");
  console.log("ok flat+low → ABSTAIN");
}

{
  const a = planTrade(flat, { side: "UP", confidence: confHi }, threshold, market, size, at);
  assert.equal(a.kind, "ENTER");
  if (a.kind === "ENTER") assert.equal(a.order.side, "BUY");
  console.log("ok flat+high → ENTER");
}

{
  const a = planTrade(openUp, { side: "UP", confidence: confHi }, threshold, market, size, at);
  assert.equal(a.kind, "HOLD");
  console.log("ok open+same → HOLD");
}

{
  const a = planTrade(openUp, { side: "UP", confidence: confLo }, threshold, market, size, at);
  assert.equal(a.kind, "EXIT");
  if (a.kind === "EXIT") assert.equal(a.reason, "low_confidence");
  console.log("ok open+low → EXIT");
}

{
  const a = planTrade(openUp, { side: "DOWN", confidence: confHi }, threshold, market, size, at);
  assert.equal(a.kind, "SWITCH");
  if (a.kind === "SWITCH") {
    assert.equal(a.from, "UP");
    assert.equal(a.to, "DOWN");
  }
  console.log("ok open+opposite → SWITCH");
}

console.log("smoke-policy: all passed");
