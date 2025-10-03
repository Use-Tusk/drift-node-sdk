import { SpanUtilsErrorTesting, ErrorType } from "../../../test-utils/spanUtilsErrorTesting";
import { GraphqlInstrumentation } from "./Instrumentation";
import { TuskDriftMode } from "../../../core/TuskDrift";
import { SpanUtils } from "../../../core/tracing/SpanUtils";

// Mock GraphQL execution module
const mockGraphQLExecuteModule = {
  execute: (args: any) => {
    return Promise.resolve({
      data: { hello: "world" },
    });
  },
  executeSync: (args: any) => {
    return {
      data: { hello: "world" },
    };
  },
};

// Mock GraphQL document for testing
const mockGraphQLDocument = {
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { value: "TestQuery" },
      selectionSet: {
        selections: [
          {
            kind: "Field",
            name: { value: "hello" },
          },
        ],
      },
    },
  ],
};

const mockExecutionArgs = {
  document: mockGraphQLDocument,
  operationName: "TestQuery",
  variableValues: {},
};

// Mock span for testing
const mockSpan = {
  setAttributes: jest.fn(),
  addEvent: jest.fn(),
  setStatus: jest.fn(),
  end: jest.fn(),
};

// Helper function to execute GraphQL operations
function executeGraphQLOperation(
  operationType: "execute" | "executeSync",
  hasCurrentSpan: boolean = true,
): any {
  // Mock current span info
  if (hasCurrentSpan) {
    jest.spyOn(SpanUtils, "getCurrentSpanInfo").mockReturnValue({
      span: mockSpan as any,
      traceId: "test-trace-id",
      spanId: "test-span-id",
      context: {} as any,
      isPreAppStart: false,
    });
  } else {
    jest.spyOn(SpanUtils, "getCurrentSpanInfo").mockReturnValue(null);
  }

  if (operationType === "execute") {
    return mockGraphQLExecuteModule.execute(mockExecutionArgs);
  } else {
    return mockGraphQLExecuteModule.executeSync(mockExecutionArgs);
  }
}

describe("GraphQL Instrumentation Error Resilience", () => {
  let graphqlInstrumentation: GraphqlInstrumentation;
  let originalExecute: any;
  let originalExecuteSync: any;

  beforeAll(() => {
    // Store original functions once
    originalExecute = mockGraphQLExecuteModule.execute;
    originalExecuteSync = mockGraphQLExecuteModule.executeSync;

    graphqlInstrumentation = new GraphqlInstrumentation({
      mode: TuskDriftMode.RECORD,
    });

    // Initialize instrumentation which patches the modules
    const modules = graphqlInstrumentation.init();

    // Apply patches to our mock modules
    modules.forEach((module) => {
      if (module.name === "graphql" && module.files) {
        module.files.forEach((file) => {
          if (file.name.includes("execute.js") && file.patch) {
            file.patch(mockGraphQLExecuteModule);
          }
        });
      }
    });
  });

  beforeEach(() => {
    // Since graphQL instrumentation calls this.tuskDrift.getMode() to check the current mode
    jest
      .spyOn(graphqlInstrumentation["tuskDrift"], "getMode")
      .mockReturnValue(TuskDriftMode.RECORD);
  });

  afterEach(() => {
    SpanUtilsErrorTesting.teardownErrorResilienceTest();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    // Restore original functions
    mockGraphQLExecuteModule.execute = originalExecute;
    mockGraphQLExecuteModule.executeSync = originalExecuteSync;
  });

  describe("GraphQL Execute Error Resilience", () => {
    it("should complete GraphQL execute when SpanUtils.getCurrentSpanInfo throws", async () => {
      SpanUtilsErrorTesting.mockGetCurrentSpanInfoWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span get current span info network error",
      });

      // Call GraphQL execute directly without using helper that would override the mock
      const result = await mockGraphQLExecuteModule.execute(mockExecutionArgs);
      expect(result.data.hello).toBe("world");
    });

    it("should complete GraphQL executeSync when SpanUtils.getCurrentSpanInfo throws", () => {
      SpanUtilsErrorTesting.mockGetCurrentSpanInfoWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span get current span info network error",
      });

      // Call GraphQL executeSync directly without using helper that would override the mock
      const result = mockGraphQLExecuteModule.executeSync(mockExecutionArgs);
      expect(result.data.hello).toBe("world");
    });

    it("should complete GraphQL execute when SpanUtils.addSpanAttributes throws", async () => {
      SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span attributes network error",
      });

      const result = await executeGraphQLOperation("execute", true);
      expect(result.data.hello).toBe("world");
    });

    it("should complete GraphQL executeSync when SpanUtils.addSpanAttributes throws", () => {
      SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span attributes network error",
      });

      const result = executeGraphQLOperation("executeSync", true);
      expect(result.data.hello).toBe("world");
    });

    it("should complete GraphQL execute when SpanUtils.getCurrentTraceId throws", async () => {
      SpanUtilsErrorTesting.mockGetCurrentTraceIdWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span get current trace id network error",
      });

      const result = await executeGraphQLOperation("execute", true);
      expect(result.data.hello).toBe("world");
    });

    it("should complete GraphQL executeSync when SpanUtils.getCurrentTraceId throws", () => {
      SpanUtilsErrorTesting.mockGetCurrentTraceIdWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span get current trace id network error",
      });

      const result = executeGraphQLOperation("executeSync", true);
      expect(result.data.hello).toBe("world");
    });

    it("should complete GraphQL execute when SpanUtils.setCurrentReplayTraceId throws", async () => {
      SpanUtilsErrorTesting.mockSetCurrentReplayTraceIdWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span set current replay trace id network error",
      });

      const result = await executeGraphQLOperation("execute", true);
      expect(result.data.hello).toBe("world");
    });

    it("should complete GraphQL executeSync when SpanUtils.setCurrentReplayTraceId throws", () => {
      SpanUtilsErrorTesting.mockSetCurrentReplayTraceIdWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span set current replay trace id network error",
      });

      const result = executeGraphQLOperation("executeSync", true);
      expect(result.data.hello).toBe("world");
    });

    // Note: GraphQL instrumentation doesn't use createSpan, setStatus, or endSpan directly
    // since it only adds metadata to existing parent spans, so we don't test those methods
  });
});
