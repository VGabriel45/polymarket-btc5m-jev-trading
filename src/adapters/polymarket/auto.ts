import type { DomainMarket, MarketSource, Sample } from "../../domain.js";
import { fixtureMarketSource } from "./fixture.js";
import { liveMarketSource } from "./live.js";
import { isTransportFailure } from "./wire.js";

export function autoMarketSource(opts: {
  slugOverride?: string;
  fixturePath: string;
}): MarketSource {
  const live = liveMarketSource({ slugOverride: opts.slugOverride });
  const fixture = fixtureMarketSource(opts.fixturePath);
  let useFixture = false;

  return {
    async pullActiveBtcUpDown(): Promise<Sample<DomainMarket>> {
      if (useFixture) return fixture.pullActiveBtcUpDown();
      try {
        return await live.pullActiveBtcUpDown();
      } catch (err) {
        if (!isTransportFailure(err)) throw err;
        useFixture = true;
        return fixture.pullActiveBtcUpDown();
      }
    },
    async pullBySlug(slug: string): Promise<Sample<DomainMarket>> {
      if (useFixture) return fixture.pullActiveBtcUpDown();
      try {
        return await live.pullBySlug!(slug);
      } catch (err) {
        if (!isTransportFailure(err)) throw err;
        useFixture = true;
        return fixture.pullActiveBtcUpDown();
      }
    },
  };
}
