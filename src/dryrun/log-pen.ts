import type { DryRunPen, IntendedBuy } from "../domain.js";

export function logPen(opts?: { debounceMs?: number }): DryRunPen {
  const debounceMs = opts?.debounceMs ?? 60_000;
  const log: IntendedBuy[] = [];
  let lastKey: string | null = null;
  let lastAt = 0;

  return {
    async record(intended: IntendedBuy): Promise<void> {
      const now = Date.now();
      if (
        lastKey === intended.idempotencyKey &&
        now - lastAt < debounceMs
      ) {
        return;
      }
      lastKey = intended.idempotencyKey;
      lastAt = now;
      log.push(intended);
      console.error(
        `[dry-run] BUY ${intended.outcome} size=${intended.size} price=${intended.price} key=${intended.idempotencyKey}`,
      );
    },
    tail(limit = 20): ReadonlyArray<IntendedBuy> {
      return log.slice(-limit);
    },
  };
}
