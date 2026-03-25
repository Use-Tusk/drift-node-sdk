export function isCommonJS(): boolean {
  try {
    return (
      typeof module !== "undefined" &&
      "exports" in module &&
      typeof require !== "undefined" &&
      typeof require.cache !== "undefined"
    );
  } catch {
    return false;
  }
}

export function isNextJsRuntime(): boolean {
  return (
    process.env.NEXT_RUNTIME !== undefined || typeof (global as any).__NEXT_DATA__ !== "undefined"
  );
}

export function isEsm(moduleExports: any): boolean {
  // Guard against null, undefined, and non-object values
  if (!moduleExports || typeof moduleExports !== "object") {
    return false;
  }

  try {
    // Check if Symbol.toStringTag exists and equals "Module"
    // This is the standard way ESM modules identify themselves
    return moduleExports[Symbol.toStringTag] === "Module";
  } catch (error) {
    // If accessing the symbol throws an error (unlikely but possible with Proxies),
    // safely return false
    return false;
  }
}
