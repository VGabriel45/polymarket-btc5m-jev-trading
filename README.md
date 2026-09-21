# btc-updown-jev

Dry-run agent that watches the active Polymarket **BTC Up or Down** 15m market, feeds typed facts to TypeSafe Jev, and either logs an intended BUY or abstains. It never posts live orders.

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

# Auto: try live Gamma/CLOB, sticky-fallback to fixture on transport failure
POLYMARKET_SOURCE=auto npm run watch

# One tick, JSON to stdout
POLYMARKET_SOURCE=fixture npm run once -- --stub-judge
# or
npm run tick -- --once --stub-judge
```

### Gate smoke (offline)

```bash
# ACT (stub conf 0.81 > 0.70)
POLYMARKET_SOURCE=fixture npm run once -- --stub-judge --stub-confidence 0.81

# ABSTAIN LOW_CONFIDENCE (stub conf 0.5)
POLYMARKET_SOURCE=fixture npm run once -- --stub-judge --stub-confidence 0.5
```

## Mental model

`WatchSession` holds two private `Sample<>` slots (market + spot). Each tick pulls both, `composeFacts` merges at the read boundary into `FactsForJev`, Jev returns a `JudgeOpinion`, and `gate`/`decide` emit a `Verdict`. ACT requires branded `HighConfidence` (confidence **strictly greater than** `ACT_THRESHOLD`, default `0.70`). The only order sink is `DryRunPen` (log intended BUY).

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| `TYPESAFE_API_KEY` | — | Required for real Jev |
| `POLYMARKET_SOURCE` | `auto` | `live` \| `fixture` \| `auto` |
| `BTC_UPDOWN_SLUG` | series resolve | Optional Gamma slug override |
| `TICK_MS` | `15000` | Watch loop interval |
| `ACT_THRESHOLD` | `0.70` | Confidence gate |
| `DRY_RUN_SIZE` | `10` | Shares on intended BUY log |

## Typecheck

```bash
npm run typecheck
```
