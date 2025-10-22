import * as fs from "fs";
import * as path from "path";
import { parse as parseSemver } from "semver";
import type { ParsedVersion } from "./types";

/**
 * Get the installed Next.js version by reading package.json from node_modules.
 *
 * @returns The Next.js version string, or undefined if not found
 */
export function getNextjsVersion(): string | undefined {
  try {
    // Try to read from node_modules/next/package.json
    const nextPackageJsonPath = path.join(process.cwd(), "node_modules", "next", "package.json");

    if (fs.existsSync(nextPackageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(nextPackageJsonPath, "utf-8"));
      return packageJson.version;
    }
  } catch (error) {
    // Silent failure - we'll warn the user in the main function
  }

  return undefined;
}

/**
 * Parse a semantic version string into its components.
 *
 * @param version - The version string to parse (e.g., "15.0.0-canary.124")
 * @returns Parsed version object with major, minor, patch, and prerelease
 */
export function parseVersion(version: string): ParsedVersion {
  try {
    const parsed = parseSemver(version);

    if (!parsed) {
      return {
        major: undefined,
        minor: undefined,
        patch: undefined,
        prerelease: undefined,
      };
    }

    return {
      major: parsed.major,
      minor: parsed.minor,
      patch: parsed.patch,
      prerelease: parsed.prerelease.length > 0 ? parsed.prerelease.join(".") : undefined,
    };
  } catch {
    return {
      major: undefined,
      minor: undefined,
      patch: undefined,
      prerelease: undefined,
    };
  }
}

/**
 * Check if the Next.js version requires the instrumentationHook to be set.
 * From Next.js 15.0.0-rc.1 onwards, the instrumentationHook is no longer needed
 * and Next.js will warn if it's set.
 *
 * @param version - The Next.js version string
 * @returns true if instrumentationHook should be set, false otherwise
 */
export function shouldSetInstrumentationHook(version: string | undefined): boolean {
  if (!version) {
    // If we can't detect the version, err on the side of setting it
    // (better to have a warning than broken instrumentation)
    return true;
  }

  const { major, minor, patch, prerelease } = parseVersion(version);

  // Unable to parse version
  if (major === undefined || minor === undefined || patch === undefined) {
    return true;
  }

  // Next.js 16+ definitely doesn't need it
  if (major >= 16) {
    return false;
  }

  // Next.js 14 and below need it
  if (major < 15) {
    return true;
  }

  // Next.js 15.x.x - check specific versions
  if (major === 15) {
    // 15.0.0 stable and higher don't need it
    if (minor > 0 || patch > 0) {
      return false;
    }

    // Check if it's 15.0.0 with no prerelease (stable)
    if (minor === 0 && patch === 0 && prerelease === undefined) {
      return false;
    }

    // Check for RC versions (rc.1 and higher don't need it)
    if (prerelease?.startsWith("rc.")) {
      const rcNumber = parseInt(prerelease.split(".")[1] || "0", 10);
      if (rcNumber >= 1) {
        return false;
      }
    }

    // Check for canary versions (canary.124 and higher don't need it)
    if (prerelease?.startsWith("canary.")) {
      const canaryNumber = parseInt(prerelease.split(".")[1] || "0", 10);
      if (canaryNumber >= 124) {
        return false;
      }
    }

    // All other 15.0.0 prereleases need it
    return true;
  }

  // Default to true for safety
  return true;
}

/**
 * Log a message if debug mode is enabled.
 *
 * @param debug - Whether debug mode is enabled
 * @param message - The message to log
 */
export function debugLog(debug: boolean, message: string): void {
  if (debug) {
    // eslint-disable-next-line no-console
    console.log(`[Tusk Drift] ${message}`);
  }
}

/**
 * Log a warning message if warnings are not suppressed.
 *
 * @param suppress - Whether to suppress the warning
 * @param message - The warning message to log
 */
export function warn(suppress: boolean, message: string): void {
  if (!suppress) {
    // eslint-disable-next-line no-console
    console.warn(`[Tusk Drift] ${message}`);
  }
}
