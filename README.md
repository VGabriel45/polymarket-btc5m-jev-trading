# polymarket-btc5m-jev-trading

Agent for the Polymarket **BTC Up or Down 5-minute** market. Every ~5s it pulls market + BTC, asks TypeSafe Jev for UP/DOWN + confidence, then applies an app-owned policy (enter / hold / exit / switch / abstain). Default is dry-run logging; set `LIVE_TRADING=1` to post via deposit-wallet CLOB v2.

## Lifecycle

`WindowSession` owns a small state machine:

1. **awaiting_window** — poll until a live 5m slug is active (`btc-updown-5m-{floor(now/300)*300}`).
2. **trading** — tick: compose facts (incl. seconds remaining + position), ask Jev, `planTrade`, dry-run broker updates position.
3. **settling** — when `endsAt` passed or Gamma `closed`, resolve winner from `outcomePrices`, mark open position to $1/$0 (or early exit bid), append `data/pnl.jsonl`.
4. **recorded** — show last PnL in TUI, then return to awaiting the next slug (position reset to flat).

Policy (threshold default **0.90**, confidence must be **strictly greater**):

| Position | Condition | Action |
|----------|-----------|--------|
| flat | conf ≤ 0.90 | ABSTAIN |
| flat | ask > 0.70, or P(win) < ask+0.10, or &lt;90s left | ABSTAIN |
| flat | conf > 0.90 and edge + time ok | ENTER once |
| open | any | HOLD until window settle |

## Requirements

- Node 20+
- Optional: `TYPESAFE_API_KEY` for live Jev (omit when using `--stub-judge`)

## Setup

```bash
cp .env.example .env
# put TYPESAFE_API_KEY=… in .env (loaded automatically by npm scripts)
npm install
```

## Run

```bash
# Ink TUI loop
npm run watch

# Polymarket unreachable? Force fixtures:
POLYMARKET_SOURCE=fixture npm run watch -- --stub-judge

# One tick, JSON to stdout
POLYMARKET_SOURCE=fixture npm run once -- --stub-judge
```

### Gate smoke (offline)

```bash
# ENTER (stub conf 0.91 > 0.90)
POLYMARKET_SOURCE=fixture npm run once -- --stub-judge --stub-confidence 0.91

# ABSTAIN LOW_CONFIDENCE while flat (stub conf 0.75 ≤ 0.90)
POLYMARKET_SOURCE=fixture npm run once -- --stub-judge --stub-confidence 0.75

# Policy unit smoke (EXIT / SWITCH without a multi-tick session)
npx tsx scripts/smoke-policy.ts
```

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| `TYPESAFE_API_KEY` | — | Required for real Jev |
| `POLYMARKET_SOURCE` | `auto` | `live` \| `fixture` \| `auto` |
| `BTC_UPDOWN_SLUG` | series resolve | Optional Gamma slug override |
| `TICK_MS` | `5000` | Watch loop interval |
| `ACT_THRESHOLD` | `0.90` | Enter gate; then hold to resolution |
| `MAX_ASK` | `0.70` | Refuse ENTER above this ask |
| `MIN_EDGE` | `0.10` | Need P(win) ≥ ask + this |
| `MIN_SECONDS_TO_ENTER` | `90` | No new ENTER late in window |
| `BET_USD` | `5` | Max USD notional per ENTER (shares sized from ask) |
| `LIVE_TRADING` | unset | `1` → LiveBroker posts CLOB v2 (needs `WALLET_PVK` + funder) |
| `WALLET_PVK` | — | EOA private key (signer for POLY_1271) |
| `POLYMARKET_FUNDER` | SecureClient | Deposit wallet address |
| `SIGNATURE_TYPE` | `3` | `3` = POLY_1271 |
| `PNL_PATH` | `data/pnl.jsonl` | Append-only settle ledger |

## Typecheck

```bash
npm run typecheck
```
