import test from "ava";
import { SpanKind } from "@opentelemetry/api";
import { HttpTransformEngine, TransformConfigs, HttpSpanData } from "./HttpTransformEngine";
import {
  HttpClientInputValue,
  HttpServerInputValue,
  HttpClientOutputValue,
  HttpServerOutputValue,
} from "./types";

const redactMaskReplaceConfig: TransformConfigs = {
  http: [
    {
      matcher: {
        direction: "inbound",
        method: ["POST"],
        pathPattern: "/api/auth/login",
        jsonPath: "$.password",
      },
      action: {
        type: "redact",
        hashPrefix: "PWD_",
      },
    },
    {
      matcher: {
        direction: "inbound",
        method: ["GET"],
        pathPattern: "/api/user/lookup",
        queryParam: "ssn",
      },
      action: {
        type: "mask",
        maskChar: "X",
      },
    },
    {
      matcher: {
        direction: "outbound",
        method: ["GET"],
        headerName: "Authorization",
      },
      action: {
        type: "replace",
        replaceWith: "Bearer test-token-12345",
      },
    },
  ],
};

const dropConfig: TransformConfigs = {
  http: [
    {
      matcher: {
        direction: "outbound",
        method: ["POST"],
        host: "api.stripe.com",
        fullBody: true,
      },
      action: {
        type: "drop",
      },
    },
  ],
};

const exampleServerSpanData: HttpSpanData = {
  traceId: "abc123",
  spanId: "login_456",
  kind: SpanKind.SERVER,
  protocol: "http",
  inputValue: {
    method: "POST",
    url: "http://localhost:3000/api/auth/login",
    target: "/api/auth/login",
    headers: {
      "content-type": "application/json",
      "user-agent": "test-client",
    },
    httpVersion: "1.1",
    body: {
      username: "john@example.com",
      password: "secretPassword123",
    },
    bodySize: 100,
  } as HttpServerInputValue,
  outputValue: {
    statusCode: 200,
    headers: {
      "content-type": "application/json",
    },
    body: Buffer.from(JSON.stringify({
      success: true,
      token: "jwt-token-here",
    })).toString("base64"),
    bodySize: 50,
  } as HttpServerOutputValue,
};

const stripeClientSpanData: HttpSpanData = {
  traceId: "abc123",
  spanId: "stripe_789",
  kind: SpanKind.CLIENT,
  protocol: "https",
  inputValue: {
    method: "POST",
    hostname: "api.stripe.com",
    path: "/v1/charges",
    headers: {
      Authorization: "Bearer sk_live_sensitive_key",
      "content-type": "application/json",
    },
    protocol: "https",
    body: {
      amount: 1000,
      currency: "usd",
      source: {
        card: {
          number: "4111111111111111",
          exp_month: 12,
          exp_year: 2025,
          cvc: "123",
        },
      },
    },
    bodySize: 200,
  } as HttpClientInputValue,
  outputValue: {
    statusCode: 200,
    headers: {
      "content-type": "application/json",
    },
    body: Buffer.from(JSON.stringify({
      id: "ch_123456",
      amount: 1000,
      currency: "usd",
    })).toString("base64"),
    bodySize: 80,
  } as HttpClientOutputValue,
};

const multiTransformServerSpan: HttpSpanData = {
  traceId: "abc123",
  spanId: "multi_999",
  kind: SpanKind.SERVER,
  protocol: "http",
  inputValue: {
    method: "GET",
    url: "http://localhost:3000/api/user/lookup?ssn=123-45-6789&email=user@example.com",
    target: "/api/user/lookup?ssn=123-45-6789&email=user@example.com",
    headers: {
      Authorization: "Bearer real-token-xyz",
      "X-API-Key": "secret-api-key",
    },
    httpVersion: "1.1",
    body: {
      user: {
        password: "userPassword",
        email: "user@example.com",
      },
    },
    bodySize: 150,
  } as HttpServerInputValue,
};

const multiConfig: TransformConfigs = {
  http: [
    {
      matcher: {
        direction: "inbound",
        method: ["GET"],
        queryParam: "ssn",
      },
      action: {
        type: "mask",
        maskChar: "X",
      },
    },
    {
      matcher: {
        direction: "inbound",
        method: ["GET"],
        jsonPath: "$.user.password",
      },
      action: {
        type: "replace",
        replaceWith: "HIDDEN",
      },
    },
  ],
};

const cloneSpan = (span: HttpSpanData): HttpSpanData =>
  JSON.parse(JSON.stringify(span)) as HttpSpanData;

test("redacts sensitive fields on inbound login spans", (t) => {
  const engine = new HttpTransformEngine(redactMaskReplaceConfig);
  const transformed = engine.applyTransforms(cloneSpan(exampleServerSpanData));

  t.truthy(transformed);
  const span = transformed as HttpSpanData;

  t.regex((span.inputValue as HttpServerInputValue).body.password, /^PWD_[0-9a-f]{12}\.\.\.$/);
  t.is(span.transformMetadata?.actions.length, 1);
  t.is(span.transformMetadata?.actions[0].type, "redact");
  t.is(span.transformMetadata?.actions[0].field, "jsonPath:$.password");
  t.is(span.transformMetadata?.actions[0].reason, "transforms");
});

test("drops outbound spans that match the Stripe policy", (t) => {
  const engine = new HttpTransformEngine(dropConfig);
  const transformed = engine.applyTransforms(cloneSpan(stripeClientSpanData));

  t.truthy(transformed);
  const span = transformed as HttpSpanData;

  t.deepEqual(span.inputValue, {});
  t.deepEqual(span.outputValue, {});
  t.is(span.transformMetadata?.actions.length, 1);
  t.is(span.transformMetadata?.actions[0].type, "drop");
  t.is(span.transformMetadata?.actions[0].field, "entire_span");
});

test("applies multiple transforms to a single span", (t) => {
  const engine = new HttpTransformEngine(multiConfig);
  const transformed = engine.applyTransforms(cloneSpan(multiTransformServerSpan));

  t.truthy(transformed);
  const span = transformed as HttpSpanData;

  const inputValue = span.inputValue as HttpServerInputValue;
  t.is(inputValue.url, "http://localhost:3000/api/user/lookup?ssn=XXXXXXXXXXX&email=user%40example.com");
  t.is(inputValue.target, "/api/user/lookup?ssn=XXXXXXXXXXX&email=user%40example.com");
  t.is(inputValue.body.user.password, "HIDDEN");
  t.is(span.transformMetadata?.actions.length, 2);
  const actionTypes = span.transformMetadata!.actions.map((a) => ({ type: a.type, field: a.field }));
  t.true(actionTypes.some((a) => a.type === "mask" && a.field === "queryParam:ssn"));
  t.true(actionTypes.some((a) => a.type === "replace" && a.field === "jsonPath:$.user.password"));
});

test("identifies inbound requests that should be dropped", (t) => {
  const inboundDropConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          method: ["POST"],
          pathPattern: "/api/auth/login",
          fullBody: true,
        },
        action: { type: "drop" },
      },
    ],
  };

  const engine = new HttpTransformEngine(inboundDropConfig);

  t.true(
    engine.shouldDropInboundRequest("POST", "http://localhost:3000/api/auth/login", "localhost", {
      "content-type": "application/json",
    }),
  );

  t.false(
    engine.shouldDropInboundRequest(
      "POST",
      "http://localhost:3000/api/other/endpoint",
      "localhost",
      { "content-type": "application/json" },
    ),
  );

  t.false(
    engine.shouldDropInboundRequest("GET", "http://localhost:3000/api/auth/login", "localhost", {
      "content-type": "application/json",
    }),
  );
});

// direction-specific field handling
test("correctly matches outbound spans using hostname field", (t) => {
  const outboundHostConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "outbound",
          host: "api\\.stripe\\.com",
          fullBody: true,
        },
        action: { type: "replace", replaceWith: "[REDACTED]" },
      },
    ],
  };

  const engine = new HttpTransformEngine(outboundHostConfig);
  const result = engine.applyTransforms(cloneSpan(stripeClientSpanData));

  t.is((result.outputValue as HttpClientOutputValue).body, Buffer.from("[REDACTED]").toString("base64"));
});

test("correctly matches inbound spans by extracting hostname from URL", (t) => {
  const inboundHostConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          host: "localhost",
          fullBody: true,
        },
        action: { type: "replace", replaceWith: "[REDACTED]" },
      },
    ],
  };

  const engine = new HttpTransformEngine(inboundHostConfig);
  const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));

  t.is((result.inputValue as HttpServerInputValue).body, "[REDACTED]");
});

test("correctly matches outbound spans using path field", (t) => {
  const outboundPathConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "outbound",
          pathPattern: "/v1/charges",
          fullBody: true,
        },
        action: { type: "replace", replaceWith: "[REDACTED]" },
      },
    ],
  };

  const engine = new HttpTransformEngine(outboundPathConfig);
  const result = engine.applyTransforms(cloneSpan(stripeClientSpanData));

  t.is((result.outputValue as HttpClientOutputValue).body, Buffer.from("[REDACTED]").toString("base64"));
});

test("correctly matches inbound spans using url field", (t) => {
  const inboundPathConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          pathPattern: "/api/auth/login",
          fullBody: true,
        },
        action: { type: "replace", replaceWith: "[REDACTED]" },
      },
    ],
  };

  const engine = new HttpTransformEngine(inboundPathConfig);
  const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));

  t.is((result.inputValue as HttpServerInputValue).body, "[REDACTED]");
});

// edge cases and error handling
test("handles spans with missing input/output values", (t) => {
  const engine = new HttpTransformEngine(redactMaskReplaceConfig);
  const spanWithMissingInput = {
    ...cloneSpan(exampleServerSpanData),
    inputValue: undefined,
  };

  const result = engine.applyTransforms(spanWithMissingInput as any);
  t.is(result.transformMetadata, undefined);
});

test("handles invalid JSONPath expressions gracefully", (t) => {
  const invalidJsonPathConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          jsonPath: "$.invalid[[[path",
        },
        action: { type: "redact" },
      },
    ],
  };

  const engine = new HttpTransformEngine(invalidJsonPathConfig);
  const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));
  t.is(result.transformMetadata, undefined);
});

test("handles spans with missing body", (t) => {
  const engine = new HttpTransformEngine(redactMaskReplaceConfig);
  const spanWithoutBody = cloneSpan(exampleServerSpanData);
  spanWithoutBody.inputValue = {
    ...(spanWithoutBody.inputValue as HttpServerInputValue),
    body: undefined,
  };

  const result = engine.applyTransforms(spanWithoutBody as any);
  t.is(result.transformMetadata, undefined);
});

test("handles spans with null/undefined headers", (t) => {
  const headerConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          headerName: "Authorization",
        },
        action: { type: "redact" },
      },
    ],
  };

  const engine = new HttpTransformEngine(headerConfig);
  const spanWithoutHeaders = cloneSpan(exampleServerSpanData);
  spanWithoutHeaders.inputValue = {
    ...(spanWithoutHeaders.inputValue as HttpServerInputValue),
    headers: undefined,
  };

  const result = engine.applyTransforms(spanWithoutHeaders as any);
  t.is(result.transformMetadata, undefined);
});

// transform action types
test("applies mask transform with custom mask character", (t) => {
  const maskConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          jsonPath: "$.password",
        },
        action: { type: "mask", maskChar: "#" },
      },
    ],
  };

  const engine = new HttpTransformEngine(maskConfig);
  const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));

  t.is((result.inputValue as HttpServerInputValue).body.password, "#################");
});

test("applies redact transform with custom hash prefix", (t) => {
  const redactConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          jsonPath: "$.password",
        },
        action: { type: "redact", hashPrefix: "HIDDEN_" },
      },
    ],
  };

  const engine = new HttpTransformEngine(redactConfig);
  const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));

  t.regex((result.inputValue as HttpServerInputValue).body.password, /^HIDDEN_[0-9a-f]{12}\.\.\.$/);
});

test("applies replace transform", (t) => {
  const replaceConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          jsonPath: "$.username",
        },
        action: {
          type: "replace",
          replaceWith: "anonymous@example.com",
        },
      },
    ],
  };

  const engine = new HttpTransformEngine(replaceConfig);
  const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));

  t.is((result.inputValue as HttpServerInputValue).body.username, "anonymous@example.com");
});

// matcher combinations
test("matches spans by method only", (t) => {
  const methodOnlyConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          method: ["POST"],
          jsonPath: "$.password",
        },
        action: { type: "redact" },
      },
    ],
  };

  const engine = new HttpTransformEngine(methodOnlyConfig);
  const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));

  t.regex((result.inputValue as HttpServerInputValue).body.password, /^REDACTED_[0-9a-f]{12}\.\.\.$/);
});

test("matches multiple methods when array is provided", (t) => {
  const multiMethodConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          method: ["POST", "PUT"],
          jsonPath: "$.username",
        },
        action: { type: "replace", replaceWith: "ARRAY_MATCHED" },
      },
    ],
  };

  const engine = new HttpTransformEngine(multiMethodConfig);

  const postResult = engine.applyTransforms(cloneSpan(exampleServerSpanData));
  t.is((postResult.inputValue as HttpServerInputValue).body.username, "ARRAY_MATCHED");

  const putSpan = cloneSpan(exampleServerSpanData);
  putSpan.inputValue = {
    ...(putSpan.inputValue as HttpServerInputValue),
    method: "PUT",
  };
  const putResult = engine.applyTransforms(putSpan);
  t.is((putResult.inputValue as HttpServerInputValue).body.username, "ARRAY_MATCHED");

  const getSpan = cloneSpan(exampleServerSpanData);
  getSpan.inputValue = {
    ...(getSpan.inputValue as HttpServerInputValue),
    method: "GET",
  };
  const getResult = engine.applyTransforms(getSpan);
  t.is((getResult.inputValue as HttpServerInputValue).body.username, "john@example.com");
  t.is(getResult.transformMetadata, undefined);
});

test("does not match when method doesn't match", (t) => {
  const mismatchConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          method: ["GET"],
          jsonPath: "$.password",
        },
        action: { type: "redact" },
      },
    ],
  };

  const engine = new HttpTransformEngine(mismatchConfig);
  const mismatchSpan = cloneSpan(exampleServerSpanData);
  const result = engine.applyTransforms(mismatchSpan);

  t.is((result.inputValue as HttpServerInputValue).body.password, "secretPassword123");
  t.is(result.transformMetadata, undefined);
});

test("does not match when direction doesn't match", (t) => {
  const directionMismatchConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "outbound",
          method: ["POST"],
          jsonPath: "$.password",
        },
        action: { type: "redact" },
      },
    ],
  };

  const engine = new HttpTransformEngine(directionMismatchConfig);
  const outboundMismatchSpan = cloneSpan(exampleServerSpanData);
  const result = engine.applyTransforms(outboundMismatchSpan);

  t.is((result.inputValue as HttpServerInputValue).body.password, "secretPassword123");
  t.is(result.transformMetadata, undefined);
});

// URL path transforms
test("transforms URL path in inbound server request", (t) => {
  const urlPathConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          urlPath: true,
        },
        action: {
          type: "replace",
          replaceWith: "/api/redacted",
        },
      },
    ],
  };

  const engine = new HttpTransformEngine(urlPathConfig);
  const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));

  const inputValue = result.inputValue as HttpServerInputValue;
  t.is(inputValue.url, "/api/redacted");
  t.is(inputValue.target, "/api/redacted");
});

test("transforms URL path in outbound client request", (t) => {
  const urlPathConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "outbound",
          urlPath: true,
        },
        action: {
          type: "replace",
          replaceWith: "/api/redacted",
        },
      },
    ],
  };

  const engine = new HttpTransformEngine(urlPathConfig);
  const result = engine.applyTransforms(cloneSpan(stripeClientSpanData));

  const inputValue = result.inputValue as HttpClientInputValue;
  t.is(inputValue.path, "/api/redacted");
});

// query parameter transforms
test("transforms query parameter in server URL with existing params", (t) => {
  const queryConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          queryParam: "token",
        },
        action: { type: "redact" },
      },
    ],
  };

  const spanWithQuery = cloneSpan(exampleServerSpanData);
  spanWithQuery.inputValue = {
    ...(spanWithQuery.inputValue as HttpServerInputValue),
    url: "http://localhost:3000/api/test?token=secret123&other=value",
    target: "/api/test?token=secret123&other=value",
  };

  const engine = new HttpTransformEngine(queryConfig);
  const result = engine.applyTransforms(spanWithQuery);

  const inputValue = result.inputValue as HttpServerInputValue;
  t.regex(inputValue.url, /http:\/\/localhost:3000\/api\/test\?token=REDACTED_[0-9a-f]{12}\.\.\.&other=value/);
  t.regex(inputValue.target, /\/api\/test\?token=REDACTED_[0-9a-f]{12}\.\.\.&other=value/);
});

test("transforms query parameter in client path with existing params", (t) => {
  const queryConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "outbound",
          queryParam: "api_key",
        },
        action: { type: "redact" },
      },
    ],
  };

  const spanWithQuery = cloneSpan(stripeClientSpanData);
  spanWithQuery.inputValue = {
    ...(spanWithQuery.inputValue as HttpClientInputValue),
    path: "/v1/charges?api_key=sk_test_123&other=value",
  };

  const engine = new HttpTransformEngine(queryConfig);
  const result = engine.applyTransforms(spanWithQuery);

  const inputValue = result.inputValue as HttpClientInputValue;
  t.regex(inputValue.path, /\/v1\/charges\?api_key=REDACTED_[0-9a-f]{12}\.\.\.&other=value/);
});

test("handles query param that doesn't exist", (t) => {
  const queryConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          queryParam: "nonexistent",
        },
        action: { type: "redact" },
      },
    ],
  };

  const engine = new HttpTransformEngine(queryConfig);
  const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));

  t.is(result.transformMetadata, undefined);
});

// header transforms
test("transforms header values case-insensitively", (t) => {
  const headerConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          headerName: "Content-Type",
        },
        action: { type: "replace", replaceWith: "application/redacted" },
      },
    ],
  };

  const engine = new HttpTransformEngine(headerConfig);
  const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));

  t.is((result.inputValue as HttpServerInputValue).headers["content-type"], "application/redacted");
});

test("transforms multiple headers with same name (case variations)", (t) => {
  const headerConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          headerName: "x-custom",
        },
        action: { type: "mask" },
      },
    ],
  };

  const spanWithMultiHeaders = cloneSpan(exampleServerSpanData);
  spanWithMultiHeaders.inputValue = {
    ...(spanWithMultiHeaders.inputValue as HttpServerInputValue),
    headers: {
      "X-Custom": "value1",
      "x-custom": "value2",
      "X-CUSTOM": "value3",
    },
  };

  const engine = new HttpTransformEngine(headerConfig);
  const result = engine.applyTransforms(spanWithMultiHeaders);

  t.is((result.inputValue as HttpServerInputValue).headers["x-custom"], "******");
});

// constructor and configuration
test("handles empty configuration", (t) => {
  const engine = new HttpTransformEngine();
  const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));

  t.deepEqual(result, exampleServerSpanData);
  t.is(result.transformMetadata, undefined);
});

test("handles configuration with empty http array", (t) => {
  const emptyConfig: TransformConfigs = { http: [] };
  const engine = new HttpTransformEngine(emptyConfig);
  const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));

  t.deepEqual(result, exampleServerSpanData);
  t.is(result.transformMetadata, undefined);
});

test("handles invalid regex patterns gracefully", (t) => {
  t.throws(() => {
    new HttpTransformEngine({
      http: [
        {
          matcher: {
            direction: "inbound",
            pathPattern: "[invalid[regex",
            jsonPath: "$.test",
          },
          action: { type: "redact" },
        },
      ],
    });
  }, { message: /Invalid path pattern/ });
});

test("handles invalid host regex patterns gracefully", (t) => {
  t.throws(() => {
    new HttpTransformEngine({
      http: [
        {
          matcher: {
            direction: "outbound",
            host: "[invalid[regex",
            jsonPath: "$.test",
          },
          action: { type: "redact" },
        },
      ],
    });
  }, { message: /Invalid host pattern/ });
});

// hostname extraction from URL
test("extracts hostname from inbound server URL for host matching", (t) => {
  const hostConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          host: "api\\.example\\.com",
          fullBody: true,
        },
        action: { type: "replace", replaceWith: "[REDACTED]" },
      },
    ],
  };

  const spanWithApiHost = cloneSpan(exampleServerSpanData);
  spanWithApiHost.inputValue = {
    ...(spanWithApiHost.inputValue as HttpServerInputValue),
    url: "https://api.example.com/api/auth/login",
  };

  const engine = new HttpTransformEngine(hostConfig);
  const result = engine.applyTransforms(spanWithApiHost);

  t.is((result.inputValue as HttpServerInputValue).body, "[REDACTED]");
});

test("handles malformed URLs gracefully in hostname extraction", (t) => {
  const hostConfig: TransformConfigs = {
    http: [
      {
        matcher: {
          direction: "inbound",
          host: "api\\.example\\.com",
          fullBody: true,
        },
        action: { type: "replace", replaceWith: "[REDACTED]" },
      },
    ],
  };

  const spanWithMalformedUrl = cloneSpan(exampleServerSpanData);
  spanWithMalformedUrl.inputValue = {
    ...(spanWithMalformedUrl.inputValue as HttpServerInputValue),
    url: "not-a-valid-url",
  };

  const engine = new HttpTransformEngine(hostConfig);
  const result = engine.applyTransforms(spanWithMalformedUrl);

  t.is(result.transformMetadata, undefined);
});
