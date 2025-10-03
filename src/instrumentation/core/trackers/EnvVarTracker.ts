export class EnvVarTracker {
  // This should be a mapping between trace id and env var
  private static envVars = new Map<string, Record<string, string | undefined>>();

  static setEnvVar({
    traceId,
    key,
    value,
  }: {
    traceId: string;
    key: string;
    value: string | undefined;
  }): void {
    this.envVars.set(traceId, {
      ...(this.envVars.get(traceId) || {}),
      [key]: value,
    });
  }

  static setEnvVars(traceId: string, envVars: Record<string, string | undefined>): void {
    this.envVars.set(traceId, envVars);
  }

  static getEnvVar(traceId: string, key: string): string | undefined {
    return this.envVars.get(traceId)?.[key];
  }

  static getEnvVars(traceId: string): Record<string, string | undefined> | undefined {
    return this.envVars.get(traceId);
  }

  static clearEnvVars(traceId: string): void {
    this.envVars.delete(traceId);
  }
}
