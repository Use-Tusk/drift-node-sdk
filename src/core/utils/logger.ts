import { OriginalGlobalUtils } from "./";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

interface LoggerConfig {
  logLevel: LogLevel;
  prefix?: string;
}

class Logger {
  private config: LoggerConfig;
  private readonly levels = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
  };

  constructor(config: LoggerConfig) {
    this.config = config;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] <= this.levels[this.config.logLevel];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const currentData = OriginalGlobalUtils.getOriginalDate();
    const timestamp = currentData instanceof Date ? currentData.toISOString() : currentData;
    // const timestamp = new Date().toISOString();
    const prefix = this.config.prefix ? `[${this.config.prefix}] ` : "[TuskDrift] ";
    return `${timestamp} ${prefix}${message}`;
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", message), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog("info")) {
      console.log(this.formatMessage("info", message), ...args);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog("debug")) {
      console.log(this.formatMessage("debug", message), ...args);
    }
  }

  setLogLevel(level: LogLevel): void {
    this.config.logLevel = level;
  }

  getLogLevel(): LogLevel {
    return this.config.logLevel;
  }
}

// Global logger instance
let globalLogger: Logger;

export function createLogger(config: LoggerConfig): Logger {
  return new Logger(config);
}

export function initializeGlobalLogger(config: LoggerConfig): void {
  globalLogger = createLogger(config);
}

export function getLogger(): Logger {
  if (!globalLogger) {
    // Default to warn level if not initialized
    globalLogger = createLogger({ logLevel: "warn" });
  }
  return globalLogger;
}

/**
 * - LogLevel = "silent"
 *   - No logs are emitted
 * - LogLevel = "error"
 *   - Logs errors
 * - LogLevel = "warn"
 *   - Logs warnings and errors
 * - LogLevel = "info"
 *   - Logs info, warnings, and errors
 * - LogLevel = "debug"
 *   - Logs debug, info, warnings, and errors
 */
export const logger = {
  error: (message: string, ...args: unknown[]) => getLogger().error(message, ...args),
  warn: (message: string, ...args: unknown[]) => getLogger().warn(message, ...args),
  info: (message: string, ...args: unknown[]) => getLogger().info(message, ...args),
  debug: (message: string, ...args: unknown[]) => getLogger().debug(message, ...args),
  setLogLevel: (level: LogLevel) => getLogger().setLogLevel(level),
  getLogLevel: () => getLogger().getLogLevel(),
};
