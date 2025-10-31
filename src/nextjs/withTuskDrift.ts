import type { NextConfig } from "next";
import type { TuskDriftNextOptions } from "./types";
import { getNextjsVersion, shouldSetInstrumentationHook, debugLog, warn } from "./utils";

/**
 * Wraps your Next.js configuration with Tusk Drift instrumentation setup.
 *
 * This function automatically configures Next.js to work with Tusk Drift by:
 * - Enabling the Next.js instrumentation hook (for Next.js < 15.0.0-rc.1)
 * - Configuring webpack externals to prevent bundling of core instrumentation packages
 * - Preserving your existing Next.js configuration and webpack customizations
 *
 * @param nextConfig - Your existing Next.js configuration object (optional)
 * @param options - Additional options to configure Tusk Drift's behavior (optional)
 * @returns The wrapped Next.js configuration with Tusk Drift instrumentation enabled
 *
 * @example
 * Basic usage:
 * ```javascript
 * // next.config.js
 * const { withTuskDrift } = require('@use-tusk/drift-node-sdk');
 *
 * module.exports = withTuskDrift({
 *   // Your Next.js config
 * });
 * ```
 *
 * @example
 * With debug logging:
 * ```javascript
 * // next.config.js
 * const { withTuskDrift } = require('@use-tusk/drift-node-sdk');
 *
 * module.exports = withTuskDrift(
 *   {
 *     // Your Next.js config
 *   },
 *   {
 *     debug: true,
 *   }
 * );
 * ```
 *
 * @remarks
 * The following webpack externals are added for server-side builds:
 * - `require-in-the-middle` - Required for CommonJS module interception
 * - `jsonpath` - Required for schema manipulation
 */
export function withTuskDrift(
  nextConfig: NextConfig = {},
  options: TuskDriftNextOptions = {},
): NextConfig {
  const config = nextConfig;

  const debug = options.debug || false;
  const suppressAllWarnings = options.suppressWarnings || false;

  // Detect Next.js version
  const nextjsVersion = getNextjsVersion();

  if (nextjsVersion) {
    debugLog(debug, `Detected Next.js version: ${nextjsVersion}`);
  } else {
    warn(
      suppressAllWarnings || false,
      "Could not detect Next.js version. Some features may not work correctly. " +
        "If you encounter issues, please ensure Next.js is properly installed.",
    );
  }

  // Determine if we should set instrumentationHook
  const needsInstrumentationHook =
    !options.disableInstrumentationHook && shouldSetInstrumentationHook(nextjsVersion);

  const wrappedConfig: NextConfig = {
    ...config,
    ...(needsInstrumentationHook
      ? {
          experimental: {
            ...config.experimental,
            instrumentationHook: true,
          } as any, // Type assertion for experimental features
        }
      : {
          experimental: config.experimental,
        }),
    webpack: (webpackConfig: any, webpackOptions: any) => {
      if (webpackOptions.isServer) {
        // Safely handle different externals formats (array, function, object, or undefined)
        const originalExternals = webpackConfig.externals;

        // Core packages that must be external for instrumentation
        const coreExternals = ["require-in-the-middle", "jsonpath"];

        // Create externals mapping - since SDK's node_modules aren't published,
        // we rely on these packages being available in the consumer's node_modules
        const externalsMapping: Record<string, string> = {};
        for (const pkg of coreExternals) {
          externalsMapping[pkg] = `commonjs ${pkg}`;
          debugLog(debug, `Mapped external ${pkg} -> commonjs ${pkg}`);
        }

        // Add our externals mapping
        if (!originalExternals) {
          webpackConfig.externals = [externalsMapping];
          debugLog(debug, "Created new externals with SDK paths");
        } else if (Array.isArray(originalExternals)) {
          originalExternals.push(externalsMapping);
          debugLog(debug, "Added SDK paths to existing externals array");
        } else {
          webpackConfig.externals = [originalExternals, externalsMapping];
          debugLog(debug, "Wrapped existing externals with SDK paths");
        }
      }

      // Call user's webpack function if they provided one
      if (typeof config.webpack === "function") {
        return config.webpack(webpackConfig, webpackOptions);
      }

      return webpackConfig;
    },
  };

  if (needsInstrumentationHook) {
    debugLog(debug, "Set experimental.instrumentationHook to true");
  } else {
    debugLog(
      debug,
      "Skipped setting experimental.instrumentationHook (not needed for Next.js 15.0.0-rc.1+)",
    );
  }

  // Warn if user explicitly disabled instrumentationHook but we need it
  if (
    options.disableInstrumentationHook &&
    nextjsVersion &&
    shouldSetInstrumentationHook(nextjsVersion)
  ) {
    warn(
      suppressAllWarnings || false,
      "You disabled instrumentationHook, but your Next.js version requires it. " +
        "Tusk Drift may not initialize properly. Please remove the disableInstrumentationHook option.",
    );
  }

  return wrappedConfig;
}
