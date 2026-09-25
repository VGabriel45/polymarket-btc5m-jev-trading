# Module map — candidate 1

## Layout

```
src/
  session.ts              # WatchSession — only deep public surface
  compose.ts              # composeFacts + Sample freshness rules
  decide.ts               # gate, decide, IntendedBuy builder
  domain.ts               # DomainMarket, SpotPulse, Verdict, brands (from TYPES)
  config.ts               # loadConfig(env) → SessionConfig wiring
  adapters/
    polymarket/
      live.ts             # Gamma resolve + CLOB reads → DomainMarket (wire dies here)
      fixture.ts          # JSON fixture → DomainMarket
      auto.ts             # live-then-fixture sticky fallback
      wire.ts             # PRIVATE: Gamma/CLOB parse helpers (never exported up)
    binance/
      live.ts             # klines + ticker → SpotPulse (wire dies here)
      fixed.ts            # test/fixture spot
    jev/
      typesafe.ts         # TypeSafeClient.systemOne (TypeSafe or OpenRouter) → JudgeOpinion
      stub.ts             # --stub-judge / tests only
  dryrun/
    log-pen.ts            # console/file intended BUY; idempotent debounce
    memory-pen.ts         # tests
  tui/
    App.tsx               # Ink root; subscribe(emit)
    panels.tsx            # Market / BTC / Verdict / Pen panes (pure from TickSnapshot)
  cli/
    watch.ts              # npm run watch
    once.ts               # npm run tick -- --once
fixtures/
  btc-updown-active.json  # Domain-shaped (or wire→parse in fixture adapter only)
vendor/
  polymarket-agent-skills/  # documented patterns (Gamma + CLOB reads)
```

## Tick call chain (≤3 files to trace)

1. **`session.ts`** — `tick()`: pull market + spot in parallel →
2. **`compose.ts`** — `composeFacts(marketSample, spotSample)` →
3. **`decide.ts`** — after `judge.ask(facts)`, `decide(...)` → optional `pen.record`

Adapters are leaves called from `session.ts`; they do not call each other. TUI never enters this chain.

## Responsibilities

| Module | Owns | Does not own |
|--------|------|--------------|
| `session.ts` | Loop, actor sample slots, snapshot assembly | Wire parsing, Ink layout, Jev SDK details |
| `compose.ts` | Merge-at-read, staleness, `FactsForJev` shape | Threshold / ACT logic |
| `decide.ts` | `gate`, Verdict ADT construction, IntendedBuy | Network I/O |
| `adapters/polymarket/*` | Gamma slug/series resolve, CLOB mid/spread/book → `DomainMarket` | Decision, TUI |
| `adapters/binance/*` | 24h stats arithmetic from klines/ticker → `SpotPulse` | Jev state packaging |
| `adapters/jev/*` | `choice(UP/DOWN)` call, confidence parse | Threshold gate (app-owned) |
| `dryrun/*` | Log intended BUY only | Any CLOB write client |
| `tui/*` | Colorful render of `TickSnapshot` | Fetching / judging |

## Shared state rule

- **MarketActor** (inside session): `lastMarket: Sample<DomainMarket> | null` + health
- **SpotActor** (inside session): `lastSpot: Sample<SpotPulse> | null` + health
- No global store. `composeFacts` is the sole merge. Snapshot is a pure projection for the TUI.

## Polymarket live adapter (patterns from vendor skill)

Inside `adapters/polymarket/live.ts` / `wire.ts` only:

1. Gamma `GET /events?slug=…` or series/tag search for active BTC Up/Down (`active=true&closed=false`)
2. Read `markets[].clobTokenIds` / outcomes → map to `Side` UP/DOWN
3. Unauthed `ClobClient` reads: `getMidpoint`, `getSpread`, `getLastTradePrice`, optional `getOrderBook` for bid/ask
4. Emit `Sample<DomainMarket>` with `source: "live"`

`auto.ts`: on HTTP/transport failure (incl. HTTP 000 class), sticky-switch to `fixture.ts` and set `source: "fixture"` thereafter.

## Anti-patterns explicitly rejected

- No `services/gather → services/validate → services/transform → services/decide` pipeline (temporal shallow layers)
- No re-export of Gamma event DTOs as "Market"
- No pass-through `MarketService.getMarket()` that returns the same shape three modules deep
- No TUI import of adapters
