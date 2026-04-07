import test from "ava";
import {
  filterScriptUrl,
  takeAndProcessSnapshot,
  V8CoverageData,
} from "./coverageProcessor";
import fs from "fs";
import path from "path";
import os from "os";

// --- filterScriptUrl ---

test("filterScriptUrl: accepts user source files", (t) => {
  t.is(filterScriptUrl("file:///project/src/app.js", "/project"), "/project/src/app.js");
});

test("filterScriptUrl: rejects non-file URLs", (t) => {
  t.is(filterScriptUrl("node:internal/modules", "/project"), null);
  t.is(filterScriptUrl("", "/project"), null);
});

test("filterScriptUrl: rejects node_modules", (t) => {
  t.is(filterScriptUrl("file:///project/node_modules/express/index.js", "/project"), null);
});

test("filterScriptUrl: rejects files outside sourceRoot", (t) => {
  t.is(filterScriptUrl("file:///other/project/app.js", "/project"), null);
});

test("filterScriptUrl: rejects prefix collisions (e.g., /app vs /application)", (t) => {
  t.is(filterScriptUrl("file:///application/src/app.js", "/app"), null);
});

test("filterScriptUrl: handles URL-encoded paths (spaces)", (t) => {
  t.is(
    filterScriptUrl("file:///my%20project/src/app.js", "/my project"),
    "/my project/src/app.js"
  );
});

// --- takeAndProcessSnapshot ---

test("takeAndProcessSnapshot: skips coverage files without user scripts", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-test-"));
  const coverageDir = path.join(tmpDir, "coverage");
  fs.mkdirSync(coverageDir);

  try {
    // Create coverage for node_modules only
    const v8Data: V8CoverageData = {
      result: [
        {
          url: "file:///some/path/node_modules/pkg/index.js",
          functions: [
            {
              functionName: "",
              ranges: [{ startOffset: 0, endOffset: 10, count: 1 }],
            },
          ],
        },
      ],
    };

    const coverageFile = path.join(coverageDir, "coverage-1.json");
    fs.writeFileSync(coverageFile, JSON.stringify(v8Data));

    const result = await takeAndProcessSnapshot(coverageDir, tmpDir, false);

    // Should skip files without user scripts
    t.deepEqual(result, {});

    // File should be cleaned up
    const remainingFiles = fs.readdirSync(coverageDir);
    t.is(remainingFiles.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
