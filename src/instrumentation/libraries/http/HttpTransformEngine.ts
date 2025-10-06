import * as crypto from "crypto";
import jp from "jsonpath";
import { SpanKind } from "@opentelemetry/api";
import {
  HttpClientInputValue,
  HttpClientOutputValue,
  HttpServerInputValue,
  HttpServerOutputValue,
} from "./types";
import { OneOf } from "src/core/types";

export interface TransformConfigs {
  http: HttpTransform[];
}

export interface HttpTransform {
  matcher: HttpTransformMatcher;
  action: HttpTransformAction;
}

/** A matcher config. An element is matched iff *all* conditions specified
 * here are true. Only one target field is allowed, but any of the common
 * fields may be provided.
 * */
export type HttpTransformMatcher = {
  /** Request direction, relative to this service. */
  direction: "inbound" | "outbound";
  /** HTTP method: array of methods like ["GET", "POST"]. Empty array matches all methods. */
  method?: ("GET" | "POST" | "DELETE" | "PUT")[];
  /** URL path pattern: "/api/user/*" */
  pathPattern?: string;
  /** Host pattern. e.g. "api.example.com" */
  host?: string;
} & OneOf<HttpTransformTarget>;

export type HttpTransformTarget = {
  /** JSONPath expression: "$.user.password" */
  jsonPath: string;
  /** Query parameter name: "ssn" */
  queryParam: string;
  /** Header name: "Authorization" */
  headerName: string;
  /** Transform the entire URL path */
  urlPath: string;
  /** Transform the entire request/response body */
  fullBody: string;
};

export type HttpTransformAction =
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

export interface HttpSpanData {
  traceId: string;
  spanId: string;
  kind: SpanKind;
  protocol?: HttpClientInputValue["protocol"];
  inputValue?: HttpClientInputValue | HttpServerInputValue;
  outputValue?: HttpClientOutputValue | HttpServerOutputValue;
  transformMetadata?: {
    transformed: boolean;
    actions: TransformAction[];
  };
}

type CompiledTransform = (span: HttpSpanData) => TransformAction | undefined;

type TransformAction = {
  type: "redact" | "mask" | "replace" | "drop";
  field: string;
  reason: string;
  description?: string;
};

type ActionFunction = (value: string) => string;

type MatcherFunction = (span: HttpSpanData) => boolean;

export class HttpTransformEngine {
  private compiledTransforms: CompiledTransform[] = [];

  constructor(transformConfigs?: TransformConfigs) {
    if (transformConfigs?.http) {
      this.compiledTransforms = transformConfigs.http.map((transform) =>
        this.compileHttpTransform(transform),
      );
    }
  }

  shouldDropInboundRequest(
    method: string,
    url: string,
    headers?: Record<string, any>,
    body?: any,
  ): boolean {
    const testSpan: HttpSpanData = {
      traceId: "",
      spanId: "",
      kind: SpanKind.SERVER,
      protocol: "http",
      inputValue: {
        method,
        url,
        target: url,
        headers: headers || {},
        httpVersion: "1.1",
        body,
        bodySize: 0,
      } as HttpServerInputValue,
    };

    for (const compiledTransform of this.compiledTransforms) {
      const action = compiledTransform(testSpan);
      if (action && action.type === "drop") {
        return true;
      }
    }

    return false;
  }

  shouldDropOutboundRequest(inputValue: HttpClientInputValue): boolean {
    const clonedInputValue = JSON.parse(JSON.stringify(inputValue)) as HttpClientInputValue;

    const testSpan: HttpSpanData = {
      traceId: "",
      spanId: "",
      kind: SpanKind.CLIENT,
      protocol: inputValue.protocol || "http",
      inputValue: clonedInputValue,
    };

    for (const compiledTransform of this.compiledTransforms) {
      const action = compiledTransform(testSpan);
      if (action && action.type === "drop") {
        return true;
      }
    }

    return false;
  }

  applyTransforms(spanData: HttpSpanData): HttpSpanData {
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

  private compileHttpTransform(transform: HttpTransform): CompiledTransform {
    const { matcher, action } = transform;

    const matcherFunction = this.compileMatcher(matcher);
    if (action.type === "drop") {
      return (span) => {
        if (!matcherFunction(span)) {
          return;
        }

        // Drop all sensitive data
        if (span.inputValue) {
          span.inputValue = {} as any;
        }

        if (span.outputValue) {
          span.outputValue = {} as any;
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
    matcher: HttpTransformMatcher,
    action: HttpTransformAction,
  ): (span: HttpSpanData) => boolean {
    const actionFunction = this.compileActionFunction(action);

    if (matcher.jsonPath) {
      return this.compileJsonPathAction(matcher.jsonPath, actionFunction, matcher.direction);
    }
    if (matcher.queryParam) {
      return this.compileQueryParamAction(matcher.queryParam, actionFunction, matcher.direction);
    }
    if (matcher.headerName) {
      return this.compileHeaderAction(matcher.headerName, actionFunction, matcher.direction);
    }
    if (matcher.urlPath !== undefined) {
      return this.compileUrlPathAction(actionFunction, matcher.direction);
    }
    if (matcher.fullBody !== undefined) {
      return this.compileFullBodyAction(actionFunction, matcher.direction);
    }

    return () => false;
  }

  private compileMatcher(matcher: HttpTransformMatcher): MatcherFunction {
    const checks: MatcherFunction[] = [];

    if (matcher.direction === "outbound") {
      checks.push((span) => span.kind === SpanKind.CLIENT);
    } else if (matcher.direction === "inbound") {
      checks.push((span) => span.kind === SpanKind.SERVER);
    }

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
        if (matcher.direction === "outbound") {
          checks.push((span) => {
            const path = (span.inputValue as HttpClientInputValue)?.path;
            return path ? pattern.test(path) : false;
          });
        } else {
          checks.push((span) => {
            const path = (span.inputValue as HttpServerInputValue)?.url;
            return path ? pattern.test(path) : false;
          });
        }
      } catch (error) {
        throw new Error(
          `Invalid path pattern "${matcher.pathPattern}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (matcher.host) {
      try {
        const hostPattern = new RegExp(matcher.host);
        if (matcher.direction === "outbound") {
          checks.push((span) => {
            const hostname = (span.inputValue as HttpClientInputValue)?.hostname;
            return hostname ? hostPattern.test(hostname) : false;
          });
        } else {
          checks.push((span) => {
            const url = (span.inputValue as HttpServerInputValue)?.url;
            if (!url) {
              return false;
            }
            try {
              const hostname = new URL(url, "http://localhost").hostname;
              return hostPattern.test(hostname);
            } catch {
              return false;
            }
          });
        }
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
    direction: HttpTransformMatcher["direction"],
  ): (span: HttpSpanData) => boolean {
    const selector = direction === "inbound" ? "inputValue" : "outputValue";
    return (span) => {
      const target = span[selector];
      if (!target) {
        return false;
      }

      try {
        const body = (target as any).body;
        if (!body) {
          return false;
        }

        // Body is base64-encoded, decode and parse it
        let bodyObj;
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
          (target as any).body = reencoded;
        }

        return nodes.length > 0;
      } catch (error) {
        return false;
      }
    };
  }

  private compileHeaderAction(
    headerName: string,
    actionFunction: ActionFunction,
    direction: HttpTransformMatcher["direction"],
  ): (span: HttpSpanData) => boolean {
    const lowerHeader = headerName.toLowerCase();

    return (span) => {
      // For inbound: transform request headers (SERVER span inputValue)
      // For outbound: transform request headers (CLIENT span inputValue)
      // Note: We always transform the request headers, which is inputValue for both directions
      const target = span.inputValue as any;
      if (!target?.headers) {
        return false;
      }

      let applied = false;
      for (const key of Object.keys(target.headers)) {
        if (key.toLowerCase() === lowerHeader) {
          target.headers[key] = actionFunction(target.headers[key]);
          applied = true;
        }
      }
      return applied;
    };
  }

  private compileQueryParamAction(
    queryParam: string,
    actionFunction: ActionFunction,
    direction: HttpTransformMatcher["direction"],
  ): (span: HttpSpanData) => boolean {
    return (span) => {
      if (!span.inputValue) {
        return false;
      }

      return this.transformQueryParamInData(span.inputValue, queryParam, actionFunction, direction);
    };
  }

  private compileFullBodyAction(
    actionFunction: ActionFunction,
    direction: HttpTransformMatcher["direction"],
  ): (span: HttpSpanData) => boolean {
    const selector = direction === "inbound" ? "inputValue" : "outputValue";

    return (span) => {
      const target = span[selector] as any;
      if (!target || target.body === undefined) {
        return false;
      }

      if (direction === "outbound") {
        // Output bodies are base64-encoded strings - decode, transform, re-encode
        if (typeof target.body === "string") {
          try {
            const decoded = Buffer.from(target.body, "base64").toString("utf8");
            const transformed = actionFunction(decoded);
            target.body = Buffer.from(transformed).toString("base64");
          } catch (error) {
            // If not valid base64, treat as plain string
            target.body = Buffer.from(actionFunction(target.body)).toString("base64");
          }
        } else {
          target.body = Buffer.from(actionFunction(JSON.stringify(target.body))).toString("base64");
        }
      } else {
        // Input bodies can be objects or strings - keep as is
        target.body = actionFunction(
          typeof target.body === "string" ? target.body : JSON.stringify(target.body),
        );
      }
      return true;
    };
  }

  private compileUrlPathAction(
    actionFunction: ActionFunction,
    direction: HttpTransformMatcher["direction"],
  ): (span: HttpSpanData) => boolean {
    return (span) => {
      if (!span.inputValue) {
        return false;
      }
      return this.transformUrlPathInData(span.inputValue, actionFunction, direction);
    };
  }

  private transformQueryParamInData(
    data: any,
    queryParam: string,
    actionFunction: ActionFunction,
    direction: HttpTransformMatcher["direction"],
  ): boolean {
    if (!data || typeof data !== "object") {
      return false;
    }

    let applied = false;

    if (direction === "outbound") {
      if (data.path && typeof data.path === "string") {
        const url = new URL(data.path, "http://localhost");
        if (url.searchParams.has(queryParam)) {
          const oldValue = url.searchParams.get(queryParam);
          if (oldValue !== null) {
            const newValue = actionFunction(oldValue);
            url.searchParams.set(queryParam, newValue);
            data.path = url.pathname + url.search;
            applied = true;
          }
        }
      }
    } else {
      for (const field of ["url", "target"]) {
        if (data[field] && typeof data[field] === "string") {
          try {
            const url =
              field === "url" ? new URL(data[field]) : new URL(data[field], "http://localhost");
            if (url.searchParams.has(queryParam)) {
              const oldValue = url.searchParams.get(queryParam);
              if (oldValue !== null) {
                const newValue = actionFunction(oldValue);
                url.searchParams.set(queryParam, newValue);
                data[field] = field === "url" ? url.toString() : url.pathname + url.search;
                applied = true;
              }
            }
          } catch {
            // ignore
          }
        }
      }
    }

    return applied;
  }

  private transformUrlPathInData(
    data: any,
    actionFunction: ActionFunction,
    direction: HttpTransformMatcher["direction"],
  ): boolean {
    if (!data || typeof data !== "object") {
      return false;
    }

    let applied = false;

    if (direction === "outbound") {
      if (data.path && typeof data.path === "string") {
        data.path = actionFunction(data.path);
        applied = true;
      }
    } else {
      for (const field of ["url", "target"]) {
        if (data[field] && typeof data[field] === "string") {
          data[field] = actionFunction(data[field]);
          applied = true;
        }
      }
    }

    return applied;
  }

  private compileActionFunction(action: HttpTransformAction): ActionFunction {
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

  private getFieldDescription(matcher: HttpTransformMatcher): string {
    if (matcher.jsonPath) return `jsonPath:${matcher.jsonPath}`;
    if (matcher.queryParam) return `queryParam:${matcher.queryParam}`;
    if (matcher.headerName) return `header:${matcher.headerName}`;
    if (matcher.urlPath) return "urlPath";
    if (matcher.fullBody !== undefined) return "fullBody";
    return "unknown";
  }

  private describeTransform(transform: HttpTransform): string {
    return JSON.stringify(transform.matcher);
  }
}
