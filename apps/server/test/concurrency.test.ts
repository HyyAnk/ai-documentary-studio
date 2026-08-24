import { describe, expect, it } from "vitest";
import { runConcurrent } from "../src/utils/concurrency.js";

describe("runConcurrent worker pool", () => {
  it("processes items concurrently and preserves order", async () => {
    const items = [50, 10, 30, 20, 40];
    const startedOrder: number[] = [];
    const completedOrder: number[] = [];

    const results = await runConcurrent(items, 3, async (ms, index) => {
      startedOrder.push(index);
      await new Promise((resolve) => setTimeout(resolve, ms));
      completedOrder.push(index);
      return `result-${index}-${ms}`;
    });

    expect(results).toEqual([
      "result-0-50",
      "result-1-10",
      "result-2-30",
      "result-3-20",
      "result-4-40",
    ]);
    expect(startedOrder.slice(0, 3)).toEqual([0, 1, 2]);
    expect(completedOrder[0]).toBe(1); // 10ms finished first
  });

  it("handles empty items gracefully", async () => {
    const results = await runConcurrent([], 4, async () => "value");
    expect(results).toEqual([]);
  });

  it("handles single item or concurrency greater than items", async () => {
    const results = await runConcurrent([1, 2], 10, async (item) => item * 2);
    expect(results).toEqual([2, 4]);
  });
});
