import type {
  DomainMarket,
  IntendedOrder,
  IsoTime,
  Position,
  TradeAction,
} from "../domain.js";

export type DryApplyResult = {
  position: Position;
  orders: IntendedOrder[];
};

/**
 * Simulate fills for a TradeAction. BUY at order.price (ask), SELL at order.price (bid).
 */
export function applyDry(
  position: Position,
  action: TradeAction,
  market: DomainMarket,
  at: IsoTime,
): DryApplyResult {
  switch (action.kind) {
    case "ABSTAIN":
    case "HOLD":
      return { position, orders: [] };
    case "ENTER": {
      if (position.kind === "open") {
        return { position, orders: [] };
      }
      const order = action.order;
      return {
        position: {
          kind: "open",
          side: action.side,
          tokenId: order.tokenId,
          size: order.size,
          entryPrice: order.price,
          openedAt: at,
          slug: market.eventSlug,
        },
        orders: [order],
      };
    }
    case "EXIT": {
      if (position.kind !== "open") {
        return { position: { kind: "flat" }, orders: [] };
      }
      return { position: { kind: "flat" }, orders: [action.order] };
    }
    case "SWITCH": {
      if (position.kind !== "open") {
        return { position, orders: [] };
      }
      const enter = action.enter;
      return {
        position: {
          kind: "open",
          side: action.to,
          tokenId: enter.tokenId,
          size: enter.size,
          entryPrice: enter.price,
          openedAt: at,
          slug: market.eventSlug,
        },
        orders: [action.exit, enter],
      };
    }
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
