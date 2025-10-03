/**
 * Utility to access original global functions before they are instrumented.
 * This should be imported early in the application lifecycle to capture
 * the original references before any instrumentation occurs.
 *
 * NOTE: this only works for global functions, not for module imports.
 */

const OriginalDate = globalThis.Date;
const OriginalProcessEnv = process.env;

export class OriginalGlobalUtils {
  /**
   * Get the original Date constructor, unaffected by instrumentation
   */
  static getOriginalDate(): Date {
    return new OriginalDate();
  }

  /**
   * Get a specific environment variable using the original process.env
   */
  static getOriginalProcessEnvVar(key: string): string | undefined {
    return OriginalProcessEnv[key];
  }
}
