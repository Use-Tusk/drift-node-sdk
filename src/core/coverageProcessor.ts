/**
 * V8 coverage data processing using v8-to-istanbul.
 *
 * Converts raw V8 coverage JSON into per-file coverage data with accurate
 * line, branch, and function coverage. v8-to-istanbul handles:
 * - V8 nested range resolution (innermost range wins)
 * - Implicit branch detection (taken paths that V8 doesn't create ranges for)
 * - Source map support for TypeScript
 * - Istanbul format conversion (statementMap, branchMap, fnMap)
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

/** V8 coverage types (for type safety) */
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
 * Process a V8 coverage JSON file using v8-to-istanbul for accurate
 * line, branch, and function coverage.
 *
 * @param v8FilePath - Path to the V8 coverage JSON file
 * @param sourceRoot - Project root (files outside this are excluded)
 * @param includeAll - If true, includes uncovered lines/branches (for baseline)
 */
export async function processV8CoverageFile(
  v8FilePath: string,
  sourceRoot: string,
  includeAll: boolean = false,
): Promise<CoverageResult> {
  const v8toIstanbul = require("v8-to-istanbul");
  const data: V8CoverageData = JSON.parse(fs.readFileSync(v8FilePath, "utf-8"));
  const coverage: CoverageResult = {};

  for (const script of data.result) {
    const scriptPath = filterScriptUrl(script.url, sourceRoot);
    if (!scriptPath) continue;

    try {
      // v8-to-istanbul converts V8 ranges to Istanbul format
      // It handles: nested ranges, implicit branches, source maps
      const converter = v8toIstanbul(scriptPath);
      await converter.load();
      converter.applyCoverage(script.functions);
      const istanbulData = converter.toIstanbul();

      // Istanbul output is keyed by file path
      const fileKey = Object.keys(istanbulData)[0];
      if (!fileKey) continue;

      const fileCov = istanbulData[fileKey];

      // Extract line coverage from Istanbul's statement map
      const lines: Record<string, number> = {};
      for (const [stmtId, count] of Object.entries(fileCov.s as Record<string, number>)) {
        const stmtMap = fileCov.statementMap[stmtId];
        if (stmtMap) {
          const line = String(stmtMap.start.line);
          // Use max count if multiple statements on same line
          lines[line] = Math.max(lines[line] || 0, count);
        }
      }

      // Extract branch coverage from Istanbul's branch map
      let totalBranches = 0;
      let coveredBranches = 0;
      const branches: Record<string, BranchInfo> = {};

      for (const [branchId, counts] of Object.entries(fileCov.b as Record<string, number[]>)) {
        const branchMap = fileCov.branchMap[branchId];
        if (!branchMap) continue;

        const branchLine = String(branchMap.loc?.start?.line || branchMap.locations?.[0]?.start?.line);

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
        coverage[scriptPath] = {
          lines,
          totalBranches,
          coveredBranches,
          branches,
        };
      }
    } catch {
      // If v8-to-istanbul fails for a file, skip it
      continue;
    }
  }

  return coverage;
}

/**
 * Take a V8 coverage snapshot: trigger v8.takeCoverage(), process with
 * v8-to-istanbul, and clean up.
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

    // Clean up V8 files
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

// --- Legacy exports for backward compatibility with tests ---

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

/**
 * Simple script coverage processing (without v8-to-istanbul).
 * Kept for unit tests and as fallback.
 */
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
      if (lines[key] === 0) {
        delete lines[key];
      }
    }
  }

  return { lines, totalBranches, coveredBranches, branches };
}
