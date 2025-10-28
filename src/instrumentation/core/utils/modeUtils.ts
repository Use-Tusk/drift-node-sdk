import { SpanKind } from "@opentelemetry/api";
import { SpanUtils } from "../../../core/tracing/SpanUtils";
import { TuskDriftCore } from "../../../core/TuskDrift";
import { logger } from "../../../core/utils/logger";

export type OriginalFunctionCall<T> = () => T;
export type RecordModeHandler<T> = ({ isPreAppStart }: { isPreAppStart: boolean }) => T;
export type ReplayModeHandler<T> = () => T;

/**
 * Utility function that abstracts the common record mode pattern of checking for current span context
 * and deciding whether to execute record mode logic or just call the original function.
 *
 * @param originalFunctionCall - Function that calls the original function when no span context exists
 * @param recordModeHandler - Function that handles the record mode logic when span context exists
 * @param spanKind - The kind of span being created
 * @returns The result from either originalFunctionCall or recordModeHandler
 */
export function handleRecordMode<T>({
  originalFunctionCall,
  recordModeHandler,
  spanKind,
}: {
  originalFunctionCall: OriginalFunctionCall<T>;
  recordModeHandler: RecordModeHandler<T>;
  spanKind: SpanKind;
}): T {
  let isAppReady = false;
  let currentSpanInfo = null;
  try {
    isAppReady = TuskDriftCore.getInstance().isAppReady();
    currentSpanInfo = SpanUtils.getCurrentSpanInfo();
  } catch (error) {
    logger.error(`ModeUtils error checking app readiness or getting current span info:`, error);
    return originalFunctionCall();
  }

  if (!isAppReady) {
    // If app is not ready, call recordModeHandler with beforeAppStart=true
    return recordModeHandler({ isPreAppStart: true });
  }

  if ((!currentSpanInfo && spanKind !== SpanKind.SERVER) || currentSpanInfo?.isPreAppStart) {
    // If there is no current span info meaning this request isn't attached to a span (not part of an inbound request) AND isn't a server request
    // OR the current span was created before the app started. No need to keep recording these requests
    return originalFunctionCall();
  } else {
    // App is ready and we have span context, call recordModeHandler with beforeAppStart=false
    return recordModeHandler({ isPreAppStart: false });
  }
}

/**
 * Utility function that abstracts the common replay mode pattern of checking if the app is ready
 *
 * If this is a background request (app is ready and no parent span), calls the backgroundRequestHandler.
 * Otherwise, calls the replayModeHandler.
 * @param replayModeHandler - Function that handles the replay mode logic when app is ready
 * @param noOpRequestHandler - Function to handle no-op requests, called for background requests
 * @returns The result from either noOpRequestHandler or replayModeHandler
 */
export function handleReplayMode<T>({
  replayModeHandler,
  noOpRequestHandler,
  isServerRequest,
}: {
  replayModeHandler: ReplayModeHandler<T>;
  noOpRequestHandler: () => T;
  isServerRequest: boolean;
}): T {
  const isAppReady = TuskDriftCore.getInstance().isAppReady();
  const currentSpanInfo = SpanUtils.getCurrentSpanInfo();

  // Background request: App is ready + not within a trace (no parent span) + not a server request
  if (isAppReady && !currentSpanInfo && !isServerRequest) {
    logger.debug(`[ModeUtils] Handling no-op request`);
    // This is a background request (app is ready and no parent span), call the backgroundRequestHandler
    return noOpRequestHandler();
  }

  return replayModeHandler();
}
