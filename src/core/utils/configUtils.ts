import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { logger } from "./logger";
import { TransformConfigs } from "src/instrumentation/libraries/types";

export interface TuskConfig {
  service?: {
    id?: string;
    name?: string;
    port?: number;
    start?: {
      command?: string;
    };
    readiness_check?: {
      command?: string;
      timeout?: string;
      interval?: string;
    };
  };
  traces?: {
    dir?: string;
  };
  tusk_api?: {
    url?: string;
  };
  test_execution?: {
    concurrency?: number;
    timeout?: string;
  };
  comparison?: {
    ignore_fields?: string[];
  };
  recording?: {
    sampling_rate?: number;
    export_spans?: boolean;
    enable_env_var_recording?: boolean;
    enable_analytics?: boolean;
    exclude_paths?: string[];
  };
  transforms?: TransformConfigs;
}

/**
 * Find project root by traversing up from the current working directory
 * or from the SDK's installation location in node_modules
 */
function findProjectRoot(): string | null {
  let currentDir = process.cwd();

  // If we're running from node_modules, traverse up to find the project root
  if (currentDir.includes("node_modules")) {
    // Find the node_modules directory and go up one level
    const nodeModulesIndex = currentDir.indexOf("node_modules");
    if (nodeModulesIndex !== -1) {
      currentDir = currentDir.substring(0, nodeModulesIndex);
    }
  }

  // Traverse up to find package.json (indicating project root)
  while (currentDir !== path.dirname(currentDir)) {
    const packageJsonPath = path.join(currentDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

/**
 * Load the Tusk config from .tusk/config.yaml in the customer's project
 * Returns the raw config object without strict typing to allow future extensions
 */
export function loadTuskConfig(): TuskConfig | null {
  try {
    const projectRoot = findProjectRoot();
    if (!projectRoot) {
      logger.error("Could not find project root. Config loading skipped.");
      return null;
    }

    const configPath = path.join(projectRoot, ".tusk", "config.yaml");

    if (!fs.existsSync(configPath)) {
      logger.error(`No config file found at ${configPath}`);
      return null;
    }

    logger.debug(`Loading config from ${configPath}`);

    const configContent = fs.readFileSync(configPath, "utf8");
    const config = yaml.load(configContent) as TuskConfig;

    logger.debug(`Successfully loaded config for service: ${config.service?.name || "unknown"}`);
    return config;
  } catch (error) {
    logger.error("Error loading config:", error);
    return null;
  }
}
