export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
}

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export class NonRetryableError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private state: CircuitState = "closed";
  private failureCount = 0;
  private openedAtMs = 0;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  allowRequest(): boolean {
    if (this.state === "closed") {
      return true;
    }

    if (this.state === "open") {
      if (Date.now() - this.openedAtMs < this.config.resetTimeoutMs) {
        return false;
      }
      this.state = "half_open";
      return true;
    }

    return true;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = "closed";
    this.openedAtMs = 0;
  }

  recordFailure(): void {
    if (this.state === "half_open") {
      this.tripOpen();
      return;
    }

    this.failureCount += 1;
    if (this.failureCount >= this.config.failureThreshold) {
      this.tripOpen();
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  private tripOpen(): void {
    this.state = "open";
    this.failureCount = 0;
    this.openedAtMs = Date.now();
  }
}

export async function withRetries<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
): Promise<T> {
  let attempt = 0;
  let delayMs = config.initialDelayMs;
  let lastError: unknown = new Error("retry loop did not execute");

  while (attempt < config.maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt += 1;

      if (error instanceof NonRetryableError || attempt >= config.maxAttempts) {
        break;
      }

      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, config.maxDelayMs);
    }
  }

  throw lastError;
}
