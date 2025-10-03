import { TuskDriftCore } from "../TuskDrift";
import { SDK_VERSION } from "../../version";
import { logger } from "../utils/logger";

interface AnalyticsPayload {
  distinctId: string;
  event: string;
  properties: Record<string, any>;
}

export function sendAnalyticsPayload(payload: AnalyticsPayload): void {
  try {
    // Only send analytics in production and if explicitly enabled
    if (TuskDriftCore.getInstance().getConfig().recording?.enable_analytics) {
      // TODO: implement this
    }
  } catch (e) {
    logger.error("Error sending analytics event:", e);
  }
}

export function sendTdAnalytics(eventName: string, properties: Record<string, any> = {}): void {
  const serviceId = TuskDriftCore.getInstance().getConfig().service?.id || "unknown-service";

  const payload: AnalyticsPayload = {
    distinctId: `tusk-drift:${serviceId}`,
    event: `${eventName}`,
    properties: {
      serviceId,
      tdMode: TuskDriftCore.getInstance().getMode(),
      sdkVersion: SDK_VERSION,
      ...properties,
    },
  };

  sendAnalyticsPayload(payload);
}

/**
 * NOTE: analytics has not been implemented yet, so this function does nothing
 */
export function sendVersionMismatchAlert({
  moduleName,
  foundVersion,
  supportedVersions,
}: {
  moduleName: string;
  foundVersion: string | undefined;
  supportedVersions: string[];
}): void {
  try {
    sendTdAnalytics("version_mismatch", {
      moduleName,
      foundVersion: foundVersion || "unknown",
      supportedVersions: supportedVersions.join(", "),
    });
  } catch (e) {
    logger.error("Error sending version mismatch alert:", e);
  }
}

/**
 * NOTE: analytics has not been implemented yet, so this function does nothing
 */
export function sendUnpatchedDependencyAlert({
  method,
  spanId,
  traceId,
  stackTrace,
}: {
  method: string;
  spanId: string;
  traceId: string;
  stackTrace?: string;
}): void {
  try {
    sendTdAnalytics("unpatched_dependency", {
      method,
      spanId,
      traceId,
      stackTrace: stackTrace ? stackTrace.split("\n").slice(0, 10).join("\n") : undefined, // Limit stack trace size
    });
  } catch (e) {
    logger.error("Error sending unpatched dependency alert:", e);
  }
}
