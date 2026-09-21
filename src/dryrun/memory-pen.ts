import type { DryRunPen, IntendedBuy } from "../domain.js";

export class MemoryPen implements DryRunPen {
  readonly entries: IntendedBuy[] = [];
  private lastKey: string | null = null;

  async record(intended: IntendedBuy): Promise<void> {
    if (this.lastKey === intended.idempotencyKey) return;
    this.lastKey = intended.idempotencyKey;
    this.entries.push(intended);
  }

  tail(limit = 20): ReadonlyArray<IntendedBuy> {
    return this.entries.slice(-limit);
  }
}
