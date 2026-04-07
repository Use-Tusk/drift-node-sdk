import test from "ava";
import { filterScriptUrl } from "./coverageProcessor";

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

test("filterScriptUrl: handles URL-encoded paths (spaces)", (t) => {
  t.is(
    filterScriptUrl("file:///my%20project/src/app.js", "/my project"),
    "/my project/src/app.js"
  );
});

// Note: processV8CoverageFile and takeAndProcessSnapshot use ast-v8-to-istanbul
// internally and require real files on disk. They are tested via end-to-end tests.
