import type { NextConfig } from "next";

export function withTuskDrift(nextConfig: NextConfig = {}) {
  return {
    ...nextConfig,
    experimental: {
      ...nextConfig.experimental,
      instrumentationHook: true,
      serverComponentsExternalPackages: ["@use-tusk/drift-node-sdk"],
    },
    webpack: (config: any, options: any) => {
      if (options.isServer) {
        // Add your externals first
        config.externals.push(
          "@use-tusk/drift-node-sdk",
          "require-in-the-middle",
          "jsonpath",
          "import-in-the-middle",
        );
      }

      // Call user's webpack function if they provided one
      if (typeof nextConfig.webpack === "function") {
        return nextConfig.webpack(config, options);
      }

      return config;
    },
  };
}

export { TuskDrift } from "./core/TuskDrift";
