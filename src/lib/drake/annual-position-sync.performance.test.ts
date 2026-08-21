import { describe, expect, it } from "vitest";
import { runPlansGroupedByWorker } from "./annual-position-sync.server";

describe("sincronização paralela dos timesheets Drake", () => {
  it("processa pessoas diferentes em paralelo e mantém os períodos da mesma pessoa em ordem", async () => {
    const runningWorkers = new Set<string>();
    const observedConcurrency: number[] = [];
    const processed: string[] = [];
    const progress: number[] = [];
    const plans = [
      { workerKey: "A", id: "A-1" },
      { workerKey: "A", id: "A-2" },
      { workerKey: "B", id: "B-1" },
      { workerKey: "C", id: "C-1" },
    ];

    await runPlansGroupedByWorker(
      plans,
      async (plan) => {
        expect(runningWorkers.has(plan.workerKey)).toBe(false);
        runningWorkers.add(plan.workerKey);
        observedConcurrency.push(runningWorkers.size);
        await new Promise((resolve) => setTimeout(resolve, 5));
        processed.push(plan.id);
        runningWorkers.delete(plan.workerKey);
      },
      ({ completedWorkers }) => {
        progress.push(completedWorkers);
      },
      3,
    );

    expect(Math.max(...observedConcurrency)).toBeGreaterThan(1);
    expect(processed.indexOf("A-1")).toBeLessThan(processed.indexOf("A-2"));
    expect(progress.at(-1)).toBe(3);
  });
});
