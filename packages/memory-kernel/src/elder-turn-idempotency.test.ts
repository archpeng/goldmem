import { describe, expect, it } from "vitest";
import { buildPlan, createHarness } from "../test/harness.js";

describe("elder turn idempotency", () => {
  it("reuses the source and ingest job for repeated client turn ids", async () => {
    const harness = createHarness(buildPlan({}));
    harness.model.turnPlan = {
      intent: "record",
      confidence: 0.9,
      recordText: "今天五点下班。",
      requiresIngestContextRecall: false,
    };

    const first = await harness.kernel.elderTurn({
      elderId: "elder-1",
      text: "今天五点下班。",
      clientTurnId: "client-turn-1",
      traceId: "trace-first",
    });
    const second = await harness.kernel.elderTurn({
      elderId: "elder-1",
      text: "今天五点下班。",
      clientTurnId: "client-turn-1",
      traceId: "trace-second",
    });

    expect(first.draft?.sourceId).toBe(second.draft?.sourceId);
    expect(harness.sourceStore.sources).toHaveLength(1);
    expect(harness.sourceStore.sources[0]?.metadata?.clientTurnId).toBe("client-turn-1");
    expect(harness.memoryProcessingJobStore.jobs.filter((job) => job.type === "ingest_source")).toHaveLength(1);
    expect(harness.audit.records.some((record) => record.type === "memory_ingest_reused")).toBe(true);
  });
});
