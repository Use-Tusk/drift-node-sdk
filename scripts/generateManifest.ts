/**
 * Generates instrumentation-manifest.json by parsing instrumentation source files
 * using the TypeScript AST (no code execution).
 *
 * This avoids importing instrumentation modules (which can introduce circular deps
 * and runtime side effects).
 * 
 * ## How it works (high level)
 *
 * - Scans `src/instrumentation/libraries/<library>/Instrumentation.ts` (excluding internal-only dirs).
 * - Parses each file with the TypeScript compiler API and finds `new TdInstrumentationNodeModule({ ... })`.
 * - Extracts `name` + `supportedVersions` from the object literal.
 *   - Supports string literals / no-substitution template literals.
 *   - Supports top-level `const` identifier references (e.g. `SUPPORTED_VERSIONS`).
 * - Normalizes names (e.g. `next/dist/server/base-server` → `next`) and filters internal submodule paths.
 * - Merges duplicate package entries by unioning `supportedVersions`.
 *
 * ## Maintainer notes (adding new instrumentations)
 *
 * - Keep `name` and `supportedVersions` **statically analyzable**.
 *   - Good: `name: "pkg"`, `supportedVersions: ["1.*", "2.*"]`,
 *     `const SUPPORTED = ["1.*"]; supportedVersions: SUPPORTED`
 *   - Avoid: computed expressions, function calls, concatenation, template literals with `${...}`, etc.
 * - Ensure the library folder has an `Instrumentation.ts`; that’s what this script scans.
 * - If an instrumentation patches a **global** and doesn’t create a `TdInstrumentationNodeModule`,
 *   add it to `GLOBAL_INSTRUMENTATIONS`.
 * - If you intentionally patch internal paths (e.g. `pkg/subpath/file.js`), those are filtered out
 *   unless mapped in `getPublicPackageName()` (like Next.js). Add mappings there as needed.
 * - If you introduce new patterns for `supportedVersions`, update the evaluator in this script.
 *
 * ## Why source parsing instead of imports?
 *
 * The SDK has a circular dependency that prevents direct imports:
 *
 *   PgInstrumentation
 *     → imports TuskDriftCore from "core/TuskDrift.ts"
 *       → TuskDrift.ts imports from "../instrumentation/libraries" (barrel)
 *         → barrel exports ALL instrumentations
 *           → ERROR: Cannot access 'TdInstrumentationBase' before initialization
 *
 * This cycle is resolved by the bundler (tsdown) in the published package,
 * but fails when importing unbundled source files via tsx/ts-node.
 *
 * Run: npx tsx scripts/generateManifest.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json for version
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../package.json"), "utf-8"),
);

interface InstrumentationEntry {
  packageName: string;
  supportedVersions: string[];
}

interface InstrumentationManifest {
  sdkVersion: string;
  language: "node";
  generatedAt: string;
  instrumentations: InstrumentationEntry[];
}

const LIBRARIES_DIR = path.join(__dirname, "../src/instrumentation/libraries");

/**
 * Internal instrumentations that shouldn't be in the public manifest.
 * These patch Node.js built-ins or globals for internal SDK purposes.
 */
const INTERNAL_INSTRUMENTATIONS = new Set(["date", "tcp"]);

/**
 * Instrumentations that patch globals and don't return modules from init().
 * These need to be added manually to the manifest.
 */
const GLOBAL_INSTRUMENTATIONS: InstrumentationEntry[] = [
  // Fetch is patched as a global, not a module
  // Supported in all Node.js versions with native fetch (18+)
  { packageName: "fetch", supportedVersions: ["*"] },
];

/**
 * Check if a package name is an internal path (submodule file).
 */
function isInternalPath(packageName: string): boolean {
  // Scoped packages with paths like @google-cloud/firestore/build/... are internal
  if (packageName.startsWith("@") && packageName.split("/").length > 2) {
    return true;
  }
  // Unscoped packages with paths like graphql/execution/execute.js are internal
  if (!packageName.startsWith("@") && packageName.includes("/")) {
    return true;
  }
  return false;
}

/**
 * Map internal paths to public package names.
 */
function getPublicPackageName(packageName: string): string {
  // next/dist/server/base-server -> next
  if (packageName.startsWith("next/")) {
    return "next";
  }
  return packageName;
}

/**
 * Discover all Instrumentation.ts files in the libraries directory.
 */
function discoverInstrumentationFiles(): string[] {
  const files: string[] = [];

  const entries = fs.readdirSync(LIBRARIES_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !INTERNAL_INSTRUMENTATIONS.has(entry.name)) {
      const instrumentationFile = path.join(
        LIBRARIES_DIR,
        entry.name,
        "Instrumentation.ts",
      );
      if (fs.existsSync(instrumentationFile)) {
        files.push(instrumentationFile);
      }
    }
  }

  return files;
}

function unwrapExpression(expr: ts.Expression): ts.Expression {
  let current: ts.Expression = expr;
  // Unwrap common TS wrappers that appear around constant values
  while (true) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }
    break;
  }
  return current;
}

type ConstTable = Map<string, ts.Expression>;

function buildTopLevelConstTable(sourceFile: ts.SourceFile): ConstTable {
  const consts: ConstTable = new Map();

  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;

    const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
    if (!isConst) continue;

    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      if (!decl.initializer) continue;
      consts.set(decl.name.text, decl.initializer);
    }
  }

  return consts;
}

function evalString(
  expr: ts.Expression,
  consts: ConstTable,
  depth = 0,
): string | null {
  if (depth > 25) return null;
  const e = unwrapExpression(expr);

  if (ts.isStringLiteral(e)) return e.text;
  if (ts.isNoSubstitutionTemplateLiteral(e)) return e.text;

  if (ts.isIdentifier(e)) {
    const init = consts.get(e.text);
    if (!init) return null;
    return evalString(init, consts, depth + 1);
  }

  return null;
}

function evalStringArray(
  expr: ts.Expression,
  consts: ConstTable,
  depth = 0,
): string[] | null {
  if (depth > 25) return null;
  const e = unwrapExpression(expr);

  if (ts.isArrayLiteralExpression(e)) {
    const out: string[] = [];
    for (const el of e.elements) {
      if (ts.isOmittedExpression(el)) return null;
      const s = evalString(el as ts.Expression, consts, depth + 1);
      if (s == null) return null;
      out.push(s);
    }
    return out;
  }

  if (ts.isIdentifier(e)) {
    const init = consts.get(e.text);
    if (!init) return null;
    return evalStringArray(init, consts, depth + 1);
  }

  // Fallback: sometimes a single string is used; normalize to [string]
  const s = evalString(e, consts, depth + 1);
  if (s != null) return [s];

  return null;
}

function getObjectPropInitializer(
  obj: ts.ObjectLiteralExpression,
  propName: string,
): ts.Expression | null {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;

    const nameNode = prop.name;
    const name =
      ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode)
        ? nameNode.text
        : null;

    if (name === propName) return prop.initializer;
  }
  return null;
}

/**
 * Parse a TypeScript file and extract TdInstrumentationNodeModule definitions.
 */
function parseInstrumentationFile(filePath: string): InstrumentationEntry[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const consts = buildTopLevelConstTable(sourceFile);
  const entries: InstrumentationEntry[] = [];

  function visit(node: ts.Node) {
    if (ts.isNewExpression(node)) {
      const callee = node.expression;
      const isTd =
        ts.isIdentifier(callee) && callee.text === "TdInstrumentationNodeModule";

      if (isTd) {
        const arg0 = node.arguments?.[0];
        if (arg0 && ts.isObjectLiteralExpression(arg0)) {
          const nameInit = getObjectPropInitializer(arg0, "name");
          const supportedInit = getObjectPropInitializer(arg0, "supportedVersions");

          const rawName = nameInit ? evalString(nameInit, consts) : null;
          if (rawName) {
            let packageName = getPublicPackageName(rawName);
            if (!isInternalPath(packageName)) {
              const supportedVersions =
                (supportedInit ? evalStringArray(supportedInit, consts) : null) ?? ["*"];
              entries.push({ packageName, supportedVersions });
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return entries;
}

/**
 * Merge entries with the same package name, combining their supported versions.
 */
function mergeEntries(entries: InstrumentationEntry[]): InstrumentationEntry[] {
  const merged = new Map<string, Set<string>>();

  for (const entry of entries) {
    if (!merged.has(entry.packageName)) {
      merged.set(entry.packageName, new Set());
    }
    for (const version of entry.supportedVersions) {
      merged.get(entry.packageName)!.add(version);
    }
  }

  return Array.from(merged.entries()).map(([packageName, versions]) => ({
    packageName,
    supportedVersions: Array.from(versions).sort(),
  }));
}

function main() {
  console.log("Discovering instrumentation files...");
  const files = discoverInstrumentationFiles();
  console.log(`Found ${files.length} instrumentation files (excluding internal)`);

  const allEntries: InstrumentationEntry[] = [...GLOBAL_INSTRUMENTATIONS];

  for (const file of files) {
    const relativePath = path.relative(LIBRARIES_DIR, file);
    const entries = parseInstrumentationFile(file);

    if (entries.length === 0) {
      // Expected for global instrumentations (fetch)
      const dirName = path.dirname(relativePath);
      if (!["fetch"].includes(dirName)) {
        console.warn(`  Warning: No modules found in ${relativePath}`);
      }
    } else {
      console.log(
        `  ${relativePath}: ${entries
          .map((e) => `${e.packageName}@${e.supportedVersions.join(",")}`)
          .join(", ")}`,
      );
      allEntries.push(...entries);
    }
  }

  const mergedEntries = mergeEntries(allEntries);
  mergedEntries.sort((a, b) => a.packageName.localeCompare(b.packageName));

  const manifest: InstrumentationManifest = {
    sdkVersion: packageJson.version,
    language: "node",
    generatedAt: new Date().toISOString(),
    instrumentations: mergedEntries,
  };

  const distDir = path.join(__dirname, "../dist");
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const outputPath = path.join(distDir, "instrumentation-manifest.json");
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`\nGenerated ${outputPath}`);
  console.log(`SDK version: ${manifest.sdkVersion}`);
  console.log(`Instrumentations: ${manifest.instrumentations.length}`);
  for (const entry of manifest.instrumentations) {
    console.log(`  - ${entry.packageName}: ${entry.supportedVersions.join(", ")}`);
  }
}

main();


