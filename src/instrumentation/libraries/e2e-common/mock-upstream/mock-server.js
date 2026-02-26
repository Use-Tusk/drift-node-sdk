#!/usr/bin/env node

const http = require("http");
const { URL } = require("url");

const port = Number(process.env.MOCK_UPSTREAM_PORT || "8081");

function sendJson(res, payload, status = 200) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(body.length),
  });
  res.end(body);
}

function sendText(res, payload, status = 200) {
  const body = Buffer.from(payload, "utf-8");
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": String(body.length),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", () => resolve(""));
  });
}

function mockPost(id) {
  return { id, title: `Mock Post ${id}`, body: `Body for post ${id}`, userId: ((id - 1) % 10) + 1 };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  const path = url.pathname;
  const method = req.method || "GET";

  if (path === "/health") {
    return sendJson(res, { status: "ok" });
  }

  if (method === "GET" && path === "/posts/1") {
    return sendJson(res, mockPost(1));
  }

  if (method === "GET" && path === "/posts") {
    const limit = Number(url.searchParams.get("_limit") || "5");
    const posts = Array.from({ length: limit }, (_, i) => mockPost(i + 1));
    return sendJson(res, posts);
  }

  if (method === "GET" && path === "/users") {
    return sendJson(
      res,
      Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        name: `User ${i + 1}`,
        username: `user${i + 1}`,
        email: `user${i + 1}@example.com`,
      })),
    );
  }

  if (method === "POST" && path === "/posts") {
    const raw = await readBody(req);
    let parsed = {};
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = {};
    }
    return sendJson(
      res,
      {
        id: 101,
        title: parsed.title || "mock-title",
        body: parsed.body || "",
        userId: parsed.userId || 1,
        test: parsed.test || undefined,
      },
      201,
    );
  }

  if (method === "GET" && path === "/robots.txt") {
    return sendText(res, "User-agent: *\nDisallow: /deny\n");
  }

  if (method === "GET" && url.searchParams.get("format") === "j1") {
    const location = decodeURIComponent(path.replace(/^\/+/, "") || "San Francisco");
    return sendJson(res, {
      current_condition: [
        {
          temp_F: "72",
          humidity: "55",
          localObsDateTime: "2026-02-26 07:00 PM",
          weatherDesc: [{ value: `Clear (${location})` }],
          pressure: "1015",
        },
      ],
    });
  }

  return sendJson(res, { error: `No mock route for ${method} ${path}` }, 404);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Mock upstream listening on :${port}`);
});
