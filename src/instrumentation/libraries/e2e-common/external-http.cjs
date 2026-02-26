const http = require("http");
const https = require("https");

const EXTERNAL_HTTP_TIMEOUT_MS = Number(process.env.EXTERNAL_HTTP_TIMEOUT_MS || "3000");
const USE_MOCK_EXTERNALS = ["1", "true", "yes"].includes((process.env.USE_MOCK_EXTERNALS || "").toLowerCase());
const MOCK_SERVER_BASE_URL = process.env.MOCK_SERVER_BASE_URL || "http://mock-upstream:8081";

function upstreamUrl(rawUrl) {
  if (!USE_MOCK_EXTERNALS) {
    return rawUrl;
  }
  const src = new URL(rawUrl);
  const base = new URL(MOCK_SERVER_BASE_URL);
  return `${base.origin}${src.pathname}${src.search}`;
}

function withExternalTimeout(init = {}) {
  if (init.signal) {
    return init;
  }

  const timeoutSignal = createTimeoutSignal(EXTERNAL_HTTP_TIMEOUT_MS);
  return {
    ...init,
    ...(timeoutSignal ? { signal: timeoutSignal } : {}),
  };
}

function createTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }

  if (typeof AbortController === "undefined") {
    return undefined;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller.signal;
}

function resolveClient(target) {
  return target.protocol === "https:" ? https : http;
}

function getExternalHttpTimeoutMs() {
  return EXTERNAL_HTTP_TIMEOUT_MS;
}

function getTextViaNode(rawUrl) {
  const target = new URL(upstreamUrl(rawUrl.toString()));
  const client = resolveClient(target);
  return new Promise((resolve, reject) => {
    client
      .get(
        target,
        {
          timeout: EXTERNAL_HTTP_TIMEOUT_MS,
        },
        (response) => {
          let data = "";
          response.on("data", (chunk) => {
            data += chunk;
          });
          response.on("end", () => resolve(data));
        },
      )
      .on("error", reject);
  });
}

function requestTextViaNode(rawUrl, method, body) {
  const target = new URL(upstreamUrl(rawUrl.toString()));
  const client = resolveClient(target);
  return new Promise((resolve, reject) => {
    const request = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port ? Number(target.port) : target.protocol === "https:" ? 443 : 80,
        path: `${target.pathname}${target.search}`,
        method,
        headers: {
          "Content-Type": "application/json",
        },
        timeout: EXTERNAL_HTTP_TIMEOUT_MS,
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => resolve(data));
      },
    );

    request.on("error", reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

module.exports = {
  upstreamUrl,
  withExternalTimeout,
  getExternalHttpTimeoutMs,
  getTextViaNode,
  requestTextViaNode,
};
