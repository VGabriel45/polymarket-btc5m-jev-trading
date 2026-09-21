/**
 * Gated live broker stub. Dry-run is the happy path; live posting is unfinished.
 */
export class LiveBroker {
  async createAndPostOrder(): Promise<never> {
    throw new Error(
      "LiveBroker not wired — set LIVE_TRADING unset/0 and use dry-run (default)",
    );
  }
}

export function assertDryRunOrThrow(liveTrading: boolean): void {
  if (liveTrading) {
    throw new Error(
      "LIVE_TRADING=1 requested but LiveBroker is not wired; refuse to post orders",
    );
  }
}
