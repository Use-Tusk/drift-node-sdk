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

test("filterScriptUrl: accepts files when sourceRoot is / (Docker root)", (t) => {
  t.is(filterScriptUrl("file:///app/src/server.js", "/"), "/app/src/server.js");
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

// --- Babel plugin selection and parsing tests ---

test("Babel plugin selection: TypeScript files get typescript and decorators-legacy plugins", (t) => {
  const scriptPath = "/project/src/service.ts";
  const isTypeScript = /\.(ts|tsx|mts|cts)$/.test(scriptPath);
  const isTSX = /\.tsx$/.test(scriptPath);
  const babelPlugins: string[] = isTypeScript
    ? ["typescript", "decorators-legacy", ...(isTSX ? ["jsx"] : [])]
    : ["decorators-legacy"];

  t.deepEqual(babelPlugins, ["typescript", "decorators-legacy"]);
});

test("Babel plugin selection: TSX files get typescript, decorators-legacy, and jsx plugins", (t) => {
  const scriptPath = "/project/src/Component.tsx";
  const isTypeScript = /\.(ts|tsx|mts|cts)$/.test(scriptPath);
  const isTSX = /\.tsx$/.test(scriptPath);
  const babelPlugins: string[] = isTypeScript
    ? ["typescript", "decorators-legacy", ...(isTSX ? ["jsx"] : [])]
    : ["decorators-legacy"];

  t.deepEqual(babelPlugins, ["typescript", "decorators-legacy", "jsx"]);
});

test("Babel plugin selection: .mts files get typescript and decorators-legacy plugins", (t) => {
  const scriptPath = "/project/src/module.mts";
  const isTypeScript = /\.(ts|tsx|mts|cts)$/.test(scriptPath);
  const isTSX = /\.tsx$/.test(scriptPath);
  const babelPlugins: string[] = isTypeScript
    ? ["typescript", "decorators-legacy", ...(isTSX ? ["jsx"] : [])]
    : ["decorators-legacy"];

  t.deepEqual(babelPlugins, ["typescript", "decorators-legacy"]);
});

test("Babel plugin selection: .cts files get typescript and decorators-legacy plugins", (t) => {
  const scriptPath = "/project/src/commonjs.cts";
  const isTypeScript = /\.(ts|tsx|mts|cts)$/.test(scriptPath);
  const isTSX = /\.tsx$/.test(scriptPath);
  const babelPlugins: string[] = isTypeScript
    ? ["typescript", "decorators-legacy", ...(isTSX ? ["jsx"] : [])]
    : ["decorators-legacy"];

  t.deepEqual(babelPlugins, ["typescript", "decorators-legacy"]);
});

test("Babel plugin selection: JavaScript files get only decorators-legacy plugin", (t) => {
  const scriptPath = "/project/src/service.js";
  const isTypeScript = /\.(ts|tsx|mts|cts)$/.test(scriptPath);
  const isTSX = /\.tsx$/.test(scriptPath);
  const babelPlugins: string[] = isTypeScript
    ? ["typescript", "decorators-legacy", ...(isTSX ? ["jsx"] : [])]
    : ["decorators-legacy"];

  t.deepEqual(babelPlugins, ["decorators-legacy"]);
});

test("Babel plugin selection: .mjs files get only decorators-legacy plugin", (t) => {
  const scriptPath = "/project/src/module.mjs";
  const isTypeScript = /\.(ts|tsx|mts|cts)$/.test(scriptPath);
  const isTSX = /\.tsx$/.test(scriptPath);
  const babelPlugins: string[] = isTypeScript
    ? ["typescript", "decorators-legacy", ...(isTSX ? ["jsx"] : [])]
    : ["decorators-legacy"];

  t.deepEqual(babelPlugins, ["decorators-legacy"]);
});

test("Babel plugin selection: .cjs files get only decorators-legacy plugin", (t) => {
  const scriptPath = "/project/src/commonjs.cjs";
  const isTypeScript = /\.(ts|tsx|mts|cts)$/.test(scriptPath);
  const isTSX = /\.tsx$/.test(scriptPath);
  const babelPlugins: string[] = isTypeScript
    ? ["typescript", "decorators-legacy", ...(isTSX ? ["jsx"] : [])]
    : ["decorators-legacy"];

  t.deepEqual(babelPlugins, ["decorators-legacy"]);
});

// --- Babel parser integration tests ---

test("Babel parser: can parse TypeScript with parameter decorators (decorators-legacy)", (t) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const babelParser = require("@babel/parser");
  const tsCode = `
class Service {
  constructor(@inject('repo') private repo: any) {}
}
`;

  // Should parse without error using decorators-legacy
  const ast = babelParser.parse(tsCode, {
    sourceType: "module",
    plugins: ["typescript", "decorators-legacy"],
  });

  t.truthy(ast);
  t.is(ast.type, "File");
});

test("Babel parser: can parse TSX with JSX syntax", (t) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const babelParser = require("@babel/parser");
  const tsxCode = `
const Component = () => <div>Hello</div>;
export { Component };
`;

  // Should parse without error using typescript + jsx + decorators-legacy
  const ast = babelParser.parse(tsxCode, {
    sourceType: "module",
    plugins: ["typescript", "decorators-legacy", "jsx"],
  });

  t.truthy(ast);
  t.is(ast.type, "File");
});

test("Babel parser: can parse JavaScript with class decorators", (t) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const babelParser = require("@babel/parser");
  const jsCode = `
@decorator
class Example {}
`;

  // Should parse without error using decorators-legacy
  const ast = babelParser.parse(jsCode, {
    sourceType: "module",
    plugins: ["decorators-legacy"],
  });

  t.truthy(ast);
  t.is(ast.type, "File");
});
