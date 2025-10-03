import path from "path";
import { satisfies } from "semver";
import { TdInstrumentationAbstract, TdInstrumentationConfig } from "./TdInstrumentationAbstract";
import { TdInstrumentationNodeModule } from "./TdInstrumentationNodeModule";
import { Hook, HookOptions } from "require-in-the-middle";
import { sendVersionMismatchAlert } from "../../../core/analytics";
import { logger } from "../../../core/utils/logger";

export abstract class TdInstrumentationBase extends TdInstrumentationAbstract {
  protected _modules: TdInstrumentationNodeModule[] = [];
  protected _enabled = false;

  constructor(instrumentationName: string, config: TdInstrumentationConfig = {}) {
    super(instrumentationName, config);

    let modules = this.init();
    if (modules && !Array.isArray(modules)) {
      modules = [modules];
    }
    this._modules = modules || [];

    if (this._config.enabled) {
      this.enable();
    }
  }

  abstract init(): TdInstrumentationNodeModule | TdInstrumentationNodeModule[] | void;

  /**
   * Check if the provided version matches any of the supported versions
   * @param supportedVersions - Array of version patterns (e.g. ["^1.0.0", "2.x"])
   * @param version - The actual version to check (e.g. "1.2.3")
   * @param includePrerelease - Whether to include prerelease versions
   * @returns true if version is supported, false otherwise
   */
  isSupported(supportedVersions: string[], version?: string, includePrerelease = false): boolean {
    if (typeof version === "undefined") {
      return supportedVersions.includes("*");
    }
    if (version === "any") {
      return true;
    }
    return supportedVersions.some((supportedVersion) =>
      satisfies(version, supportedVersion, {
        includePrerelease,
      }),
    );
  }

  /**
   * Extract package version from package.json in the given base directory
   * @param baseDir - Base directory containing package.json
   * @returns Version string or undefined if not found
   */
  private _extractPackageVersion(baseDir?: string): string | undefined {
    if (!baseDir) {
      return undefined;
    }
    try {
      const packagePath = path.join(baseDir, "package.json");
      const { version } = require(packagePath);
      return typeof version === "string" ? version : undefined;
    } catch (error) {
      logger.warn(`Failed extracting version from ${baseDir}:`, error);
    }
    return undefined;
  }

  enable(): void {
    if (this._enabled) {
      return;
    }
    this._enabled = true;

    // Set up require-in-the-middle hooks for each module
    for (const module of this._modules) {
      // Also set up hook for future requires
      const onRequire = (exports: any, name: string, baseDir?: string) => {
        return this._onRequire(module, exports, name, baseDir);
      };

      const hookOptions: HookOptions = { internals: true };
      new Hook([module.name], hookOptions, onRequire);
    }
  }

  isEnabled(): boolean {
    return this._enabled;
  }

  private _onRequire(
    module: TdInstrumentationNodeModule,
    exports: any,
    name: string,
    baseDir?: string,
  ): any {
    // baseDir set by require-in-the-middle
    if (!baseDir) {
      if (typeof module.patch === "function") {
        module.moduleExports = exports;
        if (this._enabled) {
          logger.debug(`Patching module ${name} (no version info available)`);
          return module.patch(exports);
        }
      }
      return exports;
    }

    const version = this._extractPackageVersion(baseDir);
    module.moduleVersion = version;

    if (module.name === name) {
      if (
        this.isSupported(module.supportedVersions, version) &&
        typeof module.patch === "function"
      ) {
        module.moduleExports = exports;
        if (this._enabled) {
          logger.debug(
            `Patching main module ${name} v${version} for instrumentation ${this.instrumentationName}`,
          );
          return module.patch(exports, module.moduleVersion);
        }
      } else if (version) {
        // Check if ANY module for this package name supports this version before logging/alerting
        const isVersionSupportedByAnyModule = this._modules
          .filter((m) => m.name === name)
          .some((m) => this.isSupported(m.supportedVersions, version));

        if (!isVersionSupportedByAnyModule) {
          logger.error(
            `Version mismatch for module ${name}: found v${version}, supported versions: [${module.supportedVersions.join(", ")}]. Please contact support@usetusk.ai to add support for this version.`,
          );
          sendVersionMismatchAlert({
            moduleName: name,
            foundVersion: version,
            supportedVersions: module.supportedVersions,
          });
        }
      } else {
        logger.error(
          `No version found for module ${name}, supported versions: [${module.supportedVersions.join(", ")}]. Please contact support@usetusk.ai to add support for this version.`,
        );
        sendVersionMismatchAlert({
          moduleName: name,
          foundVersion: undefined,
          supportedVersions: module.supportedVersions,
        });
      }
      return exports;
    }

    // Handle file-level patching
    const files = module.files ?? [];
    const normalizedName = path.normalize(name);
    const supportedFileInstrumentations = files
      .filter((f) => f.name === normalizedName)
      .filter((f) => this.isSupported(f.supportedVersions, version, false));

    // Only log file version mismatch if NO module supports this file for this version
    if (
      supportedFileInstrumentations.length === 0 &&
      files.some((f) => f.name === normalizedName)
    ) {
      // Check if ANY module in this instrumentation has a file that supports this version
      const isFileSupportedByAnyModule = this._modules
        .flatMap((m) => m.files || [])
        .filter((f) => f.name === normalizedName)
        .some((f) => this.isSupported(f.supportedVersions, version, false));

      if (!isFileSupportedByAnyModule) {
        logger.error(
          `Version mismatch for file ${normalizedName}: found v${version}, no compatible file instrumentation found. Please contact support@usetusk.ai to add support for this version.`,
        );
        sendVersionMismatchAlert({
          moduleName: normalizedName,
          foundVersion: version,
          supportedVersions: files.flatMap((f) => f.supportedVersions),
        });
      }
    }

    return supportedFileInstrumentations.reduce((patchedExports, file) => {
      file.moduleExports = patchedExports;
      if (this._enabled) {
        logger.debug(
          `Patching file ${file.name} v${version} for instrumentation ${this.instrumentationName}`,
        );
        return file.patch(patchedExports, module.moduleVersion);
      }
      return patchedExports;
    }, exports);
  }
}
