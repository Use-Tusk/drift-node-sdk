import type { NextConfig } from "next";

/**
 * Options for configuring Tusk Drift's Next.js integration.
 */
export interface TuskDriftNextOptions {
  /**
   * Enable debug logging for Tusk Drift's Next.js integration.
   * When enabled, logs information about configuration changes and version detection.
   *
   * @default false
   */
  debug?: boolean;

  /**
   * Disable automatic setting of `experimental.instrumentationHook`.
   * Use this if you want to manually control the instrumentation hook setting.
   *
   * @default false
   */
  disableInstrumentationHook?: boolean;

  /**
   * Suppress all warnings from Tusk Drift's Next.js integration.
   * Not recommended unless you know what you're doing.
   *
   * @default false
   */
  suppressWarnings?: boolean;
}

/**
 * Type for Next.js config that can be an object or a function returning an object.
 */
export type NextConfigInput =
  | NextConfig
  | ((phase: string, context: any) => NextConfig | Promise<NextConfig>);

/**
 * Parsed semantic version information.
 */
export interface ParsedVersion {
  major: number | undefined;
  minor: number | undefined;
  patch: number | undefined;
  prerelease: string | undefined;
}
