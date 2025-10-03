export interface TdInstrumentationConfig {
  enabled?: boolean;
  [key: string]: any;
}

export abstract class TdInstrumentationAbstract {
  protected _config: TdInstrumentationConfig;
  protected instrumentationName: string;

  constructor(instrumentationName: string, config: TdInstrumentationConfig = {}) {
    this.instrumentationName = instrumentationName;
    this._config = {
      enabled: false,
      ...config,
    };
  }

  getConfig(): TdInstrumentationConfig {
    return this._config;
  }

  setConfig(config: TdInstrumentationConfig = {}): void {
    this._config = { ...config };
  }

  get name(): string {
    return this.instrumentationName;
  }

  abstract enable(): void;
  abstract isEnabled(): boolean;
}
