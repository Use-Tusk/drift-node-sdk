/**
 * Helper functions for capturing stack traces in replay mode
 *
 * TODO: Consider using a structured format for stack frames:
 *
 * {
 *   "frames": [
 *     {
 *       "fileName": "file.js",
 *       "lineNumber": 10,
 *       "columnNumber": 20,
 *       "functionName": "functionName"
 *     }
 *   ]
 * }
 *
 * This would allow for more efficient matching and filtering of stack frames.
 * It would also allow for more accurate stack trace reconstruction in replay mode.
 */

/**
 *
 * @param excludeClassNames - Class names to exclude from the stack trace
 * @returns The stack trace as a string
 */
export function captureStackTrace(excludeClassNames: string[] = []): string {
  const originalStackTraceLimit = Error.stackTraceLimit; // Default is 10

  Error.stackTraceLimit = 100;
  const s = new Error().stack || "";
  Error.stackTraceLimit = originalStackTraceLimit;

  const defaultExcludes = [
    "drift-node-sdk/src/instrumentation",
    "drift-node-sdk/src/core",
    "node_modules/@use-tusk",
  ];

  const allExcludes = [...defaultExcludes, ...excludeClassNames];

  return s
    .split("\n")
    .slice(2) // Skip "Error" and capture method lines
    .filter((l) => !allExcludes.some((exclude) => l.includes(exclude)))
    .join("\n");
}
