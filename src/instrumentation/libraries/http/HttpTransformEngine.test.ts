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
        fullBody: "",
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

describe("HttpTransformEngine", () => {
  it("redacts sensitive fields on inbound login spans", () => {
    const engine = new HttpTransformEngine(redactMaskReplaceConfig);
    const transformed = engine.applyTransforms(cloneSpan(exampleServerSpanData));

    expect(transformed).not.toBeNull();
    const span = transformed as HttpSpanData;

    expect((span.inputValue as HttpServerInputValue).body.password).toMatch(
      /^PWD_[0-9a-f]{12}\.\.\.$/,
    );
    expect(span.transformMetadata?.actions).toEqual([
      expect.objectContaining({
        type: "redact",
        field: "jsonPath:$.password",
        reason: "transforms",
      }),
    ]);
  });

  it("drops outbound spans that match the Stripe policy", () => {
    const engine = new HttpTransformEngine(dropConfig);
    const transformed = engine.applyTransforms(cloneSpan(stripeClientSpanData));

    expect(transformed).not.toBeNull();
    const span = transformed as HttpSpanData;

    expect(span.inputValue).toEqual({});
    expect(span.outputValue).toEqual({});
    expect(span.transformMetadata?.actions).toEqual([
      expect.objectContaining({ type: "drop", field: "entire_span" }),
    ]);
  });

  it("applies multiple transforms to a single span", () => {
    const engine = new HttpTransformEngine(multiConfig);
    const transformed = engine.applyTransforms(cloneSpan(multiTransformServerSpan));

    expect(transformed).not.toBeNull();
    const span = transformed as HttpSpanData;

    const inputValue = span.inputValue as HttpServerInputValue;
    expect(inputValue.url).toBe(
      "http://localhost:3000/api/user/lookup?ssn=XXXXXXXXXXX&email=user%40example.com",
    );
    expect(inputValue.target).toBe("/api/user/lookup?ssn=XXXXXXXXXXX&email=user%40example.com");
    expect(inputValue.body.user.password).toBe("HIDDEN");
    expect(span.transformMetadata?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "mask", field: "queryParam:ssn" }),
        expect.objectContaining({ type: "replace", field: "jsonPath:$.user.password" }),
      ]),
    );
  });

  it("identifies inbound requests that should be dropped", () => {
    const inboundDropConfig: TransformConfigs = {
      http: [
        {
          matcher: {
            direction: "inbound",
            method: ["POST"],
            pathPattern: "/api/auth/login",
            fullBody: "",
          },
          action: { type: "drop" },
        },
      ],
    };

    const engine = new HttpTransformEngine(inboundDropConfig);

    expect(
      engine.shouldDropInboundRequest("POST", "http://localhost:3000/api/auth/login", "localhost", {
        "content-type": "application/json",
      }),
    ).toBe(true);

    expect(
      engine.shouldDropInboundRequest(
        "POST",
        "http://localhost:3000/api/other/endpoint",
        "localhost",
        { "content-type": "application/json" },
      ),
    ).toBe(false);

    expect(
      engine.shouldDropInboundRequest("GET", "http://localhost:3000/api/auth/login", "localhost", {
        "content-type": "application/json",
      }),
    ).toBe(false);
  });

  describe("direction-specific field handling", () => {
    it("correctly matches outbound spans using hostname field", () => {
      const outboundHostConfig: TransformConfigs = {
        http: [
          {
            matcher: {
              direction: "outbound",
              host: "api\\.stripe\\.com",
              fullBody: "",
            },
            action: { type: "replace", replaceWith: "[REDACTED]" },
          },
        ],
      };

      const engine = new HttpTransformEngine(outboundHostConfig);
      const result = engine.applyTransforms(cloneSpan(stripeClientSpanData));

      // Output body is base64-encoded, so we need to decode it or check for base64 of "[REDACTED]"
      expect((result.outputValue as HttpClientOutputValue).body).toBe(
        Buffer.from("[REDACTED]").toString("base64")
      );
    });

    it("correctly matches inbound spans by extracting hostname from URL", () => {
      const inboundHostConfig: TransformConfigs = {
        http: [
          {
            matcher: {
              direction: "inbound",
              host: "localhost",
              fullBody: "",
            },
            action: { type: "replace", replaceWith: "[REDACTED]" },
          },
        ],
      };

      const engine = new HttpTransformEngine(inboundHostConfig);
      const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));

      // Input body for server spans is a plain object (request body)
      expect((result.inputValue as HttpServerInputValue).body).toBe("[REDACTED]");
    });

    it("correctly matches outbound spans using path field", () => {
      const outboundPathConfig: TransformConfigs = {
        http: [
          {
            matcher: {
              direction: "outbound",
              pathPattern: "/v1/charges",
              fullBody: "",
            },
            action: { type: "replace", replaceWith: "[REDACTED]" },
          },
        ],
      };

      const engine = new HttpTransformEngine(outboundPathConfig);
      const result = engine.applyTransforms(cloneSpan(stripeClientSpanData));

      // Output body is base64-encoded
      expect((result.outputValue as HttpClientOutputValue).body).toBe(
        Buffer.from("[REDACTED]").toString("base64")
      );
    });

    it("correctly matches inbound spans using url field", () => {
      const inboundPathConfig: TransformConfigs = {
        http: [
          {
            matcher: {
              direction: "inbound",
              pathPattern: "/api/auth/login",
              fullBody: "",
            },
            action: { type: "replace", replaceWith: "[REDACTED]" },
          },
        ],
      };

      const engine = new HttpTransformEngine(inboundPathConfig);
      const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));

      expect((result.inputValue as HttpServerInputValue).body).toBe("[REDACTED]");
    });
  });

  describe("edge cases and error handling", () => {
    it("handles spans with missing input/output values", () => {
      const engine = new HttpTransformEngine(redactMaskReplaceConfig);
      const spanWithMissingInput = {
        ...cloneSpan(exampleServerSpanData),
        inputValue: undefined,
      };

      const result = engine.applyTransforms(spanWithMissingInput as any);
      expect(result.transformMetadata).toBeUndefined();
    });

    it("handles invalid JSONPath expressions gracefully", () => {
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
      expect(result.transformMetadata).toBeUndefined();
    });

    it("handles spans with missing body", () => {
      const engine = new HttpTransformEngine(redactMaskReplaceConfig);
      const spanWithoutBody = cloneSpan(exampleServerSpanData);
      spanWithoutBody.inputValue = {
        ...(spanWithoutBody.inputValue as HttpServerInputValue),
        body: undefined,
      };

      const result = engine.applyTransforms(spanWithoutBody as any);
      expect(result.transformMetadata).toBeUndefined();
    });

    it("handles spans with null/undefined headers", () => {
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
      expect(result.transformMetadata).toBeUndefined();
    });
  });

  describe("transform action types", () => {
    it("applies mask transform with custom mask character", () => {
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

      expect((result.inputValue as HttpServerInputValue).body.password).toBe("#################");
    });

    it("applies redact transform with custom hash prefix", () => {
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

      expect((result.inputValue as HttpServerInputValue).body.password).toMatch(
        /^HIDDEN_[0-9a-f]{12}\.\.\.$/,
      );
    });

    it("applies replace transform", () => {
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

      expect((result.inputValue as HttpServerInputValue).body.username).toBe(
        "anonymous@example.com",
      );
    });
  });

  describe("matcher combinations", () => {
    it("matches spans by method only", () => {
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

      expect((result.inputValue as HttpServerInputValue).body.password).toMatch(
        /^REDACTED_[0-9a-f]{12}\.\.\.$/,
      );
    });

    it("matches multiple methods when array is provided", () => {
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
      expect((postResult.inputValue as HttpServerInputValue).body.username).toBe("ARRAY_MATCHED");

      const putSpan = cloneSpan(exampleServerSpanData);
      putSpan.inputValue = {
        ...(putSpan.inputValue as HttpServerInputValue),
        method: "PUT",
      };
      const putResult = engine.applyTransforms(putSpan);
      expect((putResult.inputValue as HttpServerInputValue).body.username).toBe("ARRAY_MATCHED");

      const getSpan = cloneSpan(exampleServerSpanData);
      getSpan.inputValue = {
        ...(getSpan.inputValue as HttpServerInputValue),
        method: "GET",
      };
      const getResult = engine.applyTransforms(getSpan);
      expect((getResult.inputValue as HttpServerInputValue).body.username).toBe("john@example.com");
      expect(getResult.transformMetadata).toBeUndefined();
    });

    it("does not match when method doesn't match", () => {
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

      expect((result.inputValue as HttpServerInputValue).body.password).toBe("secretPassword123");
      expect(result.transformMetadata).toBeUndefined();
    });

    it("does not match when direction doesn't match", () => {
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

      expect((result.inputValue as HttpServerInputValue).body.password).toBe("secretPassword123");
      expect(result.transformMetadata).toBeUndefined();
    });
  });

  describe("URL path transforms", () => {
    it("transforms URL path in inbound server request", () => {
      const urlPathConfig: TransformConfigs = {
        http: [
          {
            matcher: {
              direction: "inbound",
              urlPath: "",
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
      expect(inputValue.url).toBe("/api/redacted");
      expect(inputValue.target).toBe("/api/redacted");
    });

    it("transforms URL path in outbound client request", () => {
      const urlPathConfig: TransformConfigs = {
        http: [
          {
            matcher: {
              direction: "outbound",
              urlPath: "",
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
      expect(inputValue.path).toBe("/api/redacted");
    });
  });

  describe("query parameter transforms", () => {
    it("transforms query parameter in server URL with existing params", () => {
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
      expect(inputValue.url).toMatch(
        /http:\/\/localhost:3000\/api\/test\?token=REDACTED_[0-9a-f]{12}\.\.\.&other=value/,
      );
      expect(inputValue.target).toMatch(
        /\/api\/test\?token=REDACTED_[0-9a-f]{12}\.\.\.&other=value/,
      );
    });

    it("transforms query parameter in client path with existing params", () => {
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
      expect(inputValue.path).toMatch(
        /\/v1\/charges\?api_key=REDACTED_[0-9a-f]{12}\.\.\.&other=value/,
      );
    });

    it("handles query param that doesn't exist", () => {
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

      expect(result.transformMetadata).toBeUndefined();
    });
  });

  describe("header transforms", () => {
    it("transforms header values case-insensitively", () => {
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

      expect((result.inputValue as HttpServerInputValue).headers["content-type"]).toBe(
        "application/redacted",
      );
    });

    it("transforms multiple headers with same name (case variations)", () => {
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

      expect((result.inputValue as HttpServerInputValue).headers["x-custom"]).toBe("******");
    });
  });

  describe("constructor and configuration", () => {
    it("handles empty configuration", () => {
      const engine = new HttpTransformEngine();
      const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));

      expect(result).toEqual(exampleServerSpanData);
      expect(result.transformMetadata).toBeUndefined();
    });

    it("handles configuration with empty http array", () => {
      const emptyConfig: TransformConfigs = { http: [] };
      const engine = new HttpTransformEngine(emptyConfig);
      const result = engine.applyTransforms(cloneSpan(exampleServerSpanData));

      expect(result).toEqual(exampleServerSpanData);
      expect(result.transformMetadata).toBeUndefined();
    });

    it("handles invalid regex patterns gracefully", () => {
      expect(() => {
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
      }).toThrow(/Invalid path pattern/);
    });

    it("handles invalid host regex patterns gracefully", () => {
      expect(() => {
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
      }).toThrow(/Invalid host pattern/);
    });
  });

  describe("hostname extraction from URL", () => {
    it("extracts hostname from inbound server URL for host matching", () => {
      const hostConfig: TransformConfigs = {
        http: [
          {
            matcher: {
              direction: "inbound",
              host: "api\\.example\\.com",
              fullBody: "",
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

      expect((result.inputValue as HttpServerInputValue).body).toBe("[REDACTED]");
    });

    it("handles malformed URLs gracefully in hostname extraction", () => {
      const hostConfig: TransformConfigs = {
        http: [
          {
            matcher: {
              direction: "inbound",
              host: "api\\.example\\.com",
              fullBody: "",
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

      expect(result.transformMetadata).toBeUndefined();
    });
  });
});
