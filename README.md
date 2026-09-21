# btc-updown-jev

Dry-run agent for the Polymarket **BTC Up or Down 5-minute** market. Every ~10s it pulls market + BTC, asks TypeSafe Jev for UP/DOWN + confidence, then applies an app-owned policy (enter / hold / exit / switch / abstain). Intended orders are logged only. Live posting is gated and unfinished.

## Lifecycle

`WindowSession` owns a small state machine:

1. **awaiting_window** — poll until a live 5m slug is active (`btc-updown-5m-{floor(now/300)*300}`).
2. **trading** — tick: compose facts (incl. seconds remaining + position), ask Jev, `planTrade`, dry-run broker updates position.
3. **settling** — when `endsAt` passed or Gamma `closed`, resolve winner from `outcomePrices`, mark open position to $1/$0 (or early exit bid), append `data/pnl.jsonl`.
4. **recorded** — show last PnL in TUI, then return to awaiting the next slug (position reset to flat).

Policy (threshold default 0.70, confidence must be **strictly greater**):

| Position | Confidence | Action |
|----------|------------|--------|
| flat | ≤ 0.70 | ABSTAIN |
| flat | > 0.70 | ENTER (dry BUY @ best ask) |
| open | ≤ 0.70 | EXIT (dry SELL @ best bid) |
| open | high, same side | HOLD |
| open | high, opposite | SWITCH (exit then enter) |

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
# ENTER (stub conf 0.81 > 0.70)
POLYMARKET_SOURCE=fixture npm run once -- --stub-judge --stub-confidence 0.81

# ABSTAIN LOW_CONFIDENCE while flat (stub conf 0.5)
POLYMARKET_SOURCE=fixture npm run once -- --stub-judge --stub-confidence 0.5

# Policy unit smoke (EXIT / SWITCH without a multi-tick session)
npx tsx scripts/smoke-policy.ts
```

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| `TYPESAFE_API_KEY` | — | Required for real Jev |
| `POLYMARKET_SOURCE` | `auto` | `live` \| `fixture` \| `auto` |
| `BTC_UPDOWN_SLUG` | series resolve | Optional Gamma slug override |
| `TICK_MS` | `10000` | Watch loop interval |
| `ACT_THRESHOLD` | `0.70` | Confidence gate |
| `DRY_RUN_SIZE` | `10` | Shares on intended orders |
| `LIVE_TRADING` | unset | If `1`, LiveBroker throws “not wired” |
| `PNL_PATH` | `data/pnl.jsonl` | Append-only settle ledger |

## Typecheck

```bash
npm run typecheck
```
