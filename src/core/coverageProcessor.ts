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
  const filePath = url.replace("file://", "");
  if (filePath.includes("node_modules")) return null;
  if (!filePath.startsWith(sourceRoot)) return null;
  return filePath;
}

/**
 * Load a source map for a compiled file, if available.
 * Checks for //# sourceMappingURL= comment and loads the .map file.
 */
function loadSourceMap(
  filePath: string,
  code: string,
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
  sourceRoot: string,
): string {
  if (path.isAbsolute(istanbulKey)) return istanbulKey;
  // Resolve relative to the compiled file's directory
  const resolved = path.resolve(path.dirname(compiledPath), istanbulKey);
  if (resolved.startsWith(sourceRoot)) return resolved;
  return resolved;
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
): Promise<CoverageResult> {
  const { convert } = require("ast-v8-to-istanbul");
  const acorn = require("acorn");
  const data: V8CoverageData = JSON.parse(fs.readFileSync(v8FilePath, "utf-8"));
  const coverage: CoverageResult = {};

  for (const script of data.result) {
    const scriptPath = filterScriptUrl(script.url, sourceRoot);
    if (!scriptPath) continue;

    try {
      const code = fs.readFileSync(scriptPath, "utf-8");
      const ast = acorn.parse(code, {
        ecmaVersion: 2022,
        sourceType: "module",
        locations: true,
      });

      // Check for source map (TypeScript, bundled code, etc.)
      const sourceMap = loadSourceMap(scriptPath, code);

      const istanbulData = await convert({
        code,
        ast,
        coverage: { functions: script.functions, url: script.url },
        ...(sourceMap ? { sourceMap } : {}),
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
          lines[line] = Math.max(lines[line] || 0, count);
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

        const branchLine = String(
          branchMap.loc?.start?.line ||
            branchMap.locations?.[0]?.start?.line,
        );

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
        const coveragePath = sourceMap ? resolveSourcePath(fileKey, scriptPath, sourceRoot) : scriptPath;
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
 * Take a V8 coverage snapshot: trigger v8.takeCoverage(), process with
 * ast-v8-to-istanbul, and clean up.
 */
export async function takeAndProcessSnapshot(
  coverageDir: string,
  sourceRoot: string,
  includeAll: boolean,
): Promise<CoverageResult> {
  const v8 = require("v8");
  v8.takeCoverage();

  const files = fs
    .readdirSync(coverageDir)
    .filter((f: string) => f.startsWith("coverage-") && f.endsWith(".json"))
    .sort();

  let coverage: CoverageResult = {};
  if (files.length > 0) {
    const latestFile = path.join(coverageDir, files[files.length - 1]);
    coverage = await processV8CoverageFile(latestFile, sourceRoot, includeAll);

    for (const f of files) {
      try {
        fs.unlinkSync(path.join(coverageDir, f));
      } catch {
        // ignore cleanup errors
      }
    }
  }

  return coverage;
}

// --- Legacy exports for unit tests ---

export function computeLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

export function offsetToLine(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

export function processScriptCoverage(
  functions: V8FunctionCoverage[],
  lineStarts: number[],
  includeAll: boolean,
): FileCoverageData {
  const lines: Record<string, number> = {};
  const branches: Record<string, BranchInfo> = {};
  let totalBranches = 0;
  let coveredBranches = 0;

  for (const func of functions) {
    for (const range of func.ranges) {
      const startLine = offsetToLine(lineStarts, range.startOffset);
      const endLine = offsetToLine(lineStarts, range.endOffset);
      for (let line = startLine; line <= endLine; line++) {
        lines[String(line)] = range.count;
      }
    }
    if (func.isBlockCoverage && func.ranges.length > 1) {
      for (let i = 1; i < func.ranges.length; i++) {
        const range = func.ranges[i];
        const branchLine = String(offsetToLine(lineStarts, range.startOffset));
        if (!branches[branchLine]) {
          branches[branchLine] = { total: 0, covered: 0 };
        }
        branches[branchLine].total++;
        totalBranches++;
        if (range.count > 0) {
          branches[branchLine].covered++;
          coveredBranches++;
        }
      }
    }
  }

  if (!includeAll) {
    for (const key of Object.keys(lines)) {
      if (lines[key] === 0) delete lines[key];
    }
  }

  return { lines, totalBranches, coveredBranches, branches };
}
