import type { DryRunPen, IntendedOrder } from "../domain.js";

export function logPen(opts?: { debounceMs?: number }): DryRunPen {
  const debounceMs = opts?.debounceMs ?? 60_000;
  const log: IntendedOrder[] = [];
  let lastKey: string | null = null;
  let lastAt = 0;

  return {
    async record(order: IntendedOrder): Promise<void> {
      const now = Date.now();
      if (lastKey === order.idempotencyKey && now - lastAt < debounceMs) {
        return;
      }
      lastKey = order.idempotencyKey;
      lastAt = now;
      log.push(order);
      console.error(
        `[dry-run] ${order.side} ${order.outcome} size=${order.size} price=${order.price} key=${order.idempotencyKey}`,
      );
    },
    tail(limit = 20): ReadonlyArray<IntendedOrder> {
      return log.slice(-limit);
    },
  };
}
