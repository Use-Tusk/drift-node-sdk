import { SpanUtils } from "../../../core/tracing/SpanUtils";
import { TuskDriftCore } from "../../../core/TuskDrift";
import { DateTracker } from "../trackers";
import { JsonSchema, JsonSchemaHelper, SchemaMerges } from "../../../core/tracing/JsonSchemaHelper";
import { CleanSpanData, MockRequestData } from "../../../core/types";
import { StatusCode } from "@use-tusk/drift-schemas/core/span";
import { OriginalGlobalUtils, logger } from "../../../core/utils";

export interface MockRequest {
  service: string;
  operation: string;
  target: string;
  inputData?: any;
  inputSchema?: JsonSchema;
}

export interface MockResponse {
  result: any;
}

// Add filler values for the clean span data fields we don't care about when fetching mocks
function convertMockRequestDataToCleanSpanData(
  mockRequestData: MockRequestData,
  tuskDrift: TuskDriftCore,
  inputValueSchemaMerges?: SchemaMerges,
): CleanSpanData {
  const {
    schema: inputSchema,
    decodedValueHash: inputValueHash,
    decodedSchemaHash: inputSchemaHash,
  } = JsonSchemaHelper.generateSchemaAndHash(mockRequestData.inputValue, inputValueSchemaMerges);

  // log date.now in a readable format
  const originalDate = OriginalGlobalUtils.getOriginalDate();

  return {
    ...mockRequestData,
    parentSpanId: "",
    inputValueHash,
    inputSchema,
    inputSchemaHash,
    outputValue: undefined,
    outputSchema: undefined,
    outputSchemaHash: "",
    outputValueHash: "",
    timestamp: {
      seconds: Math.floor(originalDate.getTime() / 1000),
      nanos: (originalDate.getTime() % 1000) * 1000000,
    },
    duration: {
      seconds: 0,
      nanos: 0,
    },
    isRootSpan: false,
    isPreAppStart: !tuskDrift.isAppReady(),
    metadata: undefined,
    status: {
      code: StatusCode.OK,
      message: "OK",
    },
  };
}

/**
 * Utility function to find mock responses for replay mode across all instrumentations.
 * This centralizes the common logic of:
 * 1. Getting the replay trace ID from context
 * 2. Making the mock request to TuskDrift
 * 3. Handling the response and error cases
 *
 * @param outboundSpan - The outbound span to find a mock response for
 * @param tuskDrift - The TuskDrift instance to make the mock request
 * @param inputValueSchemaOverrides - The schema overrides for the input value
 * @returns Promise<MockResponse | null> - The mock response or null if not found
 */
export async function findMockResponseAsync({
  mockRequestData,
  tuskDrift,
  inputValueSchemaMerges,
}: {
  mockRequestData: MockRequestData;
  tuskDrift: TuskDriftCore;
  inputValueSchemaMerges?: SchemaMerges;
}): Promise<MockResponse | null> {
  const outboundSpan = convertMockRequestDataToCleanSpanData(
    mockRequestData,
    tuskDrift,
    inputValueSchemaMerges,
  );
  try {
    // Get replay trace ID from context
    const replayTraceId = SpanUtils.getCurrentReplayTraceId();

    logger.debug(`Finding ${outboundSpan.traceId} mock for replay trace ID: ${replayTraceId}`);

    const mockResponse = await tuskDrift.requestMockAsync({
      outboundSpan,
      // We could have no replay trace ID if we are finding outbound mocks for calls made before the app started
      testId: replayTraceId || "",
    });

    if (!mockResponse || !mockResponse.found) {
      logger.debug(
        `No matching mock found for ${outboundSpan.traceId} with input value: ${JSON.stringify(
          outboundSpan.inputValue,
        )}`,
        replayTraceId,
      );
      return null;
    }

    const responseBody = (mockResponse.response as any)?.response?.body;
    logger.debug(`Found ${outboundSpan.traceId} mock response:`, responseBody, {
      timestamp: (mockResponse.response as any)?.timestamp,
    });

    // Track the latest timestamp for this trace
    if ((mockResponse.response as any)?.timestamp) {
      DateTracker.updateLatestTimestamp(replayTraceId || "", (mockResponse.response as any).timestamp);
    }

    return {
      result: responseBody,
    };
  } catch (error) {
    logger.error(`Error finding ${outboundSpan.traceId} mock response:`, error);
    return null;
  }
}

export function findMockResponseSync({
  mockRequestData,
  tuskDrift,
  inputValueSchemaMerges,
}: {
  mockRequestData: MockRequestData;
  tuskDrift: TuskDriftCore;
  inputValueSchemaMerges?: SchemaMerges;
}): MockResponse | null {
  const outboundSpan = convertMockRequestDataToCleanSpanData(
    mockRequestData,
    tuskDrift,
    inputValueSchemaMerges,
  );
  try {
    // Get replay trace ID from context
    const replayTraceId = SpanUtils.getCurrentReplayTraceId();

    logger.debug(`Finding ${outboundSpan.traceId} mock for replay trace ID: ${replayTraceId}`);

    const mockResponse = tuskDrift.requestMockSync({
      outboundSpan,
      testId: replayTraceId || "",
    });

    if (!mockResponse || !mockResponse.found) {
      logger.debug(
        `No matching mock found for ${outboundSpan.traceId} with input value: ${JSON.stringify(
          outboundSpan.inputValue,
        )}`,
        replayTraceId,
      );
      return null;
    }

    const responseBody = (mockResponse.response as any)?.response?.body;
    logger.debug(`Found ${outboundSpan.traceId} mock response and timestamp:`, responseBody, {
      timestamp: (mockResponse.response as any)?.timestamp,
    });

    // Track the latest timestamp for this trace
    if ((mockResponse.response as any)?.timestamp) {
      DateTracker.updateLatestTimestamp(replayTraceId || "", (mockResponse.response as any).timestamp);
    }

    return {
      result: responseBody,
    };
  } catch (error) {
    logger.error(`Error finding ${outboundSpan.traceId} mock response:`, error);
    return null;
  }
}
