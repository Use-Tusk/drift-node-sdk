import test from "ava";
import { SpanUtilsErrorTesting, ErrorType } from "../../../core/tracing/SpanUtils.test.helpers";
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
  setAttributes: () => {},
  addEvent: () => {},
  setStatus: () => {},
  end: () => {},
};

// Helper function to execute GraphQL operations
function executeGraphQLOperation(
  operationType: "execute" | "executeSync",
  hasCurrentSpan: boolean = true,
): any {
  // Mock current span info - using manual stub instead of jest.spyOn
  const originalGetCurrentSpanInfo = SpanUtils.getCurrentSpanInfo;
  if (hasCurrentSpan) {
    (SpanUtils as any).getCurrentSpanInfo = () => ({
      span: mockSpan as any,
      traceId: "test-trace-id",
      spanId: "test-span-id",
      context: {} as any,
      isPreAppStart: false,
    });
  } else {
    (SpanUtils as any).getCurrentSpanInfo = () => null;
  }

  if (operationType === "execute") {
    return mockGraphQLExecuteModule.execute(mockExecutionArgs);
  } else {
    return mockGraphQLExecuteModule.executeSync(mockExecutionArgs);
  }
}

/**
 * NOTE: This test suite intentionally generates error messages to test error resilience.
 * Messages like "Error extracting GraphQL metadata" are expected and demonstrate
 * that the instrumentation gracefully handles failures without crashing.
 */
let graphqlInstrumentation: GraphqlInstrumentation;
let originalExecute: any;
let originalExecuteSync: any;

test.before(() => {
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

test.beforeEach(() => {
  // Since graphQL instrumentation calls this.tuskDrift.getMode() to check the current mode
  // Note: Using manual stub instead of jest.spyOn
  const originalGetMode = graphqlInstrumentation["tuskDrift"].getMode;
  graphqlInstrumentation["tuskDrift"].getMode = () => TuskDriftMode.RECORD;
});

test.afterEach(() => {
  SpanUtilsErrorTesting.teardownErrorResilienceTest();
});

test.after.always(() => {
  // Restore original functions
  mockGraphQLExecuteModule.execute = originalExecute;
  mockGraphQLExecuteModule.executeSync = originalExecuteSync;
});

test("GraphQL - execute should complete when SpanUtils.getCurrentSpanInfo throws", async (t) => {
  SpanUtilsErrorTesting.mockGetCurrentSpanInfoWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current span info network error",
  });

  // Call GraphQL execute directly without using helper that would override the mock
  const result = await mockGraphQLExecuteModule.execute(mockExecutionArgs);
  t.is(result.data.hello, "world");
});

test("GraphQL - executeSync should complete when SpanUtils.getCurrentSpanInfo throws", (t) => {
  SpanUtilsErrorTesting.mockGetCurrentSpanInfoWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current span info network error",
  });

  // Call GraphQL executeSync directly without using helper that would override the mock
  const result = mockGraphQLExecuteModule.executeSync(mockExecutionArgs);
  t.is(result.data.hello, "world");
});

test("GraphQL - execute should complete when SpanUtils.addSpanAttributes throws", async (t) => {
  SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span attributes network error",
  });

  const result = await executeGraphQLOperation("execute", true);
  t.is(result.data.hello, "world");
});

test("GraphQL - executeSync should complete when SpanUtils.addSpanAttributes throws", (t) => {
  SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span attributes network error",
  });

  const result = executeGraphQLOperation("executeSync", true);
  t.is(result.data.hello, "world");
});

test("GraphQL - execute should complete when SpanUtils.getCurrentTraceId throws", async (t) => {
  SpanUtilsErrorTesting.mockGetCurrentTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current trace id network error",
  });

  const result = await executeGraphQLOperation("execute", true);
  t.is(result.data.hello, "world");
});

test("GraphQL - executeSync should complete when SpanUtils.getCurrentTraceId throws", (t) => {
  SpanUtilsErrorTesting.mockGetCurrentTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current trace id network error",
  });

  const result = executeGraphQLOperation("executeSync", true);
  t.is(result.data.hello, "world");
});

test("GraphQL - execute should complete when SpanUtils.setCurrentReplayTraceId throws", async (t) => {
  SpanUtilsErrorTesting.mockSetCurrentReplayTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set current replay trace id network error",
  });

  const result = await executeGraphQLOperation("execute", true);
  t.is(result.data.hello, "world");
});

test("GraphQL - executeSync should complete when SpanUtils.setCurrentReplayTraceId throws", (t) => {
  SpanUtilsErrorTesting.mockSetCurrentReplayTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set current replay trace id network error",
  });

  const result = executeGraphQLOperation("executeSync", true);
  t.is(result.data.hello, "world");
});

// Note: GraphQL instrumentation doesn't use createSpan, setStatus, or endSpan directly
// since it only adds metadata to existing parent spans, so we don't test those methods
