/**
 * V8 coverage data processing using ast-v8-to-istanbul.
 *
 * Converts raw V8 coverage JSON into per-file coverage data with accurate
 * line, branch, and function coverage. ast-v8-to-istanbul parses the source
 * file's AST independently, so it correctly handles partial V8 data (after
 * v8.takeCoverage() reset) where uncalled functions are absent from V8 output.
 *
 * This is the key advantage over v8-to-istanbul (which assumes complete V8 data
 * and marks missing functions as "covered by default").
 */

import fs from "fs";
import path from "path";

/** Branch info for a single line */
export interface BranchInfo {
  total: number;
  covered: number;
}

/** Per-file coverage data including lines and branches */
export interface FileCoverageData {
  lines: Record<string, number>; // lineNumber -> hitCount
  totalBranches: number;
  coveredBranches: number;
  branches: Record<string, BranchInfo>; // lineNumber -> branch detail
}

/** Coverage for all files */
export type CoverageResult = Record<string, FileCoverageData>;

/** V8 coverage types */
export interface V8CoverageRange {
  startOffset: number;
  endOffset: number;
  count: number;
}

export interface V8FunctionCoverage {
  functionName?: string;
  ranges: V8CoverageRange[];
  isBlockCoverage?: boolean;
}

export interface V8ScriptCoverage {
  scriptId?: string;
  url: string;
  functions: V8FunctionCoverage[];
}

export interface V8CoverageData {
  result: V8ScriptCoverage[];
}

/**
 * Filter a script URL to determine if it's a user source file.
 */
export function filterScriptUrl(
  url: string,
  sourceRoot: string,
): string | null {
  if (!url || !url.startsWith("file://")) return null;
  let filePath: string;
  try {
    filePath = new URL(url).pathname;
    // Decode percent-encoded characters (e.g., spaces as %20)
    filePath = decodeURIComponent(filePath);
  } catch {
    filePath = url.replace("file://", "");
  }
  if (filePath.includes("node_modules")) return null;
  // Check path boundary to avoid prefix collisions (/app matching /application).
  // When sourceRoot is "/" (root dir, common in Docker), all absolute paths match.
  if (sourceRoot !== "/" && !filePath.startsWith(sourceRoot + "/") && filePath !== sourceRoot) return null;
  return filePath;
}

/**
 * Load a source map for a compiled file, if available.
 * Checks for //# sourceMappingURL= comment and loads the .map file.
 */
function loadSourceMap(
  filePath: string,
  code: string,
  projectRoot: string,
): Record<string, unknown> | null {
  // Look for //# sourceMappingURL=<filename> at the end of the file
  const match = code.match(/\/\/[#@]\s*sourceMappingURL=(.+?)(?:\s|$)/);
  if (!match) return null;

  const mapRef = match[1].trim();

  // Skip data URIs (inline source maps) for now
  if (mapRef.startsWith("data:")) return null;

  // Resolve relative to the source file
  const mapPath = path.resolve(path.dirname(filePath), mapRef);

  try {
    const mapData = JSON.parse(fs.readFileSync(mapPath, "utf-8"));

    // Fix: ast-v8-to-istanbul's internal path resolution breaks when sourceRoot
    // is present (coverageMapData keys don't match position filenames).
    // We resolve sources to real filesystem paths relative to the map file,
    // then remove sourceRoot so ast-v8-to-istanbul uses simple relative paths.
    if (mapData.sourceRoot && Array.isArray(mapData.sources)) {
      const mapDir = path.dirname(mapPath);
      let resolvedRoot: string;

      if (mapData.sourceRoot === "/") {
        // TypeScript convention: "/" means project root, not filesystem root
        resolvedRoot = projectRoot;
      } else if (path.isAbsolute(mapData.sourceRoot)) {
        resolvedRoot = mapData.sourceRoot;
      } else {
        // Relative sourceRoot (e.g., "./src") — resolve from map file directory
        resolvedRoot = path.resolve(mapDir, mapData.sourceRoot);
      }

      mapData.sources = mapData.sources.map((s: string) => {
        const actualPath = path.resolve(resolvedRoot, s);
        return path.relative(mapDir, actualPath);
      });
      delete mapData.sourceRoot;
    }

    return mapData;
  } catch {
    return null;
  }
}

/**
 * Resolve a source path from Istanbul's remapped key to an absolute path.
 * Istanbul may produce relative paths (e.g., "../src/server.ts") based on
 * the source map's "sources" field.
 */
function resolveSourcePath(
  istanbulKey: string,
  compiledPath: string,
): string {
  if (path.isAbsolute(istanbulKey)) return istanbulKey;
  // Resolve relative to the compiled file's directory
  return path.resolve(path.dirname(compiledPath), istanbulKey);
}

/**
 * Resolve the JavaScript source code to parse for a given file path.
 *
 * For .js files: reads directly from disk, checks for source maps.
 * For .ts files (ts-node): V8's URL points to the .ts file, but the code
 * V8 executed is compiled JS. With TS_NODE_EMIT=true, ts-node writes
 * compiled JS + source maps to .ts-node/ directory. We look there.
 */
function resolveSourceCode(scriptPath: string, projectRoot: string): {
  code: string;
  resolvedPath: string;
  sourceMap: Record<string, unknown> | null;
} {
  // For .ts/.tsx files, look for compiled JS in .ts-node/ directory
  if (scriptPath.match(/\.(ts|tsx|mts|cts)$/)) {
    // ts-node with TS_NODE_EMIT=true writes to .ts-node/ in the project root
    // The compiled file mirrors the source path structure
    const tsNodeDir = path.join(projectRoot, ".ts-node");
    // Try common ts-node output locations
    const candidates = [
      path.join(tsNodeDir, scriptPath.replace(projectRoot, "").replace(/\.(ts|tsx|mts|cts)$/, ".js")),
      scriptPath.replace(/\.(ts|tsx|mts|cts)$/, ".js"), // same dir, .js extension
    ];

    for (const candidate of candidates) {
      try {
        const code = fs.readFileSync(candidate, "utf-8");
        const sourceMap = loadSourceMap(candidate, code, projectRoot);
        return { code, resolvedPath: candidate, sourceMap };
      } catch {
        continue;
      }
    }

    // Fallback: try reading the .ts file directly (won't parse with acorn,
    // but let it fail gracefully so processV8CoverageFile skips it)
    const code = fs.readFileSync(scriptPath, "utf-8");
    return { code, resolvedPath: scriptPath, sourceMap: null };
  }

  // For .js files: read directly, check for source maps
  const code = fs.readFileSync(scriptPath, "utf-8");
  const sourceMap = loadSourceMap(scriptPath, code, projectRoot);
  return { code, resolvedPath: scriptPath, sourceMap };
}

/**
 * Process a V8 coverage JSON file using ast-v8-to-istanbul.
 *
 * ast-v8-to-istanbul parses the source AST independently, so it correctly
 * identifies ALL functions/branches even when V8 only reports a subset
 * (e.g., after v8.takeCoverage() reset). Missing functions = uncovered.
 */
export async function processV8CoverageFile(
  v8FilePath: string,
  sourceRoot: string,
  includeAll: boolean = false,
  preParsedData?: V8CoverageData,
): Promise<CoverageResult> {
  // Lazy-loaded: these are only needed when coverage is enabled, which is opt-in.
  // Using require() avoids loading them on every SDK startup (adds ~50ms + memory).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { convert } = require("ast-v8-to-istanbul");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const acorn = require("acorn");
  const data: V8CoverageData = preParsedData ?? JSON.parse(fs.readFileSync(v8FilePath, "utf-8"));
  const coverage: CoverageResult = {};

  for (const script of data.result) {
    const scriptPath = filterScriptUrl(script.url, sourceRoot);
    if (!scriptPath) continue;

    try {
      // Resolve the actual JS code to parse.
      // For TypeScript files (ts-node/tsx), V8's URL points to the .ts file,
      // but the code V8 executed is compiled JS. With TS_NODE_EMIT=true,
      // ts-node writes compiled JS to .ts-node/ directory. We look there first.
      const { code, resolvedPath, sourceMap } = resolveSourceCode(scriptPath, sourceRoot);

      // Try parsing as script first (CJS), fall back to module (ESM).
      // Track which succeeded — CJS modules have a V8 wrapper that shifts byte offsets.
      // For .ts/.tsx files run via --experimental-strip-types, use acorn-typescript
      // plugin since acorn can't parse TypeScript syntax natively.
      let ast;
      let isCJS = false;
      const isTypeScript = /\.(ts|tsx|mts|cts)$/.test(scriptPath);
      const parserOptions: Record<string, unknown> = {
        ecmaVersion: "latest",
        locations: true,
      };

      if (isTypeScript) {
        try {
          const { tsPlugin } = require("acorn-typescript");
          const tsParser = acorn.Parser.extend(tsPlugin());
          try {
            ast = tsParser.parse(code, { ...parserOptions, sourceType: "script" });
            isCJS = true;
          } catch {
            ast = tsParser.parse(code, { ...parserOptions, sourceType: "module" });
          }
        } catch {
          // acorn-typescript not available, fall through to plain acorn
          // (will likely fail for TS files, but the outer try/catch handles that)
          try {
            ast = acorn.parse(code, { ...parserOptions, sourceType: "script" });
            isCJS = true;
          } catch {
            ast = acorn.parse(code, { ...parserOptions, sourceType: "module" });
          }
        }
      } else {
        try {
          ast = acorn.parse(code, { ...parserOptions, sourceType: "script" });
          isCJS = true;
        } catch {
          ast = acorn.parse(code, { ...parserOptions, sourceType: "module" });
        }
      }

      // Strip sourceMappingURL from code passed to convert() — we already loaded
      // and fixed the source map ourselves. Without this, ast-v8-to-istanbul would
      // read the on-disk .map file (with broken sourceRoot) via getInlineSourceMap.
      const codeForConvert = sourceMap
        ? code.replace(/\/\/[#@]\s*sourceMappingURL=.+$/m, "")
        : code;

      // Node.js wraps CJS modules with a function header:
      // (function(exports, require, module, __filename, __dirname) { ... })
      // V8 coverage byte offsets include this wrapper, so we pass wrapperLength
      // to align AST node positions with V8 ranges.
      // Get the actual wrapper length from Node.js rather than hardcoding.
      const cjsWrapperLength = isCJS
        ? require("module").wrapper[0].length
        : 0;
      const istanbulData = await convert({
        code: codeForConvert,
        ast,
        coverage: { functions: script.functions, url: script.url },
        ...(sourceMap ? { sourceMap } : {}),
        ...(cjsWrapperLength ? { wrapperLength: cjsWrapperLength } : {}),
      });

      // When source maps are present, istanbul remaps to original file paths.
      // Use the first key that points to a file under sourceRoot.
      const fileKey = Object.keys(istanbulData).find(
        (k) => k.startsWith(sourceRoot) || !path.isAbsolute(k),
      ) || Object.keys(istanbulData)[0];
      if (!fileKey) continue;
      const fileCov = istanbulData[fileKey];

      // Extract line coverage from Istanbul statement map
      const lines: Record<string, number> = {};
      for (const [stmtId, count] of Object.entries(
        fileCov.s as Record<string, number>,
      )) {
        const stmtMap = fileCov.statementMap[stmtId];
        if (stmtMap) {
          const line = String(stmtMap.start.line);
          lines[line] = Math.max(lines[line] ?? 0, count);
        }
      }

      // Extract branch coverage from Istanbul branch map
      let totalBranches = 0;
      let coveredBranches = 0;
      const branches: Record<string, BranchInfo> = {};

      for (const [branchId, counts] of Object.entries(
        fileCov.b as Record<string, number[]>,
      )) {
        const branchMap = fileCov.branchMap[branchId];
        if (!branchMap) continue;

        const line = branchMap.loc?.start?.line ??
          branchMap.locations?.[0]?.start?.line;
        if (line == null) continue;
        const branchLine = String(line);

        if (!branches[branchLine]) {
          branches[branchLine] = { total: 0, covered: 0 };
        }

        for (const count of counts) {
          totalBranches++;
          branches[branchLine].total++;
          if (count > 0) {
            coveredBranches++;
            branches[branchLine].covered++;
          }
        }
      }

      // Filter based on mode
      if (!includeAll) {
        for (const key of Object.keys(lines)) {
          if (lines[key] === 0) {
            delete lines[key];
          }
        }
      }

      if (Object.keys(lines).length > 0 || includeAll) {
        // Use the original source path (from source map) if available,
        // otherwise use the compiled file path
        // Use original .ts path when source maps remap, otherwise compiled path
        const coveragePath = sourceMap
          ? resolveSourcePath(fileKey, resolvedPath)
          : scriptPath;
        coverage[coveragePath] = {
          lines,
          totalBranches,
          coveredBranches,
          branches,
        };
      }
    } catch {
      continue;
    }
  }

  return coverage;
}

/**
 * Quick-scan a V8 coverage JSON to check if it has user scripts worth processing.
 * Parses the JSON and checks script URLs against the sourceRoot — much cheaper
 * than running ast-v8-to-istanbul on every script.
 *
 * Returns the parsed data if it has user scripts, null otherwise.
 */
function quickScanCoverageFile(
  filePath: string,
  sourceRoot: string,
): V8CoverageData | null {
  try {
    const data: V8CoverageData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const hasUserScripts = data.result.some(
      (script) => filterScriptUrl(script.url, sourceRoot) !== null,
    );
    return hasUserScripts ? data : null;
  } catch {
    return null;
  }
}

/**
 * Take a V8 coverage snapshot: trigger v8.takeCoverage(), process with
 * ast-v8-to-istanbul, and clean up.
 *
 * NODE_V8_COVERAGE is inherited by all child Node processes (npm, tsc, etc.),
 * so the coverage directory may contain files from multiple PIDs. We quick-scan
 * each file to find ones with user scripts and only run the expensive
 * ast-v8-to-istanbul processing on those.
 */
export async function takeAndProcessSnapshot(
  coverageDir: string,
  sourceRoot: string,
  includeAll: boolean,
): Promise<CoverageResult> {
  // Lazy-loaded: v8 module is only needed for coverage snapshots.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const v8 = require("v8");
  v8.takeCoverage();

  const files = fs
    .readdirSync(coverageDir)
    .filter((f: string) => f.startsWith("coverage-") && f.endsWith(".json"))
    .sort();

  const coverage: CoverageResult = {};

  for (const f of files) {
    const fp = path.join(coverageDir, f);

    // Quick-scan: skip files from non-server processes (npm, tsc, etc.)
    const data = quickScanCoverageFile(fp, sourceRoot);
    if (!data) {
      try { fs.unlinkSync(fp); } catch { /* ignore cleanup errors */ }
      continue;
    }

    // Process the file with ast-v8-to-istanbul (expensive) — pass pre-parsed data to avoid double JSON.parse
    const fileCoverage = await processV8CoverageFile(fp, sourceRoot, includeAll, data);

    // Merge into result (handles rare case of same file in multiple V8 outputs)
    for (const [filePath, fileData] of Object.entries(fileCoverage)) {
      if (coverage[filePath]) {
        // Merge line counts (max)
        for (const [line, count] of Object.entries(fileData.lines)) {
          coverage[filePath].lines[line] = Math.max(coverage[filePath].lines[line] ?? 0, count);
        }
        // Merge branch counts
        for (const [line, branchInfo] of Object.entries(fileData.branches || {})) {
          const existing = coverage[filePath].branches[line];
          if (existing) {
            existing.total = Math.max(existing.total, branchInfo.total);
            existing.covered = Math.max(existing.covered, branchInfo.covered);
          } else {
            coverage[filePath].branches[line] = { ...branchInfo };
          }
        }
        // Recompute file-level branch totals
        let totalB = 0, covB = 0;
        for (const b of Object.values(coverage[filePath].branches)) {
          totalB += b.total;
          covB += b.covered;
        }
        coverage[filePath].totalBranches = totalB;
        coverage[filePath].coveredBranches = covB;
      } else {
        coverage[filePath] = fileData;
      }
    }

    try { fs.unlinkSync(fp); } catch { /* ignore cleanup errors */ }
  }

  return coverage;
}

