/**
 * Reconstruct a parameterized query string from template strings array and values.
 * Converts values to $1, $2, etc. placeholders.
 */
export function reconstructQueryString(strings: TemplateStringsArray, values: any[]): string {
  let queryString = "";
  for (let i = 0; i < strings.length; i++) {
    queryString += strings[i];
    if (i < values.length) {
      queryString += `$${i + 1}`;
    }
  }
  return queryString;
}

/**
 * Sanitize connection string by removing sensitive information like passwords.
 */
export function sanitizeConnectionString(connectionString: string): string {
  try {
    // Remove password from connection string for security
    const url = new URL(connectionString);
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    return "[INVALID_URL]";
  }
}

/**
 * Sanitize connection options by removing sensitive fields.
 */
export function sanitizeConnectionOptions(options: any): any {
  if (!options || typeof options !== "object") {
    return options;
  }

  const sanitized = { ...options };

  // Remove sensitive fields
  if (sanitized.password) {
    sanitized.password = "***";
  }
  if (sanitized.ssl && typeof sanitized.ssl === "object") {
    sanitized.ssl = { ...sanitized.ssl };
    if (sanitized.ssl.key) sanitized.ssl.key = "***";
    if (sanitized.ssl.cert) sanitized.ssl.cert = "***";
    if (sanitized.ssl.ca) sanitized.ssl.ca = "***";
  }

  return sanitized;
}
