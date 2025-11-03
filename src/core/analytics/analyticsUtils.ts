import { TuskDriftCore, TuskDriftMode } from "../TuskDrift";
import { SDK_VERSION } from "../../version";
import { logger } from "../utils/logger";

/**
 * Send version mismatch alert to CLI (only in REPLAY mode)
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
  logger.info("[SSK] Sending version mismatch alert", {
    moduleName,
    foundVersion: foundVersion,
    supportedVersions,
  });
  try {
    // Only send in replay mode
    const mode = TuskDriftCore.getInstance().getMode();
    if (mode !== TuskDriftMode.REPLAY) {
      return;
    }

    const protobufComm = TuskDriftCore.getInstance().getProtobufCommunicator();
    if (protobufComm) {
      protobufComm.sendInstrumentationVersionMismatchAlert({
        moduleName,
        requestedVersion: foundVersion,
        supportedVersions,
      });
    }
  } catch (e) {
    logger.error("Error sending version mismatch alert:", e);
  }
}

/**
 * Send unpatched dependency alert to CLI
 */
export function sendUnpatchedDependencyAlert({
  traceTestServerSpanId,
  stackTrace,
}: {
  traceTestServerSpanId: string;
  stackTrace?: string;
}): void {
  logger.info("[SSK] Sending unpatched dependency alert", {
    traceTestServerSpanId,
    stackTrace,
  });
  try {
    const protobufComm = TuskDriftCore.getInstance().getProtobufCommunicator();
    if (protobufComm && stackTrace) {
      protobufComm.sendUnpatchedDependencyAlert({
        stackTrace,
        traceTestServerSpanId,
      });
    }
  } catch (e) {
    logger.error("Error sending unpatched dependency alert:", e);
  }
}
