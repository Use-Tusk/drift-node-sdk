import type {
  BuildSpanProtoBytesInput as RustBuildSpanProtoBytesInput,
} from "@use-tusk/drift-core-node";

type RustCoreNodeBinding = Pick<
  typeof import("@use-tusk/drift-core-node"),
  "processExportPayload" | "buildSpanProtoBytes" | "buildExportSpansRequestBytes"
>;

export type ProcessExportPayloadResult = {
  normalizedValue: unknown;
  decodedValueHash: string;
  decodedSchema: unknown;
  decodedSchemaHash: string;
};

export type BuildSpanProtoBytesInput = {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  packageName: string;
  instrumentationName: string;
  submoduleName: string;
  packageType: number;
  environment?: string;
  kind: number;
  inputSchema: unknown;
  outputSchema: unknown;
  inputSchemaHash: string;
  outputSchemaHash: string;
  inputValueHash: string;
  outputValueHash: string;
  statusCode: number;
  statusMessage: string;
  isPreAppStart: boolean;
  isRootSpan: boolean;
  timestampSeconds: number;
  timestampNanos: number;
  durationSeconds: number;
  durationNanos: number;
  metadata?: unknown;
  inputValue?: unknown;
  outputValue?: unknown;
  inputValueProtoStructBytes?: Buffer;
  outputValueProtoStructBytes?: Buffer;
};

let bindingLoadAttempted = false;
let binding: RustCoreNodeBinding | null = null;

function isRustCoreEnabled(): boolean {
  const raw = process.env.TUSK_USE_RUST_CORE;
  if (!raw) {
    return false;
  }
  return raw === "1" || raw.toLowerCase() === "true";
}

function loadBinding(): RustCoreNodeBinding | null {
  if (bindingLoadAttempted) {
    return binding;
  }
  bindingLoadAttempted = true;

  if (!isRustCoreEnabled()) {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    binding = require("@use-tusk/drift-core-node") as RustCoreNodeBinding;
  } catch {
    binding = null;
  }
  return binding;
}

function toRustSchemaMerges(schemaMerges?: Record<string, any>): Record<string, any> | undefined {
  if (!schemaMerges) {
    return undefined;
  }
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(schemaMerges)) {
    out[key] = {
      ...(value.encoding !== undefined ? { encoding: value.encoding } : {}),
      ...(value.decodedType !== undefined ? { decoded_type: value.decodedType } : {}),
      ...(value.matchImportance !== undefined ? { match_importance: value.matchImportance } : {}),
    };
  }
  return out;
}

function normalizeSchemaKeys(value: any): any {
  if (Array.isArray(value)) {
    return value.map(normalizeSchemaKeys);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "decoded_type") {
      out.decodedType = normalizeSchemaKeys(v);
    } else if (k === "match_importance") {
      out.matchImportance = normalizeSchemaKeys(v);
    } else {
      out[k] = normalizeSchemaKeys(v);
    }
  }
  return out;
}

function denormalizeSchemaKeys(value: any): any {
  if (Array.isArray(value)) {
    return value.map(denormalizeSchemaKeys);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "decodedType") {
      out.decoded_type = denormalizeSchemaKeys(v);
    } else if (k === "matchImportance") {
      out.match_importance = denormalizeSchemaKeys(v);
    } else {
      out[k] = denormalizeSchemaKeys(v);
    }
  }
  return out;
}

export function processExportPayloadJsonable(
  payload: unknown,
  schemaMerges?: Record<string, any>,
): ProcessExportPayloadResult | null {
  const loaded = loadBinding();
  if (!loaded) {
    return null;
  }

  try {
    const payloadJson = JSON.stringify(payload);
    const rustSchemaMerges = toRustSchemaMerges(schemaMerges);
    const schemaMergesJson = rustSchemaMerges ? JSON.stringify(rustSchemaMerges) : undefined;
    const result = loaded.processExportPayload(payloadJson, schemaMergesJson);

    return {
      normalizedValue: JSON.parse(result.normalizedJson),
      decodedValueHash: result.decodedValueHash,
      decodedSchema: normalizeSchemaKeys(JSON.parse(result.decodedSchemaJson)),
      decodedSchemaHash: result.decodedSchemaHash,
    };
  } catch {
    return null;
  }
}

export function buildSpanProtoBytes(input: BuildSpanProtoBytesInput): Buffer | null {
  const loaded = loadBinding();
  if (!loaded) {
    return null;
  }
  try {
    const rustInput: RustBuildSpanProtoBytesInput = {
      traceId: input.traceId,
      spanId: input.spanId,
      parentSpanId: input.parentSpanId,
      name: input.name,
      packageName: input.packageName,
      instrumentationName: input.instrumentationName,
      submoduleName: input.submoduleName,
      packageType: input.packageType,
      environment: input.environment,
      kind: input.kind,
      inputSchemaJson: JSON.stringify(denormalizeSchemaKeys(input.inputSchema)),
      outputSchemaJson: JSON.stringify(denormalizeSchemaKeys(input.outputSchema)),
      inputSchemaHash: input.inputSchemaHash,
      outputSchemaHash: input.outputSchemaHash,
      inputValueHash: input.inputValueHash,
      outputValueHash: input.outputValueHash,
      statusCode: input.statusCode,
      statusMessage: input.statusMessage,
      isPreAppStart: input.isPreAppStart,
      isRootSpan: input.isRootSpan,
      timestampSeconds: input.timestampSeconds,
      timestampNanos: input.timestampNanos,
      durationSeconds: input.durationSeconds,
      durationNanos: input.durationNanos,
      metadataJson: input.metadata === undefined ? undefined : JSON.stringify(input.metadata),
      inputValueJson: input.inputValue === undefined ? undefined : JSON.stringify(input.inputValue),
      outputValueJson: input.outputValue === undefined ? undefined : JSON.stringify(input.outputValue),
      inputValueProtoStructBytes: input.inputValueProtoStructBytes,
      outputValueProtoStructBytes: input.outputValueProtoStructBytes,
    };
    return loaded.buildSpanProtoBytes(rustInput);
  } catch {
    return null;
  }
}

export function buildExportSpansRequestBytes(
  observableServiceId: string,
  environment: string,
  sdkVersion: string,
  sdkInstanceId: string,
  spanProtoBytesList: Buffer[],
): Buffer | null {
  const loaded = loadBinding();
  if (!loaded) {
    return null;
  }
  try {
    return loaded.buildExportSpansRequestBytes(
      observableServiceId,
      environment,
      sdkVersion,
      sdkInstanceId,
      spanProtoBytesList,
    );
  } catch {
    return null;
  }
}
