import { resolve } from "node:path";
import { autoMarketSource } from "./adapters/polymarket/auto.js";
import { fixtureMarketSource } from "./adapters/polymarket/fixture.js";
import { liveMarketSource } from "./adapters/polymarket/live.js";
import { binanceSpotSource } from "./adapters/binance/live.js";
import { fixedSpotSource } from "./adapters/binance/fixed.js";
import { typeSafeJudge, type JevProvider } from "./adapters/jev/typesafe.js";
import { stubJudge } from "./adapters/jev/stub.js";
import { applyDry } from "./broker/dry.js";
import { LiveBroker } from "./broker/live.js";
import { logPen } from "./dryrun/log-pen.js";
import { defaultPnLPath } from "./pnl/ledger.js";
import type {
  Judge,
  MarketSource,
  OrderExecutor,
  SessionConfig,
  SpotSource,
} from "./domain.js";

export type EnvBag = {
  TYPESAFE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  JEV_PROVIDER?: string;
  JEV_MODEL?: string;
  POLYMARKET_SOURCE?: string;
  BTC_UPDOWN_SLUG?: string;
  TICK_MS?: string;
  ACT_THRESHOLD?: string;
  BET_USD?: string;
  MAX_ASK?: string;
  MIN_EDGE?: string;
  MIN_SECONDS_TO_ENTER?: string;
  MAX_ENTERS_PER_WINDOW?: string;
  FIXTURE_PATH?: string;
  STALE_AFTER_MS?: string;
  LIVE_TRADING?: string;
  PNL_PATH?: string;
  WALLET_PVK?: string;
  POLYMARKET_FUNDER?: string;
  SIGNATURE_TYPE?: string;
  POLYGON_RPC_URL?: string;
};

export type LoadConfigOptions = {
  stubJudge?: boolean;
  fixedSpot?: boolean;
  stubConfidence?: number;
  stubSide?: "UP" | "DOWN";
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

/** Explicit JEV_PROVIDER wins; otherwise OpenRouter only when it is the sole key set. */
function jevProviderFromEnv(env: EnvBag): JevProvider {
  const raw = env.JEV_PROVIDER?.trim().toLowerCase();
  if (raw === "typesafe" || raw === "openrouter") return raw;
  if (raw) {
    throw new Error(`JEV_PROVIDER must be typesafe or openrouter, got ${raw}`);
  }
  if (!env.TYPESAFE_API_KEY?.trim() && env.OPENROUTER_API_KEY?.trim()) {
    return "openrouter";
  }
  return "typesafe";
}

function dryExecutor(): OrderExecutor {
  return {
    async apply(position, action, market, at) {
      return applyDry(position, action, market, at);
    },
  };
}

/**
 * Build SessionConfig from env. Fail-loud if the Jev provider key is missing unless stub.
 * LIVE_TRADING=1 posts via deposit-wallet CLOB v2 (POLY_1271).
 */
export function loadConfig(
  env: NodeJS.ProcessEnv | EnvBag,
  opts: LoadConfigOptions = {},
): SessionConfig {
  const e = env as EnvBag;
  const fixturePath = resolve(
    e.FIXTURE_PATH ?? "fixtures/btc-updown-active.json",
  );
  const threshold = num(e.ACT_THRESHOLD, 0.9);
  const betUsd = num(e.BET_USD, 5);
  const maxAsk = num(e.MAX_ASK, 0.7);
  const minEdge = num(e.MIN_EDGE, 0.1);
  const minSecondsToEnter = Math.max(0, Math.floor(num(e.MIN_SECONDS_TO_ENTER, 90)));
  const maxEntersPerWindow = Math.max(
    1,
    Math.floor(num(e.MAX_ENTERS_PER_WINDOW, 1)),
  );
  const tickMs = num(e.TICK_MS, 5_000);
  const staleAfterMs = num(e.STALE_AFTER_MS, 120_000);
  const liveTrading = e.LIVE_TRADING === "1" || e.LIVE_TRADING === "true";
  const sourceName = (e.POLYMARKET_SOURCE ?? "auto").toLowerCase();
  if (liveTrading && sourceName === "fixture") {
    throw new Error(
      "Refusing LIVE_TRADING with POLYMARKET_SOURCE=fixture (fake token IDs)",
    );
  }
  const pnlPath = resolve(e.PNL_PATH ?? defaultPnLPath());

  let judge: Judge;
  let spot: SpotSource;

  if (opts.stubJudge || opts.overrides?.judge) {
    if (liveTrading) {
      throw new Error(
        "Refusing LIVE_TRADING with --stub-judge (would trade on fake signals)",
      );
    }
    judge =
      opts.overrides?.judge ??
      stubJudge({
        side: opts.stubSide ?? "UP",
        confidence: opts.stubConfidence ?? 0.91,
      });
  } else {
    const provider = jevProviderFromEnv(e);
    const keyEnv =
      provider === "openrouter" ? "OPENROUTER_API_KEY" : "TYPESAFE_API_KEY";
    const apiKey = e[keyEnv]?.trim();
    if (!apiKey) {
      throw new Error(
        `${keyEnv} is required for JEV_PROVIDER=${provider} (or pass --stub-judge for offline smoke)`,
      );
    }
    judge = typeSafeJudge({
      apiKey,
      provider,
      model: e.JEV_MODEL?.trim() || undefined,
    });
  }

  if (opts.overrides?.spot) {
    spot = opts.overrides.spot;
  } else if (opts.fixedSpot) {
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

  let executor: OrderExecutor;
  if (opts.overrides?.executor) {
    executor = opts.overrides.executor;
  } else if (liveTrading) {
    const pk = e.WALLET_PVK?.trim();
    if (!pk) throw new Error("LIVE_TRADING=1 requires WALLET_PVK");
    const live = new LiveBroker({
      privateKey: pk,
      funderAddress: e.POLYMARKET_FUNDER?.trim(),
      rpcUrl: e.POLYGON_RPC_URL,
      signatureType: num(e.SIGNATURE_TYPE, 3),
    });
    executor = {
      apply: (position, action, market, at) =>
        live.apply(position, action, market, at),
    };
  } else {
    executor = dryExecutor();
  }

  return {
    polymarket,
    spot,
    judge,
    pen,
    threshold: opts.overrides?.threshold ?? threshold,
    betUsd: opts.overrides?.betUsd ?? betUsd,
    maxAsk: opts.overrides?.maxAsk ?? maxAsk,
    minEdge: opts.overrides?.minEdge ?? minEdge,
    minSecondsToEnter:
      opts.overrides?.minSecondsToEnter ?? minSecondsToEnter,
    maxEntersPerWindow:
      opts.overrides?.maxEntersPerWindow ?? maxEntersPerWindow,
    tickMs: opts.overrides?.tickMs ?? tickMs,
    staleAfterMs: opts.overrides?.staleAfterMs ?? staleAfterMs,
    windowLengthSec: opts.overrides?.windowLengthSec ?? 300,
    pnlPath: opts.overrides?.pnlPath ?? pnlPath,
    liveTrading: opts.overrides?.liveTrading ?? liveTrading,
    executor,
  };
}
