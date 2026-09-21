import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  asIsoTime,
  nowIso,
  type DomainMarket,
  type MarketSource,
  type Sample,
} from "../../domain.js";
import { domainMarketFromDomainJson } from "./wire.js";

export function fixtureMarketSource(path: string): MarketSource {
  return {
    async pullActiveBtcUpDown(): Promise<Sample<DomainMarket>> {
      const abs = resolve(path);
      const raw = JSON.parse(await readFile(abs, "utf8")) as unknown;
      const value = domainMarketFromDomainJson(raw);
      const pulledAt = nowIso();
      return {
        value,
        freshness: { pulledAt: asIsoTime(pulledAt), ageMs: 0 },
        source: "fixture",
      };
    },
  };
}

export class FixtureMarketSource implements MarketSource {
  private readonly inner: MarketSource;
  constructor(path: string) {
    this.inner = fixtureMarketSource(path);
  }
  pullActiveBtcUpDown(): Promise<Sample<DomainMarket>> {
    return this.inner.pullActiveBtcUpDown();
  }
}
