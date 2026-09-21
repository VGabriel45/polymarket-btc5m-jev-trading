# polymarket-btc5m-jev-trading

A terminal agent for Polymarket’s **BTC Up or Down 5-minute** markets.

It watches the live 5m window, asks [TypeSafe Jev](https://typesafe.ai) whether BTC finishes UP or DOWN vs the window open, and either **abstains** or **buys once** and holds to resolution. Default mode is **dry-run** (no real orders). Live trading is optional.

---

## Requirements

- Node.js 20+
- A TypeSafe API key (`TYPESAFE_API_KEY`)

For live trading only: a Polygon wallet that already works on [Polymarket](https://polymarket.com) (connected, funded with USDC.e, able to trade in the browser). This project does **not** set allowances or deposits for you.

---

## Install

```bash
git clone https://github.com/VGabriel45/polymarket-btc5m-jev-trading.git
cd polymarket-btc5m-jev-trading
cp .env.example .env
npm install
```

Edit `.env` and set:

```bash
TYPESAFE_API_KEY=your_key_here
```

---

## Dry-run (recommended first)

```bash
npm run watch
```

Ink TUI opens. You should see **DRY-RUN**. Press `q` to quit.

One-shot tick (JSON to stdout):

```bash
npm run once
```

Offline without a TypeSafe key:

```bash
POLYMARKET_SOURCE=fixture npm run watch -- --stub-judge
```

---

## Live trading

1. On [polymarket.com](https://polymarket.com), connect the wallet you will use and confirm you can trade normally.
2. Add to `.env`:

```bash
LIVE_TRADING=1
WALLET_PVK=0x...              # private key of that wallet
POLYMARKET_FUNDER=0x...       # deposit / proxy address if Polymarket uses one
SIGNATURE_TYPE=3              # POLY_1271 deposit wallet (usual)
POLYMARKET_SOURCE=live
BET_USD=5
```

3. Run:

```bash
npm run watch
```

Confirm the TUI shows **LIVE TRADING**. Live mode posts **FOK** (fill-or-kill) market orders. Unfilled orders are cancelled, not left resting.

Do not combine live mode with `--stub-judge` or `POLYMARKET_SOURCE=fixture`.

---

## How it decides

Every ~5s (`TICK_MS`):

1. Load the current `btc-updown-5m-{unix}` market + BTC spot  
2. Ask Jev for side + confidence (+ probabilities)  
3. Apply policy:

| Situation | Action |
|-----------|--------|
| Confidence ≤ 0.90 | Wait |
| Ask too high, or no edge vs ask, or &lt; 90s left | Wait |
| Confidence &gt; 0.90 and edge ok | Buy once (≤ `BET_USD`) |
| Already in a position | Hold until the 5m window ends |

Winners are decided by Polymarket’s rules (Chainlink BTC TWAP vs price to beat), not by share odds.

---

## Useful env vars

| Var | Default | What it does |
|-----|---------|--------------|
| `TYPESAFE_API_KEY` | — | Jev API key |
| `POLYMARKET_SOURCE` | `auto` | `live`, `fixture`, or `auto` |
| `TICK_MS` | `5000` | Seconds between ticks (ms) |
| `ACT_THRESHOLD` | `0.90` | Min confidence to enter (must be **strictly greater**) |
| `MAX_ASK` | `0.70` | Max share price to buy |
| `MIN_EDGE` | `0.10` | Need P(win) ≥ ask + this |
| `BET_USD` | `5` | Max USD per entry |
| `LIVE_TRADING` | off | Set `1` for real CLOB orders |
| `WALLET_PVK` | — | Signer key (live only) |
| `POLYMARKET_FUNDER` | — | Funder / deposit wallet (live) |
| `SIGNATURE_TYPE` | `3` | `3` = POLY_1271 |

Full list is in `.env.example`.

---

## Scripts

```bash
npm run watch         # TUI loop
npm run once          # single tick
npm run typecheck
npm run smoke:policy  # offline policy checks
```

---

## Disclaimer

Experimental software. Not financial advice. You can lose money. Not affiliated with Polymarket or TypeSafe beyond using their APIs/SDKs.
