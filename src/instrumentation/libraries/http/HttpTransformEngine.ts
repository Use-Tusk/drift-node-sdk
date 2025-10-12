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
import { TransformConfigs } from "../types";

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
  /** HTTP method: array of methods like ["GET", "POST"]. Empty array matches
   * all methods. */
  method?: ("GET" | "POST" | "DELETE" | "PUT")[];
  /** URL path pattern: "/api/user/*" */
  pathPattern?: string;
  /** Host pattern. e.g. "api.example.com" */
  host?: string;
} & OneOf<HttpTransformMatchingFields>;

/** Target fields. See doc for more info on why it's split and not part of the
 * matcher configs . */
export type HttpTransformMatchingFields = {
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

/**
 * Creates an empty HttpClientInputValue object for dropped spans
 */
function createEmptyClientInputValue(
  protocol?: HttpClientInputValue["protocol"],
): HttpClientInputValue {
  return {
    protocol: protocol || "http",
    method: "",
    headers: {},
  };
}

/**
 * Creates an empty HttpServerInputValue object for dropped spans
 */
function createEmptyServerInputValue(): HttpServerInputValue {
  return {
    method: "",
    url: "",
    target: "",
    headers: {},
    body: "",
    bodySize: 0,
    httpVersion: "",
  };
}

/**
 * Creates an empty HttpClientOutputValue object for dropped spans
 */
function createEmptyClientOutputValue(): HttpClientOutputValue {
  return {
    httpVersion: "1.0",
    httpVersionMajor: 1,
    httpVersionMinor: 0,
    complete: true,
    readable: true,
    headers: {},
  };
}

/**
 * Creates an empty HttpServerOutputValue object for dropped spans
 */
function createEmptyServerOutputValue(): HttpServerOutputValue {
  return {
    headers: {},
  };
}

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
    headers?: Record<string, string | string[] | undefined>,
    body?: string,
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

        // Drop all sensitive data by replacing with empty objects
        if (span.inputValue) {
          span.inputValue =
            span.kind === SpanKind.CLIENT
              ? createEmptyClientInputValue(span.protocol)
              : createEmptyServerInputValue();
        }

        if (span.outputValue) {
          span.outputValue =
            span.kind === SpanKind.CLIENT
              ? createEmptyClientOutputValue()
              : createEmptyServerOutputValue();
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
    if (matcher.urlPath) {
      return this.compileUrlPathAction(actionFunction, matcher.direction);
    }
    if (matcher.fullBody) {
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
        // Access body based on direction
        const body = direction === "inbound"
          ? (target as HttpServerInputValue).body
          : (target as HttpClientOutputValue | HttpServerOutputValue).body;

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
          if (direction === "inbound") {
            (target as HttpServerInputValue).body = reencoded;
          } else {
            (target as HttpClientOutputValue | HttpServerOutputValue).body = reencoded;
          }
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
    _: HttpTransformMatcher["direction"],
  ): (span: HttpSpanData) => boolean {
    const lowerHeader = headerName.toLowerCase();

    return (span) => {
      // For inbound: transform request headers (SERVER span inputValue)
      // For outbound: transform request headers (CLIENT span inputValue)
      // Note: We always transform the request headers, which is inputValue for both directions
      const target = span.inputValue;
      if (!target?.headers) {
        return false;
      }

      let applied = false;
      for (const key of Object.keys(target.headers)) {
        if (key.toLowerCase() === lowerHeader) {
          const headerValue = target.headers[key];
          if (typeof headerValue === "string") {
            (target.headers as Record<string, string>)[key] = actionFunction(headerValue);
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
      const target = span[selector];
      if (!target || !("body" in target) || target.body === undefined) {
        return false;
      }

      if (direction === "outbound") {
        // Output bodies are base64-encoded strings - decode, transform, re-encode
        const outputTarget = target as HttpClientOutputValue | HttpServerOutputValue;
        if (typeof outputTarget.body === "string") {
          try {
            const decoded = Buffer.from(outputTarget.body, "base64").toString("utf8");
            const transformed = actionFunction(decoded);
            outputTarget.body = Buffer.from(transformed).toString("base64");
          } catch (error) {
            // If not valid base64, treat as plain string
            outputTarget.body = Buffer.from(actionFunction(outputTarget.body)).toString("base64");
          }
        }
      } else {
        // Input bodies can be either objects or base64-encoded strings
        const inputTarget = target as HttpServerInputValue;
        if (typeof inputTarget.body === "string") {
          try {
            const decoded = Buffer.from(inputTarget.body, "base64").toString("utf8");
            const transformed = actionFunction(decoded);
            inputTarget.body = Buffer.from(transformed).toString("base64");
          } catch (error) {
            // If not valid base64, treat as plain string
            inputTarget.body = Buffer.from(actionFunction(inputTarget.body)).toString("base64");
          }
        } else if (typeof inputTarget.body === "object") {
          // Body is a plain object - transform it directly
          const bodyStr = JSON.stringify(inputTarget.body);
          const transformed = actionFunction(bodyStr);
          // Replace with transformed value (could be string or parsed back)
          try {
            inputTarget.body = JSON.parse(transformed);
          } catch {
            // If transformed value is not JSON, store as-is
            inputTarget.body = transformed as any;
          }
        }
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
    data: HttpClientInputValue | HttpServerInputValue,
    queryParam: string,
    actionFunction: ActionFunction,
    direction: HttpTransformMatcher["direction"],
  ): boolean {
    if (!data) {
      return false;
    }

    let applied = false;

    if (direction === "outbound") {
      const clientData = data as HttpClientInputValue;
      if (clientData.path && typeof clientData.path === "string") {
        const url = new URL(clientData.path, "http://localhost");
        if (url.searchParams.has(queryParam)) {
          const oldValue = url.searchParams.get(queryParam);
          if (oldValue !== null) {
            const newValue = actionFunction(oldValue);
            url.searchParams.set(queryParam, newValue);
            clientData.path = url.pathname + url.search;
            applied = true;
          }
        }
      }
    } else {
      const serverData = data as HttpServerInputValue;
      // Transform url field
      if (serverData.url && typeof serverData.url === "string") {
        try {
          const url = new URL(serverData.url);
          if (url.searchParams.has(queryParam)) {
            const oldValue = url.searchParams.get(queryParam);
            if (oldValue !== null) {
              const newValue = actionFunction(oldValue);
              url.searchParams.set(queryParam, newValue);
              serverData.url = url.toString();
              applied = true;
            }
          }
        } catch {
          // ignore
        }
      }
      // Transform target field
      if (serverData.target && typeof serverData.target === "string") {
        try {
          const url = new URL(serverData.target, "http://localhost");
          if (url.searchParams.has(queryParam)) {
            const oldValue = url.searchParams.get(queryParam);
            if (oldValue !== null) {
              const newValue = actionFunction(oldValue);
              url.searchParams.set(queryParam, newValue);
              serverData.target = url.pathname + url.search;
              applied = true;
            }
          }
        } catch {
          // ignore
        }
      }
    }

    return applied;
  }

  private transformUrlPathInData(
    data: HttpClientInputValue | HttpServerInputValue,
    actionFunction: ActionFunction,
    direction: HttpTransformMatcher["direction"],
  ): boolean {
    if (!data) {
      return false;
    }

    let applied = false;

    if (direction === "outbound") {
      const clientData = data as HttpClientInputValue;
      if (clientData.path && typeof clientData.path === "string") {
        clientData.path = actionFunction(clientData.path);
        applied = true;
      }
    } else {
      const serverData = data as HttpServerInputValue;
      if (serverData.url && typeof serverData.url === "string") {
        serverData.url = actionFunction(serverData.url);
        applied = true;
      }
      if (serverData.target && typeof serverData.target === "string") {
        serverData.target = actionFunction(serverData.target);
        applied = true;
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
    if (matcher.fullBody) return "fullBody";
    return "unknown";
  }

  private describeTransform(transform: HttpTransform): string {
    return JSON.stringify(transform.matcher);
  }
}
