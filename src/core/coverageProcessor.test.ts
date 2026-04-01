import test from "ava";
import {
  computeLineStarts,
  offsetToLine,
  processScriptCoverage,
  filterScriptUrl,
  processV8CoverageFile,
  type V8FunctionCoverage,
  type V8CoverageData,
} from "./coverageProcessor";

// --- computeLineStarts ---

test("computeLineStarts: empty string", (t) => {
  t.deepEqual(computeLineStarts(""), [0]);
});

test("computeLineStarts: single line", (t) => {
  t.deepEqual(computeLineStarts("hello"), [0]);
});

test("computeLineStarts: multi-line", (t) => {
  t.deepEqual(computeLineStarts("ab\ncd\nef"), [0, 3, 6]);
});

test("computeLineStarts: trailing newline", (t) => {
  t.deepEqual(computeLineStarts("ab\n"), [0, 3]);
});

// --- offsetToLine ---

test("offsetToLine: first line", (t) => {
  const starts = [0, 10, 20, 30];
  t.is(offsetToLine(starts, 0), 1);
  t.is(offsetToLine(starts, 5), 1);
  t.is(offsetToLine(starts, 9), 1);
});

test("offsetToLine: middle lines", (t) => {
  const starts = [0, 10, 20, 30];
  t.is(offsetToLine(starts, 10), 2);
  t.is(offsetToLine(starts, 15), 2);
  t.is(offsetToLine(starts, 20), 3);
});

test("offsetToLine: beyond last line start", (t) => {
  const starts = [0, 10, 20, 30];
  t.is(offsetToLine(starts, 35), 4);
});

// --- processScriptCoverage: innermost range wins ---

test("processScriptCoverage: outer covered, inner uncovered (catch block)", (t) => {
  // 6 lines, each 6 chars: "line1\nline2\nline3\nline4\nline5\n"
  const lineStarts = [0, 6, 12, 18, 24, 30];
  const functions: V8FunctionCoverage[] = [
    {
      ranges: [
        { startOffset: 0, endOffset: 29, count: 1 }, // whole function called
        { startOffset: 12, endOffset: 23, count: 0 }, // catch block never entered
      ],
    },
  ];

  const result = processScriptCoverage(functions, lineStarts, true);
  t.is(result["1"], 1); // outer
  t.is(result["2"], 1); // outer
  t.is(result["3"], 0); // inner catch (overwrites)
  t.is(result["4"], 0); // inner catch (overwrites)
  t.is(result["5"], 1); // outer resumes
});

test("processScriptCoverage: per-test filters out count=0", (t) => {
  const lineStarts = [0, 6, 12, 18, 24, 30];
  const functions: V8FunctionCoverage[] = [
    {
      ranges: [
        { startOffset: 0, endOffset: 29, count: 1 },
        { startOffset: 12, endOffset: 23, count: 0 },
      ],
    },
  ];

  const result = processScriptCoverage(functions, lineStarts, false);
  t.is(result["1"], 1);
  t.is(result["2"], 1);
  t.falsy(result["3"]); // filtered
  t.falsy(result["4"]); // filtered
  t.is(result["5"], 1);
});

test("processScriptCoverage: uncalled function baseline includes at count=0", (t) => {
  const lineStarts = [0, 6, 12];
  const functions: V8FunctionCoverage[] = [
    { ranges: [{ startOffset: 0, endOffset: 11, count: 0 }] },
  ];

  const result = processScriptCoverage(functions, lineStarts, true);
  t.is(result["1"], 0);
  t.is(result["2"], 0);
});

test("processScriptCoverage: uncalled function per-test is empty", (t) => {
  const lineStarts = [0, 6, 12];
  const functions: V8FunctionCoverage[] = [
    { ranges: [{ startOffset: 0, endOffset: 11, count: 0 }] },
  ];

  const result = processScriptCoverage(functions, lineStarts, false);
  t.is(Object.keys(result).length, 0);
});

test("processScriptCoverage: if/else only one branch taken", (t) => {
  const lineStarts = [0, 6, 12, 18, 24, 30];
  const functions: V8FunctionCoverage[] = [
    {
      ranges: [
        { startOffset: 0, endOffset: 29, count: 1 }, // whole function
        { startOffset: 6, endOffset: 11, count: 1 }, // if branch (taken)
        { startOffset: 12, endOffset: 17, count: 0 }, // else branch (not taken)
      ],
    },
  ];

  const result = processScriptCoverage(functions, lineStarts, true);
  t.is(result["1"], 1);
  t.is(result["2"], 1); // if taken
  t.is(result["3"], 0); // else not taken
  t.is(result["4"], 1); // after if/else
});

test("processScriptCoverage: real execution counts preserved", (t) => {
  const lineStarts = [0, 6, 12];
  const functions: V8FunctionCoverage[] = [
    { ranges: [{ startOffset: 0, endOffset: 11, count: 5 }] },
  ];

  const result = processScriptCoverage(functions, lineStarts, false);
  t.is(result["1"], 5);
  t.is(result["2"], 5);
});

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

// --- processV8CoverageFile ---

test("processV8CoverageFile: processes covered and uncovered functions", (t) => {
  // Source: 5 lines of 10 chars each (0-9, 10-19, 20-29, 30-39, 40-49)
  // handleGet: lines 1-3 (offsets 0-29), catch: line 2 (offsets 10-19)
  // handlePost: lines 4-5 (offsets 30-49), never called
  const v8Data: V8CoverageData = {
    result: [
      {
        url: "file:///project/server.js",
        functions: [
          {
            functionName: "handleGet",
            ranges: [
              { startOffset: 0, endOffset: 29, count: 1 }, // lines 1-3
              { startOffset: 10, endOffset: 19, count: 0 }, // line 2 only (catch)
            ],
          },
          {
            functionName: "handlePost",
            ranges: [{ startOffset: 30, endOffset: 49, count: 0 }], // lines 4-5, never called
          },
        ],
      },
    ],
  };

  const mockReader = (p: string, _e: string): string => {
    if (p.endsWith("coverage.json")) return JSON.stringify(v8Data);
    return "line1____\nline2____\nline3____\nline4____\nline5____\n";
  };

  // Baseline: include uncovered
  const baseline = processV8CoverageFile("/tmp/coverage.json", "/project", true, mockReader);
  const lines = baseline["/project/server.js"];
  t.truthy(lines);
  t.is(lines["1"], 1); // outer range covered
  t.is(lines["2"], 0); // inner catch block (overwrites to 0)
  t.is(lines["3"], 1); // outer range covered
  t.is(lines["4"], 0); // handlePost never called
  t.is(lines["5"], 0); // handlePost never called

  // Per-test: exclude uncovered
  const perTest = processV8CoverageFile("/tmp/coverage.json", "/project", false, mockReader);
  const ptLines = perTest["/project/server.js"];
  t.truthy(ptLines);
  t.is(ptLines["1"], 1);
  t.falsy(ptLines["2"]); // catch filtered
  t.is(ptLines["3"], 1);
  t.falsy(ptLines["4"]); // handlePost filtered
});

test("processV8CoverageFile: excludes node_modules", (t) => {
  const v8Data: V8CoverageData = {
    result: [
      {
        url: "file:///project/node_modules/express/index.js",
        functions: [{ ranges: [{ startOffset: 0, endOffset: 10, count: 1 }] }],
      },
    ],
  };

  const mockReader = (p: string, _e: string): string => JSON.stringify(v8Data);
  const result = processV8CoverageFile("/tmp/coverage.json", "/project", false, mockReader);
  t.is(Object.keys(result).length, 0);
});
