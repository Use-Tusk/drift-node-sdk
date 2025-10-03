import { CleanSpanData } from "./types";
import { memoryStore } from "./MemoryStore";
import { JsonSchema, JsonSchemaHelper } from "./tracing/JsonSchemaHelper";
import { logger } from "./utils/logger";

interface MockMatcherRequestData {
  inputValue: any;
  inputValueHash: string;
  inputSchema: JsonSchema;
  inputSchemaHash: string;
}

// Idealy CLI should always return a mock or cancel the inbound request
/**
 * Abstract mock matching service for finding appropriate mocks based on request data
 * This will be used across all instrumentations to match incoming requests with recorded mocks
 */
export class MockMatcher {
  /**
   * Find the best matching mock for a given request from available mocks
   * Implements priority-based matching:
   * 1. Unused mock by input value hash
   * 2. Used mock by input value hash
   * 3. Unused mock by input value hash with headers removed
   * 4. Used mock by input value hash with headers removed
   * 5. Unused mock by input schema hash
   * 6. Used mock by input schema hash
   *
   * If multiple mocks match at any level, picks the one recorded first.
   *
   * @param requestData - The request data representing the current request
   * @param availableMocks - Array of recorded mock span data for the trace
   * @param stackTrace - The stack trace of the current request (just kept here since we will pass this to the CLI)
   * @returns The matching mock span data, or null if no suitable match is found
   */
  static findBestMatch({
    outboundSpan,
    replayTraceId,
    stackTrace,
  }: {
    outboundSpan: CleanSpanData;
    replayTraceId: string;
    stackTrace?: string;
  }): CleanSpanData | null {
    const {
      schema: inputSchema,
      decodedValueHash: inputValueHash,
      decodedSchemaHash: inputSchemaHash,
    } = JsonSchemaHelper.generateSchemaAndHash(outboundSpan.inputValue);

    const requestData = {
      inputValue: outboundSpan.inputValue,
      inputValueHash,
      inputSchema,
      inputSchemaHash,
    };

    const availableMocks = memoryStore.getRequestReplayMocks(replayTraceId);
    if (!availableMocks) {
      logger.debug("MockMatcher no available mocks found for replay trace id:", replayTraceId);
      return null;
    }

    logger.debug("MockMatcher finding best match for request:", {
      availableMocksCount: availableMocks.length,
    });

    // Sort all mocks by timestamp to ensure "recorded first" ordering for tie-breaking
    const sortedMocks = [...availableMocks].sort(
      (a, b) => new Date(a.timestamp.seconds).getTime() - new Date(b.timestamp.seconds).getTime(),
    );

    // Priority 1: Unused mock by input value hash
    let match = this.findUnusedMockByInputValueHash(requestData, sortedMocks);
    if (match) {
      logger.debug("MockMatcher found unused mock by input value hash:", match.name);
      this.markMockAsUsed(match);
      return match;
    }

    // Priority 2: Used mock by input value hash
    match = this.findUsedMockByInputValueHash(requestData, sortedMocks);
    if (match) {
      logger.debug("MockMatcher found used mock by input value hash:", match.name);
      return match;
    }

    // Priority 3: Unused mock by input value hash with headers removed
    match = this.findUnusedMockByInputValueHashWithoutHeaders(requestData, sortedMocks);
    if (match) {
      logger.debug(
        "MockMatcher Found unused mock by input value hash without headers:",
        match.name,
      );
      this.markMockAsUsed(match);
      return match;
    }

    // Priority 4: Used mock by input value hash with headers removed
    match = this.findUsedMockByInputValueHashWithoutHeaders(requestData, sortedMocks);
    if (match) {
      logger.debug("MockMatcher found used mock by input value hash without headers:", match.name);
      return match;
    }

    // Priority 5: Unused mock by input schema hash
    match = this.findUnusedMockByInputSchemaHash(requestData, sortedMocks);
    if (match) {
      logger.debug("MockMatcher found unused mock by input schema hash:", match.name);
      this.markMockAsUsed(match);
      return match;
    }

    // Priority 6: Used mock by input schema hash
    match = this.findUsedMockByInputSchemaHash(requestData, sortedMocks);
    if (match) {
      logger.debug("MockMatcher found used mock by input schema hash:", match.name);
      return match;
    }

    logger.error("MockMatcher no matching mock found with any strategy", requestData);
    return null;
  }

  /**
   * Mark a mock as used to track usage in priority matching
   */
  private static markMockAsUsed(mock: CleanSpanData): void {
    mock.isUsed = true;
  }

  /**
   * Check if a mock is unused
   */
  private static isUnused(mock: CleanSpanData): boolean {
    return !mock.isUsed;
  }

  /**
   * Check if a mock is used
   */
  private static isUsed(mock: CleanSpanData): boolean {
    return !!mock.isUsed;
  }

  /**
   * Find unused mock by exact input value hash match
   */
  private static findUnusedMockByInputValueHash(
    requestData: MockMatcherRequestData,
    sortedMocks: CleanSpanData[],
  ): CleanSpanData | null {
    return (
      sortedMocks.find(
        (mock) => this.isUnused(mock) && mock.inputValueHash === requestData.inputValueHash,
      ) || null
    );
  }

  /**
   * Find used mock by exact input value hash match
   */
  private static findUsedMockByInputValueHash(
    requestData: MockMatcherRequestData,
    sortedMocks: CleanSpanData[],
  ): CleanSpanData | null {
    return (
      sortedMocks.find(
        (mock) => this.isUsed(mock) && mock.inputValueHash === requestData.inputValueHash,
      ) || null
    );
  }

  /**
   * Find unused mock by input value hash with headers removed
   */
  private static findUnusedMockByInputValueHashWithoutHeaders(
    requestData: MockMatcherRequestData,
    sortedMocks: CleanSpanData[],
  ): CleanSpanData | null {
    const requestInputWithoutHeaders = this.removeHeadersFromInputValue(requestData.inputValue);
    const requestHashWithoutHeaders = JsonSchemaHelper.generateDeterministicHash(
      requestInputWithoutHeaders,
    );

    return (
      sortedMocks.find((mock) => {
        if (!this.isUnused(mock)) return false;

        const mockInputWithoutHeaders = this.removeHeadersFromInputValue(mock.inputValue);
        const mockHashWithoutHeaders =
          JsonSchemaHelper.generateDeterministicHash(mockInputWithoutHeaders);

        return mockHashWithoutHeaders === requestHashWithoutHeaders;
      }) || null
    );
  }

  /**
   * Find used mock by input value hash with headers removed
   */
  private static findUsedMockByInputValueHashWithoutHeaders(
    requestData: MockMatcherRequestData,
    sortedMocks: CleanSpanData[],
  ): CleanSpanData | null {
    const requestInputWithoutHeaders = this.removeHeadersFromInputValue(requestData.inputValue);
    const requestHashWithoutHeaders = JsonSchemaHelper.generateDeterministicHash(
      requestInputWithoutHeaders,
    );

    return (
      sortedMocks.find((mock) => {
        if (!this.isUsed(mock)) return false;

        const mockInputWithoutHeaders = this.removeHeadersFromInputValue(mock.inputValue);
        const mockHashWithoutHeaders =
          JsonSchemaHelper.generateDeterministicHash(mockInputWithoutHeaders);

        return mockHashWithoutHeaders === requestHashWithoutHeaders;
      }) || null
    );
  }

  /**
   * Find unused mock by input schema hash match
   */
  private static findUnusedMockByInputSchemaHash(
    requestData: MockMatcherRequestData,
    sortedMocks: CleanSpanData[],
  ): CleanSpanData | null {
    return (
      sortedMocks.find(
        (mock) => this.isUnused(mock) && mock.inputSchemaHash === requestData.inputSchemaHash,
      ) || null
    );
  }

  /**
   * Find used mock by input schema hash match
   */
  private static findUsedMockByInputSchemaHash(
    requestData: MockMatcherRequestData,
    sortedMocks: CleanSpanData[],
  ): CleanSpanData | null {
    return (
      sortedMocks.find(
        (mock) => this.isUsed(mock) && mock.inputSchemaHash === requestData.inputSchemaHash,
      ) || null
    );
  }

  /**
   * Remove headers property from input value for header-agnostic matching
   */
  private static removeHeadersFromInputValue(inputValue: any): any {
    if (!inputValue || typeof inputValue !== "object") {
      return inputValue;
    }

    const { headers, ...inputWithoutHeaders } = inputValue;
    return inputWithoutHeaders;
  }
}
