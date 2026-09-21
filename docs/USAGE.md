# btc-updown-jev — Usage (candidate 1)

Dry-run agent that watches the active Polymarket **BTC Up or Down** market, feeds typed facts to TypeSafe Jev, and either logs an intended BUY or abstains. Never posts live orders.

## Install & run

```bash
# Node 20+
cp .env.example .env   # TYPESAFE_API_KEY=...  (required unless --stub-judge)
npm install
npm run watch          # Ink TUI, live loop

# Polymarket unreachable on this host? Force fixtures:
POLYMARKET_SOURCE=fixture npm run watch

# Auto: try live Gamma/CLOB, fall back to fixtures on transport failure:
POLYMARKET_SOURCE=auto npm run watch

# One tick, JSON to stdout (no TUI):
npm run tick -- --once
```

Env knobs:

| Var | Default | Meaning |
|-----|---------|---------|
| `TYPESAFE_API_KEY` | — | Required for real Jev; fail-loud if missing |
| `POLYMARKET_SOURCE` | `auto` | `live` \| `fixture` \| `auto` |
| `BTC_UPDOWN_SLUG` | (series resolve) | Optional Gamma event slug override |
| `TICK_MS` | `15000` | Loop interval |
| `ACT_THRESHOLD` | `0.70` | Confidence gate (encoded in types; override for experiments) |
| `DRY_RUN_SIZE` | `10` | Shares on intended BUY log line |

## Mental model

Callers talk to **one** object: `WatchSession`.

```
SpotActor ──┐
            ├── composeFacts() ──► Jev ──► gate ──► DryRunPen (log only)
MarketActor ┘                              │
                                           └── TickSnapshot ──► Ink TUI
```

Each actor keeps **its own latest sample**. Composition happens at the read boundary inside `session.tick()` — nothing shared-mutable across actors.

Wire types (Gamma JSON, CLOB book rows, Binance klines) die inside adapters. Domain + TUI never see them.

---

## Call site 1 — production watch (Ink TUI)

```ts
// src/cli/watch.ts
import { render } from "ink";
import React from "react";
import { WatchSession } from "../session.js";
import { App } from "../tui/App.js";
import { loadConfig } from "../config.js";

const cfg = loadConfig(process.env); // throws if TYPESAFE_API_KEY missing (unless stub)

const session = await WatchSession.open(cfg);
// open() wires: MarketSource (live|fixture|auto), BinanceSpot, TypeSafeJudge, DryRunPen

const { waitUntilExit } = render(
  React.createElement(App, {
    subscribe: (emit) => session.run((snap) => emit(snap)),
  }),
);

await waitUntilExit();
await session.close();
```

`session.run(onSnap)` loops forever: tick → emit `TickSnapshot` → sleep `TICK_MS`. The TUI never calls collectors; it only renders snapshots.

---

## Call site 2 — single tick / CI smoke

```ts
// scripts/once.ts
import { WatchSession } from "../src/session.js";
import { loadConfig } from "../src/config.js";

const session = await WatchSession.open(loadConfig(process.env));
const snap = await session.tick(); // one full gather → judge → gate → pen
console.log(JSON.stringify(snap, null, 2));
await session.close();

// snap.verdict:
//   { kind: "ACT", side: "UP", confidence: 0.82, intended: { ... } }
//   { kind: "ABSTAIN", reason: "low_confidence", confidence: 0.55, side: "DOWN" }
//   { kind: "ABSTAIN", reason: "stale_inputs", ... }
```

Idempotent: calling `tick()` twice with unchanged upstream samples produces the same verdict shape; the DryRunPen dedupes identical intended BUYs within a tick window (same token + side + size + price band).

---

## Call site 3 — fixture market without leaking wire types

```ts
// tests/fixture-tick.test.ts
import { WatchSession } from "../src/session.js";
import { FixtureMarketSource } from "../src/adapters/polymarket/fixture.js";
import { FixedSpotSource } from "../src/adapters/binance/fixed.js";
import { StubJudge } from "../src/adapters/jev/stub.js";
import { MemoryPen } from "../src/dryrun/memory-pen.js";

const pen = new MemoryPen();
const session = await WatchSession.open({
  polymarket: new FixtureMarketSource("fixtures/btc-updown-active.json"),
  spot: new FixedSpotSource({ last: 95_200, change24hPct: 1.4, volume24h: 1.2e9 }),
  judge: new StubJudge({ side: "UP", confidence: 0.81 }), // only for layout/tests
  pen,
  threshold: 0.7,
  dryRunSize: 10,
});

const snap = await session.tick();
assert(snap.verdict.kind === "ACT");
assert(snap.verdict.side === "UP");
assert(pen.entries.length === 1);
assert(pen.entries[0].side === "BUY");
// FixtureMarketSource parses JSON → DomainMarket internally.
// Test never imports GammaEvent / ClobBook types.
```

---

## What you do *not* call

- No `ClobClient.createAndPostOrder` — there is no write client in the dependency graph.
- No raw Gamma URLs from app code — only `MarketSource.pullActiveBtcUpDown()`.
- No assembling Jev `state` in the TUI — state is composed inside `WatchSession.tick()`.
