import {
  trace,
  context,
  Span,
  SpanStatusCode,
  SpanKind,
  Context,
  Attributes,
  SpanStatus,
} from "@opentelemetry/api";
import {
  IS_PRE_APP_START_CONTEXT_KEY,
  REPLAY_TRACE_ID_CONTEXT_KEY,
  SPAN_KIND_CONTEXT_KEY,
  STOP_RECORDING_CHILD_SPANS_CONTEXT_KEY,
  TdSpanAttributes,
} from "../types";
import { TuskDriftCore, TuskDriftMode } from "../TuskDrift";
import { createSpanInputValue } from "../utils/dataNormalizationUtils";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { SchemaMerges } from "./JsonSchemaHelper";
import { logger } from "../utils/logger";
import { TraceBlockingManager } from "./TraceBlockingManager";

export interface SpanInfo {
  traceId: string;
  spanId: string;
  span: Span;
  context: Context;
  isPreAppStart: boolean;
}

export interface CreateSpanOptions {
  name: string;
  kind: SpanKind;
  attributes?: Attributes;
  parentContext?: Context;
  isPreAppStart: boolean;
}

export interface SpanExecutorOptions {
  name: string;
  kind: SpanKind;
  packageType?: PackageType;
  packageName: string;
  instrumentationName: string;
  submodule: string;
  inputValue: Record<string, unknown>;
  outputValue?: Record<string, unknown>;
  isPreAppStart: boolean;
  inputSchemaMerges?: SchemaMerges;
  metadata?: Record<string, unknown>;
  stopRecordingChildSpans?: boolean;
}

export interface AddSpanAttributesOptions {
  name?: string;
  packageName?: string;
  instrumentationName?: string;
  packageType?: PackageType;
  submodule?: string;
  isPreAppStart?: boolean;
  inputValue?: Record<string, unknown>;
  outputValue?: Record<string, unknown>;
  inputSchemaMerges?: SchemaMerges;
  outputSchemaMerges?: SchemaMerges;
  metadata?: Record<string, unknown>;
  transformMetadata?: {
    transformed: boolean;
    actions: Array<{
      type: "redact" | "mask" | "replace" | "drop";
      field: string;
      reason: string;
      description?: string;
    }>;
  };
}

export class SpanUtils {
  /**
   * Creates a new span and returns span info including trace ID and span ID
   */
  static createSpan(options: CreateSpanOptions): SpanInfo | null {
    try {
      // Get tracer from the global trace API
      const tracer = TuskDriftCore.getInstance().getTracer();
      const parentContext = options.parentContext || context.active();

      // Check if we should block span creation for this trace
      // This happens when a previous span in this trace exceeded size limits
      const activeSpan = trace.getSpan(parentContext);
      if (activeSpan) {
        const parentTraceId = activeSpan.spanContext().traceId;
        const traceBlockingManager = TraceBlockingManager.getInstance();

        if (traceBlockingManager.isTraceBlocked(parentTraceId)) {
          logger.debug(
            `[SpanUtils] Skipping span creation for '${options.name}' - trace ${parentTraceId} is blocked`,
          );
          return null;
        }
      }

      // We can add a bunch of attributes to the span here, everything we want to store in tusk drift backend
      const span = tracer.startSpan(
        options.name,
        {
          kind: options.kind || SpanKind.CLIENT,
          attributes: options.attributes || {},
        },
        parentContext,
      );

      const spanContext = span.spanContext();

      const newContext = trace
        .setSpan(parentContext, span)
        // This will be used by TCP instrumentation to determine if we have unpatched dependencies
        .setValue(SPAN_KIND_CONTEXT_KEY, options.kind)
        .setValue(IS_PRE_APP_START_CONTEXT_KEY, options.isPreAppStart);

      return {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        span,
        context: newContext,
        isPreAppStart: options.isPreAppStart,
      };
    } catch (error) {
      logger.error("SpanUtils error creating span:", error);
      return null;
    }
  }

  /**
   * Executes a function within a span context
   */
  static withSpan<T>(spanInfo: SpanInfo, fn: () => T): T {
    return context.with(spanInfo.context, fn);
  }

  /**
   * Execute a function within a properly configured span
   *
   * If there is an error creating the span:
   * - In record mode, the original function will be called
   * - In replay mode, an error will be thrown
   *
   * @param mode The mode of the TuskDrift instance
   * @param originalFunctionCall The function to call if the span is not created
   * @param options Span configuration options
   * @param fn Function to execute within the span
   * @param contextTarget Optional target object to inject trace context into (for HTTP/fetch)
   * @returns The result of the function execution
   */
  static createAndExecuteSpan<T>(
    mode: TuskDriftMode,
    originalFunctionCall: () => T,
    options: SpanExecutorOptions,
    fn: (spanInfo: SpanInfo) => T,
  ): T {
    // Check if we should stop recording child spans for this span
    const spanContext = trace.getActiveSpan()?.spanContext();
    if (spanContext) {
      const stopRecordingChildSpans = context
        .active()
        .getValue(STOP_RECORDING_CHILD_SPANS_CONTEXT_KEY) as boolean;
      if (stopRecordingChildSpans) {
        logger.debug(
          `[SpanUtils] Stopping recording of child spans for span ${spanContext.spanId}, packageName: ${options.packageName}, instrumentationName: ${options.instrumentationName}`,
        );
        return originalFunctionCall();
      }
    }

    const {
      name,
      kind,
      packageName,
      instrumentationName,
      packageType,
      submodule,
      inputValue,
      outputValue,
      inputSchemaMerges,
      isPreAppStart,
      metadata,
      stopRecordingChildSpans,
    } = options;

    let spanInfo: SpanInfo | null = null;

    try {
      // Create span with standard attributes
      spanInfo = SpanUtils.createSpan({
        name,
        kind,
        isPreAppStart: options.isPreAppStart,
        attributes: {
          [TdSpanAttributes.NAME]: name,
          [TdSpanAttributes.PACKAGE_NAME]: packageName,
          [TdSpanAttributes.SUBMODULE_NAME]: submodule,
          [TdSpanAttributes.INSTRUMENTATION_NAME]: instrumentationName,
          [TdSpanAttributes.PACKAGE_TYPE]: packageType,
          [TdSpanAttributes.INPUT_VALUE]: createSpanInputValue(inputValue),
          ...(outputValue && {
            [TdSpanAttributes.OUTPUT_VALUE]: JSON.stringify(outputValue),
          }),
          [TdSpanAttributes.IS_PRE_APP_START]: isPreAppStart,
          ...(inputSchemaMerges && {
            [TdSpanAttributes.INPUT_SCHEMA_MERGES]: JSON.stringify(inputSchemaMerges),
          }),
          ...(metadata && {
            [TdSpanAttributes.METADATA]: JSON.stringify(metadata),
          }),
        },
      });
    } catch (error) {
      logger.error("SpanExecutor error creating span:", error);
      spanInfo = null;
    }

    if (!spanInfo) {
      if (mode === TuskDriftMode.REPLAY) {
        // Safe to throw error since we're in replay mode
        throw new Error("Error creating span in replay mode");
      } else {
        // Call the original function, don't want SDK errors to propagate to the user
        return originalFunctionCall();
      }
    }

    // Set the stopRecordingChildSpans context value if it is true
    if (stopRecordingChildSpans) {
      spanInfo.context = spanInfo.context.setValue(STOP_RECORDING_CHILD_SPANS_CONTEXT_KEY, true);
    }

    // Execute function within span context
    return SpanUtils.withSpan(spanInfo, () => fn(spanInfo));
  }

  /**
   * Gets the current active span info
   */
  static getCurrentSpanInfo(): SpanInfo | null {
    try {
      const activeSpan = trace.getActiveSpan();
      if (!activeSpan) {
        return null;
      }

      const spanContext = activeSpan.spanContext();
      return {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        span: activeSpan,
        context: context.active(),
        isPreAppStart: context.active().getValue(IS_PRE_APP_START_CONTEXT_KEY) as boolean,
      };
    } catch (error) {
      logger.error("SpanUtils error getting current span info:", error);
      return null;
    }
  }

  /**
   * Adds attributes to a span
   */
  static addSpanAttributes(span: Span, addSpanAttributesOptions: AddSpanAttributesOptions): void {
    try {
      const attributes: Attributes = {
        ...(addSpanAttributesOptions.name && {
          [TdSpanAttributes.NAME]: addSpanAttributesOptions.name,
        }),
        ...(addSpanAttributesOptions.packageName && {
          [TdSpanAttributes.PACKAGE_NAME]: addSpanAttributesOptions.packageName,
        }),
        ...(addSpanAttributesOptions.instrumentationName && {
          [TdSpanAttributes.INSTRUMENTATION_NAME]: addSpanAttributesOptions.instrumentationName,
        }),
        ...(addSpanAttributesOptions.packageType && {
          [TdSpanAttributes.PACKAGE_TYPE]: addSpanAttributesOptions.packageType,
        }),
        ...(addSpanAttributesOptions.submodule && {
          [TdSpanAttributes.SUBMODULE_NAME]: addSpanAttributesOptions.submodule,
        }),
        ...(addSpanAttributesOptions.isPreAppStart && {
          [TdSpanAttributes.IS_PRE_APP_START]: addSpanAttributesOptions.isPreAppStart,
        }),
        ...(addSpanAttributesOptions.inputValue && {
          [TdSpanAttributes.INPUT_VALUE]: createSpanInputValue(addSpanAttributesOptions.inputValue),
        }),
        ...(addSpanAttributesOptions.outputValue && {
          [TdSpanAttributes.OUTPUT_VALUE]: JSON.stringify(addSpanAttributesOptions.outputValue),
        }),
        ...(addSpanAttributesOptions.inputSchemaMerges && {
          [TdSpanAttributes.INPUT_SCHEMA_MERGES]: JSON.stringify(
            addSpanAttributesOptions.inputSchemaMerges,
          ),
        }),
        ...(addSpanAttributesOptions.outputSchemaMerges && {
          [TdSpanAttributes.OUTPUT_SCHEMA_MERGES]: JSON.stringify(
            addSpanAttributesOptions.outputSchemaMerges,
          ),
        }),
        ...(addSpanAttributesOptions.metadata && {
          [TdSpanAttributes.METADATA]: JSON.stringify(addSpanAttributesOptions.metadata),
        }),
        ...(addSpanAttributesOptions.transformMetadata && {
          [TdSpanAttributes.TRANSFORM_METADATA]: JSON.stringify(
            addSpanAttributesOptions.transformMetadata,
          ),
        }),
      };
      span.setAttributes(attributes);
    } catch (error) {
      logger.error("SpanUtils error adding span attributes:", error);
    }
  }

  static setStatus(span: Span, status: SpanStatus): void {
    try {
      span.setStatus(status);
    } catch (error) {
      logger.error("SpanUtils error setting span status:", error);
    }
  }

  /**
   * Sets span status and ends the span
   *
   * Spans are only exported once span.end() is called
   */
  static endSpan(span: Span, status?: { code: SpanStatusCode; message?: string }): void {
    try {
      if (status) {
        span.setStatus(status);
      }
      span.end();
    } catch (error) {
      logger.error("SpanUtils error ending span:", error);
    }
  }

  /**
   * Extracts trace ID from current context
   */
  static getCurrentTraceId(): string | null {
    try {
      const spanInfo = SpanUtils.getCurrentSpanInfo();
      return spanInfo?.traceId || null;
    } catch (error) {
      logger.error("SpanUtils error getting current trace id:", error);
      return null;
    }
  }

  static setCurrentReplayTraceId(replayTraceId: string): Context | null {
    try {
      return context.active().setValue(REPLAY_TRACE_ID_CONTEXT_KEY, replayTraceId);
    } catch (error) {
      logger.error("SpanUtils error setting current replay trace id:", error);
      return null;
    }
  }

  /**
   * Gets the current replay trace ID from the context
   */
  static getCurrentReplayTraceId(): string | null {
    try {
      const activeContext = context.active();
      return activeContext.getValue(REPLAY_TRACE_ID_CONTEXT_KEY) as string | null;
    } catch (error) {
      logger.error("SpanUtils error getting current replay trace id:", error);
      return null;
    }
  }

  /**
   * Extracts span ID from current context
   */
  static getCurrentSpanId(): string | null {
    try {
      const spanInfo = SpanUtils.getCurrentSpanInfo();
      return spanInfo?.spanId || null;
    } catch (error) {
      logger.error("SpanUtils error getting current span id:", error);
      return null;
    }
  }

  /**
   * Gets trace and span IDs as a combined string for logging
   */
  static getTraceInfo(): string {
    let traceId = null;
    let spanId = null;
    try {
      traceId = SpanUtils.getCurrentTraceId();
      spanId = SpanUtils.getCurrentSpanId();
    } catch (error) {
      logger.error("SpanUtils error getting trace info:", error);
      return "no-trace";
    }

    if (traceId && spanId) {
      return `trace=${traceId} span=${spanId}`;
    }

    return "no-trace";
  }
}
