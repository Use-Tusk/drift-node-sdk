import { logger } from "../../../core/utils/logger";

/**
 * Shimmer utility functions for wrapping and unwrapping methods
 * Based on shimmer patterns commonly used in instrumentation
 */

/**
 * Check if a function has been wrapped by checking for the wrapped property
 */
export function isWrapped(func: any): boolean {
  return typeof func === "function" && func._isWrapped === true;
}

/**
 * Wrap a method on an object with a new function
 */
export function wrap<T = any>(
  target: any,
  propertyName: string,
  wrapper: (original: T) => T,
): T | void {
  if (typeof target[propertyName] !== "function") {
    logger.debug(`Cannot wrap non-function property: ${propertyName}`);
    return;
  }

  if (isWrapped(target[propertyName])) {
    logger.debug(`Property ${propertyName} is already wrapped`);
    return;
  }

  const original = target[propertyName];
  const wrapped = wrapper(original);

  if (typeof wrapped !== "function") {
    logger.debug(`Wrapper must return a function for property: ${propertyName}`);
    return;
  }

  // Mark as wrapped and store original
  (wrapped as any)._isWrapped = true;
  (wrapped as any)._original = original;
  (wrapped as any)._propertyName = propertyName;

  target[propertyName] = wrapped;
  return wrapped;
}
