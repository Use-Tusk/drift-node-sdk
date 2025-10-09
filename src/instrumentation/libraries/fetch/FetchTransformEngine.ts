import * as crypto from "crypto";
import jp from "jsonpath";
import { SpanKind } from "@opentelemetry/api";
import { FetchInputValue, FetchOutputValue } from "./types";
import { OneOf } from "src/core/types";
import { TransformConfigs } from "../types";

export interface FetchTransform {
  matcher: FetchTransformMatcher;
  action: FetchTransformAction;
}

/** A matcher config. An element is matched iff *all* conditions specified
 * here are true. Only one target field is allowed, but any of the common
 * fields may be provided.
 * */
export type FetchTransformMatcher = {
  /** Request direction relative to this service. Fetch is always
   * outbound, but included for consistency. */
  direction?: "outbound";
  /** HTTP method: array of methods like ["GET", "POST"]. Empty array matches
   * all methods. */
  method?: ("GET" | "POST" | "DELETE" | "PUT")[];
  /** Regex to match against URL path e.g. "/api/user/.*" */
  pathPattern?: string;
  /** Regex to match against hostname e.g. "api.example.com" */
  host?: string;
} & OneOf<FetchTransformMatchingFields>;

/** Target fields. See doc for more info on why it's split and not part of the
 * matcher configs . */
export type FetchTransformMatchingFields = {
  /** JSONPath expression e.g. "$.user.password" */
  jsonPath: string;
  /** Query parameter name */
  queryParam: string;
  /** Header name */
  headerName: string;
  /** Transform the entire URL path */
  urlPath: boolean;
  /** Transform the entire request/response body */
  fullBody: boolean;
};

export type FetchTransformAction =
  | {
      type: "redact";
      /** Prefix for hash (default: "REDACTED_") */
      hashPrefix?: string;
    }
  | {
      type: "mask";
      /** Character to use for masking (default: "*") */
      maskChar?: string;
    }
  | {
      type: "replace";
      /** Static replacement value (required) */
      replaceWith: string;
    }
  | {
      type: "drop";
    };

export interface FetchSpanData {
  traceId: string;
  spanId: string;
  kind: SpanKind;
  inputValue?: FetchInputValue;
  outputValue?: FetchOutputValue;
  transformMetadata?: {
    transformed: boolean;
    actions: TransformAction[];
  };
}

type CompiledTransform = (span: FetchSpanData) => TransformAction | undefined;

type TransformAction = {
  type: "redact" | "mask" | "replace" | "drop";
  field: string;
  reason: string;
  description?: string;
};

type ActionFunction = (value: string) => string;

type MatcherFunction = (span: FetchSpanData) => boolean;

/**
 * Creates an empty FetchInputValue object for dropped spans
 */
function createEmptyInputValue(): FetchInputValue {
  return {
    url: "",
    method: "",
    headers: {},
  };
}

/**
 * Creates an empty FetchOutputValue object for dropped spans
 */
function createEmptyOutputValue(): FetchOutputValue {
  return {
    status: 0,
    statusText: "",
    headers: {},
    bodySize: 0,
  };
}

export class FetchTransformEngine {
  private compiledTransforms: CompiledTransform[] = [];

  constructor(transformConfigs?: TransformConfigs) {
    if (transformConfigs?.fetch) {
      this.compiledTransforms = transformConfigs.fetch.map((transform) =>
        this.compileTransform(transform),
      );
    }
  }

  applyTransforms(spanData: FetchSpanData): FetchSpanData {
    const actions: TransformAction[] = [];

    for (const compiledTransform of this.compiledTransforms) {
      const action = compiledTransform(spanData);
      if (action) {
        actions.push(action);
      }
    }

    if (actions.length > 0) {
      spanData.transformMetadata = {
        transformed: true,
        actions,
      };
    }

    return spanData;
  }

  private compileTransform(transform: FetchTransform): CompiledTransform {
    const { matcher, action } = transform;

    const matcherFunction = this.compileMatcher(matcher);
    if (action.type === "drop") {
      return (span) => {
        if (!matcherFunction(span)) {
          return;
        }

        // Drop all sensitive data
        if (span.inputValue) {
          span.inputValue = createEmptyInputValue();
        }

        if (span.outputValue) {
          span.outputValue = createEmptyOutputValue();
        }

        return {
          type: "drop",
          field: "entire_span",
          reason: "transforms",
          description: this.describeTransform(transform),
        };
      };
    }

    const compiledAction = this.compileAction(matcher, action);
    const fieldDescription = this.getFieldDescription(matcher);

    return (span) => {
      if (!matcherFunction(span)) {
        return;
      }

      const result = compiledAction(span);
      if (result) {
        return {
          type: action.type,
          field: fieldDescription,
          reason: "transforms",
        };
      }

      return;
    };
  }

  private compileAction(
    matcher: FetchTransformMatcher,
    action: FetchTransformAction,
  ): (span: FetchSpanData) => boolean {
    const actionFunction = this.compileActionFunction(action);

    if (matcher.jsonPath) {
      return this.compileJsonPathAction(matcher.jsonPath, actionFunction);
    }
    if (matcher.queryParam) {
      return this.compileQueryParamAction(matcher.queryParam, actionFunction);
    }
    if (matcher.headerName) {
      return this.compileHeaderAction(matcher.headerName, actionFunction);
    }
    if (matcher.urlPath) {
      return this.compileUrlPathAction(actionFunction);
    }
    if (matcher.fullBody) {
      return this.compileFullBodyAction(actionFunction);
    }

    return () => false;
  }

  private compileMatcher(matcher: FetchTransformMatcher): MatcherFunction {
    const checks: MatcherFunction[] = [];

    // Fetch is always CLIENT kind
    checks.push((span) => span.kind === SpanKind.CLIENT);

    if (matcher.method) {
      // Empty array means match all methods (wildcard)
      if (matcher.method.length === 0) {
        // No check needed - matches all methods
      } else {
        const methods = matcher.method.map((method) => method.toUpperCase());
        checks.push((span) => {
          const spanMethod = span.inputValue?.method?.toUpperCase();
          return spanMethod ? methods.includes(spanMethod) : false;
        });
      }
    }

    if (matcher.pathPattern) {
      try {
        const pattern = new RegExp(matcher.pathPattern);
        checks.push((span) => {
          const url = span.inputValue?.url;
          if (!url) return false;
          try {
            const urlObj = new URL(url);
            return pattern.test(urlObj.pathname);
          } catch {
            return false;
          }
        });
      } catch (error) {
        throw new Error(
          `Invalid path pattern "${matcher.pathPattern}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (matcher.host) {
      try {
        const hostPattern = new RegExp(matcher.host);
        checks.push((span) => {
          const url = span.inputValue?.url;
          if (!url) return false;
          try {
            const urlObj = new URL(url);
            return hostPattern.test(urlObj.hostname);
          } catch {
            return false;
          }
        });
      } catch (error) {
        throw new Error(
          `Invalid host pattern "${matcher.host}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (checks.length === 0) {
      return () => true;
    }
    if (checks.length === 1) {
      return checks[0];
    }

    return (span) => checks.every((check) => check(span));
  }

  private compileJsonPathAction(
    jsonPath: string,
    actionFunction: ActionFunction,
  ): (span: FetchSpanData) => boolean {
    return (span) => {
      let applied = false;

      // Apply to request body (inputValue)
      if (span.inputValue?.body) {
        try {
          let bodyObj;
          const body = span.inputValue.body;

          if (typeof body === "string") {
            try {
              const decoded = Buffer.from(body, "base64").toString("utf8");
              bodyObj = JSON.parse(decoded);
            } catch (e) {
              // If decoding/parsing fails, body might not be JSON
              return false;
            }
          } else {
            bodyObj = body;
          }

          const nodes = jp.apply(bodyObj, jsonPath, actionFunction);

          // Re-encode the modified body as base64
          if (typeof body === "string" && nodes.length > 0) {
            const reencoded = Buffer.from(JSON.stringify(bodyObj)).toString("base64");
            span.inputValue.body = reencoded;
            applied = true;
          }
        } catch (error) {
          // ignore
        }
      }

      // Apply to response body (outputValue)
      if (span.outputValue?.body) {
        try {
          let bodyObj;
          const body = span.outputValue.body;

          if (typeof body === "string") {
            try {
              const decoded = Buffer.from(body, "base64").toString("utf8");
              bodyObj = JSON.parse(decoded);
            } catch (e) {
              // If decoding/parsing fails, body might not be JSON
              return applied;
            }
          } else {
            bodyObj = body;
          }

          const nodes = jp.apply(bodyObj, jsonPath, actionFunction);

          // Re-encode the modified body as base64
          if (typeof body === "string" && nodes.length > 0) {
            const reencoded = Buffer.from(JSON.stringify(bodyObj)).toString("base64");
            span.outputValue.body = reencoded;
            applied = true;
          }
        } catch (error) {
          // ignore
        }
      }

      return applied;
    };
  }

  private compileHeaderAction(
    headerName: string,
    actionFunction: ActionFunction,
  ): (span: FetchSpanData) => boolean {
    const lowerHeader = headerName.toLowerCase();

    return (span) => {
      let applied = false;

      // Transform request headers
      if (span.inputValue?.headers) {
        for (const key of Object.keys(span.inputValue.headers)) {
          if (key.toLowerCase() === lowerHeader) {
            span.inputValue.headers[key] = actionFunction(span.inputValue.headers[key]);
            applied = true;
          }
        }
      }

      // Transform response headers
      if (span.outputValue?.headers) {
        for (const key of Object.keys(span.outputValue.headers)) {
          if (key.toLowerCase() === lowerHeader) {
            span.outputValue.headers[key] = actionFunction(span.outputValue.headers[key]);
            applied = true;
          }
        }
      }

      return applied;
    };
  }

  private compileQueryParamAction(
    queryParam: string,
    actionFunction: ActionFunction,
  ): (span: FetchSpanData) => boolean {
    return (span) => {
      if (!span.inputValue?.url) {
        return false;
      }

      try {
        const url = new URL(span.inputValue.url);
        if (url.searchParams.has(queryParam)) {
          const oldValue = url.searchParams.get(queryParam);
          if (oldValue !== null) {
            const newValue = actionFunction(oldValue);
            url.searchParams.set(queryParam, newValue);
            span.inputValue.url = url.toString();
            return true;
          }
        }
      } catch {
        // ignore invalid URLs
      }

      return false;
    };
  }

  private compileFullBodyAction(actionFunction: ActionFunction): (span: FetchSpanData) => boolean {
    return (span) => {
      let applied = false;

      // Transform request body
      if (span.inputValue && span.inputValue.body !== undefined) {
        const body = span.inputValue.body;
        if (typeof body === "string") {
          try {
            const decoded = Buffer.from(body, "base64").toString("utf8");
            const transformed = actionFunction(decoded);
            span.inputValue.body = Buffer.from(transformed).toString("base64");
            applied = true;
          } catch (error) {
            // If not valid base64, treat as plain string
            span.inputValue.body = Buffer.from(actionFunction(body)).toString("base64");
            applied = true;
          }
        } else {
          span.inputValue.body = Buffer.from(actionFunction(JSON.stringify(body))).toString(
            "base64",
          );
          applied = true;
        }
      }

      // Transform response body
      if (span.outputValue && span.outputValue.body !== undefined) {
        const body = span.outputValue.body;
        if (typeof body === "string") {
          try {
            const decoded = Buffer.from(body, "base64").toString("utf8");
            const transformed = actionFunction(decoded);
            span.outputValue.body = Buffer.from(transformed).toString("base64");
            applied = true;
          } catch (error) {
            // If not valid base64, treat as plain string
            span.outputValue.body = Buffer.from(actionFunction(body)).toString("base64");
            applied = true;
          }
        } else {
          span.outputValue.body = Buffer.from(actionFunction(JSON.stringify(body))).toString(
            "base64",
          );
          applied = true;
        }
      }

      return applied;
    };
  }

  private compileUrlPathAction(actionFunction: ActionFunction): (span: FetchSpanData) => boolean {
    return (span) => {
      if (span.inputValue?.url) {
        try {
          const urlObj = new URL(span.inputValue.url);
          urlObj.pathname = actionFunction(urlObj.pathname);
          span.inputValue.url = urlObj.toString();
          return true;
        } catch {
          // If URL parsing fails, transform the whole URL string
          span.inputValue.url = actionFunction(span.inputValue.url);
          return true;
        }
      }
      return false;
    };
  }

  private compileActionFunction(action: FetchTransformAction): ActionFunction {
    switch (action.type) {
      case "redact":
        return (value) => {
          const prefix = action.hashPrefix || "REDACTED_";
          const hash = crypto.createHash("sha256").update(String(value)).digest("hex");
          return `${prefix}${hash.substring(0, 12)}...`;
        };
      case "mask":
        return (value) => {
          const maskChar = action.maskChar || "*";
          return maskChar.repeat(value.length);
        };
      case "replace":
        return () => action.replaceWith;
      default:
        return (value) => value;
    }
  }

  private getFieldDescription(matcher: FetchTransformMatcher): string {
    if (matcher.jsonPath) return `jsonPath:${matcher.jsonPath}`;
    if (matcher.queryParam) return `queryParam:${matcher.queryParam}`;
    if (matcher.headerName) return `header:${matcher.headerName}`;
    if (matcher.urlPath) return "urlPath";
    if (matcher.fullBody) return "fullBody";
    return "unknown";
  }

  private describeTransform(transform: FetchTransform): string {
    return JSON.stringify(transform.matcher);
  }
}
