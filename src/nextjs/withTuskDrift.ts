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

        // Check if we're in RECORD or REPLAY mode
        const mode = process.env.TUSK_DRIFT_MODE?.toUpperCase();
        const isRecordOrReplay = mode === "RECORD" || mode === "REPLAY";

        // Core packages that must be external for instrumentation
        //
        // Why these packages need to be external:
        //
        // 1. require-in-the-middle & jsonpath:
        //    Required for the instrumentation infrastructure itself.
        //
        // 2. Others:
        //    By default, Next.js webpack bundles other packages into the server bundle at build time.
        //    Once bundled, there's no runtime require() call for require-in-the-middle to intercept.
        //    The instrumentation's patch callback never executes because module loading has already
        //    happened during the webpack build process, not at runtime.
        //
        //    By adding it to webpack externals, we tell webpack to exclude these packages from bundling.
        //    Instead, webpack leaves these packages as a runtime require() call. When the Next.js server starts,
        //    require-in-the-middle intercepts these runtime require() calls, triggers our instrumentation's
        //    patch callback, and successfully returns the wrapped moduleExports with the instrumented class.

        //    Next.js externalizes some packages by default, see: https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages
        //    Others we need to add ourselves.

        // Note: Other packages are only added when TUSK_DRIFT_MODE is RECORD or REPLAY
        const coreExternals = [
          "require-in-the-middle",
          "jsonpath",
          ...(isRecordOrReplay
            ? [
                "@upstash/redis",
                "ioredis",
                "pg",
                "postgres",
                "mysql2",
                "@prisma/client",
                "@google-cloud/firestore",
                "@grpc/grpc-js",
                "graphql",
                "jsonwebtoken",
                "jwks-rsa",
              ]
            : []),
        ];

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
