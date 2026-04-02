/**
 * V8 coverage data processing.
 *
 * Converts raw V8 coverage JSON (byte-offset ranges with counts)
 * into per-file line-level coverage data.
 *
 * Key concept: V8 block coverage uses nested ranges. The first range in each
 * function covers the entire function body. Inner ranges refine counts for
 * branches/blocks. The INNERMOST range for any byte position gives the accurate
 * count. We process ranges in order (outermost first, V8's default) and let
 * later (more specific) ranges overwrite earlier ones.
 */

import fs from "fs";
import path from "path";

/** A single V8 coverage range within a function. */
export interface V8CoverageRange {
  startOffset: number;
  endOffset: number;
  count: number;
}

/** A function's coverage data in V8 format. */
export interface V8FunctionCoverage {
  functionName?: string;
  ranges: V8CoverageRange[];
  isBlockCoverage?: boolean;
}

/** A script's coverage data in V8 format. */
export interface V8ScriptCoverage {
  scriptId?: string;
  url: string;
  functions: V8FunctionCoverage[];
}

/** The top-level V8 coverage JSON structure. */
export interface V8CoverageData {
  result: V8ScriptCoverage[];
}

/** Branch info for a single line: { total branches, covered branches } */
export interface BranchInfo {
  total: number;
  covered: number;
}

/** Per-file coverage data including lines and branches. */
export interface FileCoverageData {
  lines: Record<string, number>; // lineNumber -> hitCount
  totalBranches: number;
  coveredBranches: number;
  branches: Record<string, BranchInfo>; // lineNumber -> branch detail
}

/** Coverage for all files: { filePath: FileCoverageData } */
export type CoverageResult = Record<string, FileCoverageData>;

/**
 * Compute line-start byte offsets for a source file.
 * Returns an array where index i = byte offset where line i+1 starts.
 */
export function computeLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * Convert a byte offset to a 1-based line number using binary search.
 */
export function offsetToLine(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1; // 1-based
}

/**
 * Process a single script's V8 coverage into line-level counts.
 *
 * Ranges are processed in order (outermost first). Inner ranges overwrite
 * outer ones, so each line ends up with the innermost range's count.
 * This correctly handles:
 * - Uncalled catch blocks (inner count=0 inside called function count=1)
 * - Untaken if/else branches
 * - Partially executed loops
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
    // Process line coverage: innermost range wins
    for (const range of func.ranges) {
      const startLine = offsetToLine(lineStarts, range.startOffset);
      const endLine = offsetToLine(lineStarts, range.endOffset);
      for (let line = startLine; line <= endLine; line++) {
        lines[String(line)] = range.count;
      }
    }

    // Extract branch data: inner ranges (index > 0) within block coverage
    // functions represent branch points. The first range is the whole function;
    // subsequent ranges are branches/blocks within it.
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
    // Also filter branch data for uncovered-only branches in per-test mode
    // Keep all branches though - even showing "0/2 branches" is useful per-test
  }

  return { lines, totalBranches, coveredBranches, branches };
}

/**
 * Filter a script URL to determine if it's a user source file.
 * Returns the local file path if it's a user file, null otherwise.
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
 * Process a V8 coverage JSON file into per-file line counts.
 *
 * @param v8FilePath - Path to the V8 coverage JSON file
 * @param sourceRoot - Project root (files outside this are excluded)
 * @param includeAll - If true, includes lines with count=0 (for baseline/denominator)
 * @param readFileSync - File reader (injectable for testing)
 * @returns Per-file line counts
 */
export function processV8CoverageFile(
  v8FilePath: string,
  sourceRoot: string,
  includeAll: boolean = false,
  readFileSync: (path: string, encoding: string) => string = (p, e) =>
    fs.readFileSync(p, e as BufferEncoding) as unknown as string,
): CoverageResult {
  const data: V8CoverageData = JSON.parse(readFileSync(v8FilePath, "utf-8"));
  const coverage: CoverageResult = {};
  const lineStartsCache = new Map<string, number[]>();

  for (const script of data.result) {
    const scriptPath = filterScriptUrl(script.url, sourceRoot);
    if (!scriptPath) continue;

    // Get or compute line starts for this source file
    let lineStarts = lineStartsCache.get(scriptPath);
    if (!lineStarts) {
      try {
        const source = readFileSync(scriptPath, "utf-8");
        lineStarts = computeLineStarts(source);
        lineStartsCache.set(scriptPath, lineStarts);
      } catch {
        continue;
      }
    }

    const fileData = processScriptCoverage(script.functions, lineStarts, includeAll);

    if (Object.keys(fileData.lines).length > 0) {
      coverage[scriptPath] = fileData;
    }
  }

  return coverage;
}

/**
 * Take a V8 coverage snapshot: trigger v8.takeCoverage(), read the latest file,
 * process it, and clean up.
 *
 * @param coverageDir - NODE_V8_COVERAGE directory
 * @param sourceRoot - Project root for filtering
 * @param includeAll - Whether to include uncovered lines (baseline mode)
 * @returns Processed coverage data
 */
export function takeAndProcessSnapshot(
  coverageDir: string,
  sourceRoot: string,
  includeAll: boolean,
): CoverageResult {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const v8 = require("v8");
  v8.takeCoverage();

  const files = fs
    .readdirSync(coverageDir)
    .filter((f: string) => f.startsWith("coverage-") && f.endsWith(".json"))
    .sort();

  let coverage: CoverageResult = {};
  if (files.length > 0) {
    const latestFile = path.join(coverageDir, files[files.length - 1]);
    coverage = processV8CoverageFile(latestFile, sourceRoot, includeAll);

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
