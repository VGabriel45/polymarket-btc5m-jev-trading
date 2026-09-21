import { resolve } from "node:path";
import { autoMarketSource } from "./adapters/polymarket/auto.js";
import { fixtureMarketSource } from "./adapters/polymarket/fixture.js";
import { liveMarketSource } from "./adapters/polymarket/live.js";
import { binanceSpotSource } from "./adapters/binance/live.js";
import { fixedSpotSource } from "./adapters/binance/fixed.js";
import { typeSafeJudge } from "./adapters/jev/typesafe.js";
import { stubJudge } from "./adapters/jev/stub.js";
import { logPen } from "./dryrun/log-pen.js";
import type { Judge, MarketSource, SessionConfig, SpotSource } from "./domain.js";

export type EnvBag = {
  TYPESAFE_API_KEY?: string;
  POLYMARKET_SOURCE?: string;
  BTC_UPDOWN_SLUG?: string;
  TICK_MS?: string;
  ACT_THRESHOLD?: string;
  DRY_RUN_SIZE?: string;
  FIXTURE_PATH?: string;
  STALE_AFTER_MS?: string;
};

export type LoadConfigOptions = {
  /** CLI --stub-judge: fixed opinion, offline-friendly spot. */
  stubJudge?: boolean;
  stubConfidence?: number;
  stubSide?: "UP" | "DOWN";
  /** Injected ports (tests). When set, skip env wiring for that port. */
  overrides?: Partial<SessionConfig>;
};

function num(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function marketFromEnv(env: EnvBag, fixturePath: string): MarketSource {
  const source = (env.POLYMARKET_SOURCE ?? "auto").toLowerCase();
  const slugOverride = env.BTC_UPDOWN_SLUG || undefined;
  if (source === "fixture") return fixtureMarketSource(fixturePath);
  if (source === "live") return liveMarketSource({ slugOverride });
  return autoMarketSource({ slugOverride, fixturePath });
}

/**
 * Build SessionConfig from env. Fail-loud if TYPESAFE_API_KEY missing unless stub.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv | EnvBag,
  opts: LoadConfigOptions = {},
): SessionConfig {
  const e = env as EnvBag;
  const fixturePath = resolve(
    e.FIXTURE_PATH ?? "fixtures/btc-updown-active.json",
  );
  const threshold = num(e.ACT_THRESHOLD, 0.7);
  const dryRunSize = num(e.DRY_RUN_SIZE, 10);
  const tickMs = num(e.TICK_MS, 15_000);
  const staleAfterMs = num(e.STALE_AFTER_MS, 120_000);

  let judge: Judge;
  let spot: SpotSource;

  if (opts.stubJudge || opts.overrides?.judge) {
    judge =
      opts.overrides?.judge ??
      stubJudge({
        side: opts.stubSide ?? "UP",
        confidence: opts.stubConfidence ?? 0.81,
      });
  } else {
    const apiKey = e.TYPESAFE_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "TYPESAFE_API_KEY is required (or pass --stub-judge for offline smoke)",
      );
    }
    judge = typeSafeJudge({ apiKey, model: "jev-1.13.0" });
  }

  if (opts.overrides?.spot) {
    spot = opts.overrides.spot;
  } else if (opts.stubJudge) {
    // Offline smoke: no live Binance dependency when stubbing the judge
    spot = fixedSpotSource({
      last: 95_200,
      change24hPct: 1.4,
      volume24h: 1.2e9,
    });
  } else {
    spot = binanceSpotSource();
  }

  const polymarket =
    opts.overrides?.polymarket ?? marketFromEnv(e, fixturePath);
  const pen = opts.overrides?.pen ?? logPen();

  return {
    polymarket,
    spot,
    judge,
    pen,
    threshold: opts.overrides?.threshold ?? threshold,
    dryRunSize: opts.overrides?.dryRunSize ?? dryRunSize,
    tickMs: opts.overrides?.tickMs ?? tickMs,
    staleAfterMs: opts.overrides?.staleAfterMs ?? staleAfterMs,
  };
}
