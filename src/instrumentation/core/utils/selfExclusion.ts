/**
 * Paths to exclude from instrumentation to avoid recording SDK export traffic
 */

import { SpanExportService } from "@use-tusk/drift-schemas/backend/span_export_service";

export const TUSK_SKIP_HEADER = "x-td-skip-instrumentation";

export function isTuskDriftIngestionUrl(urlOrPath?: string | null): boolean {
  if (!urlOrPath) return false;

  // Use typeName to avoid hardcoding the endpoint path
  return urlOrPath.includes(SpanExportService.typeName);
}
