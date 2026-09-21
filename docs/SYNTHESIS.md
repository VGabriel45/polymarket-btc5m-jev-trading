# Synthesis — WatchSession base + grafts

## Pick

**Base: Candidate 1 (WatchSession + composeFacts + decide).** Agrees with [Cross-judge](c3f82b40-112f-4779-9da7-0dbc69fd996b) (C1 28 vs C2 25). Smaller public API; lean domain; same dry-run discipline.

## Grafts from Candidate 2

1. Structured `AbstainReason` discriminated union (`LOW_CONFIDENCE` | `WORLD_INCOMPLETE` + missing | `JUDGE_FAILED` | `MARKET_UNAVAILABLE`) instead of flat string reasons.
2. Shared Gamma/CLOB parse helpers used by both live and fixture adapters.
3. `idempotencyKey` on `IntendedBuy` + `intentLogTail` on `TickSnapshot`.

## Rejected from C2

- Five-phase Round ADT
- `SpotFact.klines1h` in domain
- Judge-as-lane

## Verification of synthesis

Design package lives in `docs/` (`USAGE.md`, `MODULES.md`) plus live types in `src/domain.ts`. Implementation must match USAGE call sites and encode confidence `> 0.70` via branded `HighConfidence`.
