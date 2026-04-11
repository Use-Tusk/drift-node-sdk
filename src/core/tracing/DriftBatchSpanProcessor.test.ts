import test from "ava";
import { ExportResultCode } from "@opentelemetry/core";
import { TuskDriftMode } from "../TuskDrift";
import { DriftBatchSpanProcessor } from "./DriftBatchSpanProcessor";
import type { TdSpanExporter } from "./TdSpanExporter";

function createMockSpan(name: string) {
  return {
    name,
  };
}

test("exports a batch when max batch size is reached", async (t) => {
  const exportedBatchSizes: number[] = [];
  const exporter = {
    export(spans: unknown[], resultCallback: (result: { code: ExportResultCode }) => void) {
      exportedBatchSizes.push(spans.length);
      resultCallback({ code: ExportResultCode.SUCCESS });
    },
    async shutdown() {},
  } as unknown as TdSpanExporter;

  const processor = new DriftBatchSpanProcessor({
    exporter,
    config: {
      maxQueueSize: 10,
      maxExportBatchSize: 2,
      scheduledDelayMillis: 1000,
    },
    mode: TuskDriftMode.RECORD,
  });

  processor.onEnd(createMockSpan("one") as never);
  processor.onEnd(createMockSpan("two") as never);

  await new Promise((resolve) => setTimeout(resolve, 0));

  t.deepEqual(exportedBatchSizes, [2]);
  await processor.shutdown();
});

test("drops spans when the queue is full", async (t) => {
  const exporter = {
    export(_spans: unknown[], resultCallback: (result: { code: ExportResultCode }) => void) {
      resultCallback({ code: ExportResultCode.SUCCESS });
    },
    async shutdown() {},
  } as unknown as TdSpanExporter;

  const processor = new DriftBatchSpanProcessor({
    exporter,
    config: {
      maxQueueSize: 1,
      maxExportBatchSize: 10,
      scheduledDelayMillis: 1000,
    },
    mode: TuskDriftMode.RECORD,
  });

  processor.onEnd(createMockSpan("one") as never);
  processor.onEnd(createMockSpan("two") as never);

  const snapshot = processor.getHealthSnapshot();
  t.is(snapshot.queueSize, 1);
  t.is(snapshot.droppedSpanCount, 1);

  await processor.shutdown();
});
