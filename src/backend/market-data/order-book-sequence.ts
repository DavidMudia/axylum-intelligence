import type { OrderBookUpdate } from "./types";

export type SequenceResult = "accepted" | "stale" | "gap" | "unsynchronized";

export class OrderBookSequenceTracker {
  private lastUpdateId: bigint;
  private synchronized = true;

  constructor(snapshotUpdateId: string) {
    if (!/^\d+$/.test(snapshotUpdateId)) throw new Error("Order book snapshot update ID is invalid");
    this.lastUpdateId = BigInt(snapshotUpdateId);
  }

  accept(update: Pick<OrderBookUpdate, "firstUpdateId" | "lastUpdateId">): SequenceResult {
    if (!this.synchronized) return "unsynchronized";

    const first = BigInt(update.firstUpdateId);
    const last = BigInt(update.lastUpdateId);
    if (last <= this.lastUpdateId) return "stale";
    if (first > this.lastUpdateId + BigInt(1)) {
      this.synchronized = false;
      return "gap";
    }

    this.lastUpdateId = last;
    return "accepted";
  }

  reset(snapshotUpdateId: string): void {
    if (!/^\d+$/.test(snapshotUpdateId)) throw new Error("Order book snapshot update ID is invalid");
    this.lastUpdateId = BigInt(snapshotUpdateId);
    this.synchronized = true;
  }

  invalidate(): void {
    this.synchronized = false;
  }

  get isSynchronized(): boolean {
    return this.synchronized;
  }
}
