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

        if (!originalExternals) {
          // No externals defined, create a new array
          webpackConfig.externals = coreExternals;
          debugLog(debug, "Created new externals array with core packages");
        } else if (Array.isArray(originalExternals)) {
          // Externals is already an array, add our packages if not present
          for (const pkg of coreExternals) {
            if (!originalExternals.includes(pkg)) {
              originalExternals.push(pkg);
              debugLog(debug, `Added ${pkg} to webpack externals`);
            }
          }
        } else {
          // Externals is a function or other type, wrap it in an array with our packages
          webpackConfig.externals = [originalExternals, ...coreExternals];
          debugLog(debug, "Wrapped existing externals with core packages");
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
