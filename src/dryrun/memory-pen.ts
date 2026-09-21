import type { DryRunPen, IntendedOrder } from "../domain.js";

export class MemoryPen implements DryRunPen {
  readonly entries: IntendedOrder[] = [];
  private lastKey: string | null = null;

  async record(order: IntendedOrder): Promise<void> {
    if (this.lastKey === order.idempotencyKey) return;
    this.lastKey = order.idempotencyKey;
    this.entries.push(order);
  }

  tail(limit = 20): ReadonlyArray<IntendedOrder> {
    return this.entries.slice(-limit);
  }
}
