import fs from "fs";
import os from "os";
import path from "path";

import {
  HttpInstrumentation,
  PgInstrumentation,
  FetchInstrumentation,
  TcpInstrumentation,
  GraphqlInstrumentation,
  JsonwebtokenInstrumentation,
  DateInstrumentation,
  JwksRsaInstrumentation,
  EnvInstrumentation,
  PostgresInstrumentation,
  Mysql2Instrumentation,
  IORedisInstrumentation,
  GrpcInstrumentation,
  FirestoreInstrumentation,
  NextjsInstrumentation,
  PrismaInstrumentation,
} from "../instrumentation/libraries";
import { TdSpanExporter } from "./tracing/TdSpanExporter";
import { trace, Tracer } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ProtobufCommunicator, MockRequestInput } from "./ProtobufCommunicator";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { CleanSpanData, TD_INSTRUMENTATION_LIBRARY_NAME } from "./types";
import { TuskDriftInstrumentationModuleNames } from "./TuskDriftInstrumentationModuleNames";
import { SDK_VERSION } from "../version";
import {
  LogLevel,
  initializeGlobalLogger,
  logger,
  loadTuskConfig,
  TuskConfig,
  OriginalGlobalUtils,
} from "./utils";
import { TransformConfigs } from "../instrumentation/libraries/types";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { Resource } from "@opentelemetry/resources";

export interface InitParams {
  apiKey?: string;
  env?: string;
  logLevel?: LogLevel;
  transforms?: TransformConfigs;
  samplingRate?: number;
}

export enum TuskDriftMode {
  DISABLED = "DISABLED",
  RECORD = "RECORD",
  REPLAY = "REPLAY",
}

/**
 * The core class for Tusk Drift.
 * This class is responsible for initializing the Tusk Drift SDK and managing the Tusk Drift instance.
 */
export class TuskDriftCore {
  private static instance: TuskDriftCore;
  private initialized = false;
  private appReady = false;
  private mode: TuskDriftMode;
  private initParams: InitParams;
  private config: TuskConfig;
  private communicator?: ProtobufCommunicator | undefined;
  private samplingRate: number;
  private cliConnectionPromise: Promise<void> | null;
  // Add a flag to track connection status
  private isConnectedWithCLI = false;
  spanExporter?: TdSpanExporter;

  constructor() {
    this.mode = this.detectMode();
    this.config = loadTuskConfig() || {};
  }

  private isCommonJS(): boolean {
    return (
      typeof module !== "undefined" &&
      "exports" in module &&
      typeof require !== "undefined" &&
      typeof require.cache !== "undefined"
    );
  }

  private getPackageName(modulePath: string): string | null {
    let dir = path.dirname(modulePath);
    while (dir) {
      const packageJsonPath = path.join(dir, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
          return packageJson.name || null;
        } catch (err) {
          logger.error(`Error reading package.json in ${packageJsonPath}:`, err);
          return null;
        }
      }
      const parentDir = path.dirname(dir);
      if (parentDir === dir || !parentDir.includes("node_modules")) {
        break;
      }
      dir = parentDir;
    }
    return null;
  }

  private alreadyRequiredModules(): Set<string> {
    const alreadyRequiredModuleNames = new Set<string>();

    if (this.isCommonJS()) {
      const requireCache = Object.keys(require.cache);
      for (const modulePath of requireCache) {
        if (modulePath.includes("node_modules")) {
          const packageName = this.getPackageName(modulePath);
          if (packageName && TuskDriftInstrumentationModuleNames.includes(packageName)) {
            alreadyRequiredModuleNames.add(packageName);
          }
        }
      }
    } else {
      // ESM or other module systems - no reliable detection possible
      logger.debug("Running in ES Module mode. Cannot detect pre-loaded instrumentation modules.");
    }

    return alreadyRequiredModuleNames;
  }

  static getInstance(): TuskDriftCore {
    if (!TuskDriftCore.instance) {
      TuskDriftCore.instance = new TuskDriftCore();
    }
    return TuskDriftCore.instance;
  }

  private detectMode(): TuskDriftMode {
    const modeEnv = OriginalGlobalUtils.getOriginalProcessEnvVar("TUSK_DRIFT_MODE");

    switch (modeEnv?.toUpperCase()) {
      case "RECORD":
        return TuskDriftMode.RECORD;
      case "REPLAY":
        return TuskDriftMode.REPLAY;
      case "DISABLED":
      case "DISABLE":
        return TuskDriftMode.DISABLED;
      default:
        // If no mode specified, default to disabled
        return TuskDriftMode.DISABLED;
    }
  }

  private validateSamplingRate(value: number, source: string): boolean {
    if (typeof value !== "number" || isNaN(value)) {
      logger.warn(`Invalid sampling rate from ${source}: not a number. Ignoring.`);
      return false;
    }
    if (value < 0 || value > 1) {
      logger.warn(
        `Invalid sampling rate from ${source}: ${value}. Must be between 0.0 and 1.0. Ignoring.`,
      );
      return false;
    }
    return true;
  }

  private determineSamplingRate(initParams: InitParams): number {
    // Precedence: InitParams > Env Var > Config YAML > Default (1.0)

    // 1. Check init params (highest priority)
    if (initParams.samplingRate !== undefined) {
      if (this.validateSamplingRate(initParams.samplingRate, "init params")) {
        logger.debug(`Using sampling rate from init params: ${initParams.samplingRate}`);
        return initParams.samplingRate;
      }
    }

    // 2. Check environment variable
    const envSamplingRate = OriginalGlobalUtils.getOriginalProcessEnvVar("TUSK_SAMPLING_RATE");
    if (envSamplingRate !== undefined) {
      const parsed = parseFloat(envSamplingRate);
      if (this.validateSamplingRate(parsed, "TUSK_SAMPLING_RATE env var")) {
        logger.debug(`Using sampling rate from TUSK_SAMPLING_RATE env var: ${parsed}`);
        return parsed;
      }
    }

    // 3. Check config file
    if (this.config.recording?.sampling_rate !== undefined) {
      if (this.validateSamplingRate(this.config.recording.sampling_rate, "config.yaml")) {
        logger.debug(
          `Using sampling rate from config.yaml: ${this.config.recording.sampling_rate}`,
        );
        return this.config.recording.sampling_rate;
      }
    }

    // 4. Default to 1.0 (100%)
    logger.debug("Using default sampling rate: 1.0");
    return 1;
  }

  private registerDefaultInstrumentations(): void {
    const transforms = this.config.transforms ?? this.initParams.transforms;

    // Just creating the instrumentations registers them with the sdk
    // All these instrumentations extend TdInstrumentationBase
    // TdInstrumentationBase constructor calls enable() which sets up the require-in-the-middle hooks to patch the modules
    // when the modules are required
    new HttpInstrumentation({
      enabled: true,
      mode: this.mode,
      transforms,
    });

    new PgInstrumentation({
      enabled: true,
      mode: this.mode,
    });

    new FetchInstrumentation({
      enabled: true,
      mode: this.mode,
      transforms,
    });

    new TcpInstrumentation({
      enabled: true,
      mode: this.mode,
    });

    new GraphqlInstrumentation({
      enabled: true,
      mode: this.mode,
    });

    new JsonwebtokenInstrumentation({
      enabled: true,
      mode: this.mode,
    });

    new DateInstrumentation({
      enabled: true,
      mode: this.mode,
    });

    new JwksRsaInstrumentation({
      enabled: true,
      mode: this.mode,
    });

    new EnvInstrumentation({
      enabled: this.config.recording?.enable_env_var_recording || false,
      mode: this.mode,
    });

    new PostgresInstrumentation({
      enabled: true,
      mode: this.mode,
    });

    new Mysql2Instrumentation({
      enabled: true,
      mode: this.mode,
    });

    new IORedisInstrumentation({
      enabled: true,
      mode: this.mode,
    });

    new GrpcInstrumentation({
      enabled: true,
      mode: this.mode,
    });

    new FirestoreInstrumentation({
      enabled: true,
      mode: this.mode,
    });

    new NextjsInstrumentation({
      enabled: true,
      mode: this.mode,
    });

    new PrismaInstrumentation({
      enabled: true,
      mode: this.mode,
    });
  }

  private initializeTracing({ baseDirectory }: { baseDirectory: string }): void {
    const serviceName = this.config.service?.name || "unknown";

    logger.debug(`Initializing OpenTelemetry tracing for service: ${serviceName}`);

    this.spanExporter = new TdSpanExporter({
      baseDirectory,
      mode: this.mode,
      useRemoteExport: this.config.recording?.export_spans || false,
      observableServiceId: this.config.service?.id,
      apiKey: this.initParams.apiKey,
      tuskBackendBaseUrl: this.config.tusk_api?.url || "https://api.usetusk.ai",
      environment: this.initParams.env || "unknown",
      sdkVersion: SDK_VERSION,
      sdkInstanceId: this.generateSdkInstanceId(),
    });

    const tracerProvider = new NodeTracerProvider({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: serviceName,
      }),
      spanProcessors: [
        new BatchSpanProcessor(this.spanExporter, {
          // Maximum queue size before spans are dropped, default 2048
          maxQueueSize: 2048,
          // Maximum batch size per export, default 512
          maxExportBatchSize: 512,
          // Interval between exports, default 5s
          scheduledDelayMillis: 2000,
          // Max time for export before timeout, default 30s
          exportTimeoutMillis: 30000,
        }),
      ],
    });

    // Register the tracer provider
    tracerProvider.register();
    logger.debug(`OpenTelemetry tracing initialized`);
  }

  private generateSdkInstanceId(): string {
    const originalDate = OriginalGlobalUtils.getOriginalDate();
    return `sdk-${originalDate.getTime()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  initialize(initParams: InitParams): void {
    // Initialize logging with provided level or default to 'info'
    initializeGlobalLogger({
      logLevel: initParams.logLevel || "info",
      prefix: "TuskDrift",
    });

    this.samplingRate = this.determineSamplingRate(initParams);
    this.initParams = initParams;

    if (!this.initParams.env) {
      const nodeEnv = OriginalGlobalUtils.getOriginalProcessEnvVar("NODE_ENV") || "development";
      logger.warn(
        `Environment not provided in initialization parameters. Using '${nodeEnv}' as the environment.`,
      );
      this.initParams.env = nodeEnv;
    }

    if (this.initialized) {
      logger.debug("Already initialized, skipping...");
      return;
    }

    if (
      this.mode === TuskDriftMode.RECORD &&
      this.config.recording?.export_spans &&
      !this.initParams.apiKey
    ) {
      logger.error(
        "In record mode and export_spans is true, but API key not provided. API key is required to export spans to Tusk backend. Please provide an API key in the initialization parameters.",
      );
      return;
    }

    // Need to have observable service id if exporting spans to Tusk backend
    if (this.config.recording?.export_spans && !this.config.service?.id) {
      logger.error(
        "Observable service ID not provided. Please provide an observable service ID in the configuration file.",
      );
      return;
    }

    if (this.mode === TuskDriftMode.DISABLED) {
      logger.debug("SDK disabled via environment variable");
      return;
    }

    logger.debug(`Initializing in ${this.mode} mode`);

    if (this.mode === TuskDriftMode.REPLAY) {
      // Disable Sentry in replay mode
      process.env.SENTRY_DSN = "";
    }

    // Initialize ProtobufCommunicator early
    this.communicator = new ProtobufCommunicator();

    if (this.mode === TuskDriftMode.REPLAY) {
      // Check if TCP mode or Unix socket mode
      const mockHost = OriginalGlobalUtils.getOriginalProcessEnvVar("TUSK_MOCK_HOST");
      const mockPort = OriginalGlobalUtils.getOriginalProcessEnvVar("TUSK_MOCK_PORT");
      const mockSocket = OriginalGlobalUtils.getOriginalProcessEnvVar("TUSK_MOCK_SOCKET");

      let connectionInfo: { socketPath: string } | { host: string; port: number };

      if (mockHost && mockPort) {
        // TCP mode (Docker)
        connectionInfo = {
          host: mockHost,
          port: parseInt(mockPort, 10),
        };
        logger.debug(`Using TCP connection to CLI: ${mockHost}:${mockPort}`);
      } else {
        // Unix socket mode (default)
        const socketPath = mockSocket || path.join(os.tmpdir(), "tusk-connect.sock");

        // Check if socket exists and is ready
        try {
          fs.accessSync(socketPath, fs.constants.F_OK);
          const stats = fs.statSync(socketPath);
          if (!stats.isSocket()) {
            throw new Error(`Path exists but is not a socket: ${socketPath}`);
          }
          logger.debug("Socket found and verified at", socketPath);
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            throw new Error(`Socket not found at ${socketPath}. Make sure Tusk CLI is running.`);
          }
          throw new Error(
            `Socket check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }

        connectionInfo = { socketPath };
      }

      // Start connection early for replay mode (runs in parallel with other initialization)
      // This will be awaited when the first requestAsyncMock is called
      this.cliConnectionPromise = this.communicator
        .connect(connectionInfo, this.config.service?.id || "unknown")
        .then(() => {
          this.isConnectedWithCLI = true;
          logger.debug("SDK successfully connected to CLI");
        });
    }

    // Check if any instrumentation modules are already required
    const packageNames = this.alreadyRequiredModules();
    if (packageNames.size > 0) {
      const moduleList = [...packageNames].join(", ");
      const message = `TuskDrift must be initialized before any other modules are required. This ensures TuskDrift is able to instrument the required modules. ${moduleList} ${packageNames.size > 1 ? "are" : "is"} already required.`;

      if (this.mode === TuskDriftMode.RECORD) {
        logger.warn(`${message} TuskDrift is now disabled and will continue in disabled mode.`);
        this.mode = TuskDriftMode.DISABLED;
        return;
      } else if (this.mode === TuskDriftMode.REPLAY) {
        logger.error(`${message} TuskDrift will not run in replay mode. Stopping the app.`);
        process.exit(1);
      }
    }

    // Only used when storing spans locally
    const baseDirectory = this.config.traces?.dir || path.join(process.cwd(), ".tusk/traces");

    logger.debug(`Config: ${JSON.stringify(this.config)}`);
    logger.debug(`Base directory: ${baseDirectory}`);

    // Register instrumentations (runs in parallel with connection)
    this.registerDefaultInstrumentations();

    // Initialize OpenTelemetry tracing (runs in parallel with connection)
    // Important to do this after registering instrumentations since initializeTracing lazy imports the NodeSDK from OpenTelemetry
    // which imports the gRPC exporter
    this.initializeTracing({ baseDirectory });

    this.initialized = true;
    logger.info("SDK initialized successfully");
  }

  markAppAsReady(): void {
    if (!this.initialized) {
      if (this.mode !== TuskDriftMode.DISABLED) {
        logger.error("markAppAsReady() called before initialize(). Call initialize() first.");
      }
      return;
    }

    this.appReady = true;
    logger.debug("Application marked as ready");

    if (this.mode === TuskDriftMode.REPLAY) {
      logger.debug("Replay mode active - ready to serve mocked responses");
    } else if (this.mode === TuskDriftMode.RECORD) {
      logger.debug("Record mode active - capturing inbound requests and responses");
    }
  }

  async sendInboundSpanForReplay(span: CleanSpanData): Promise<void> {
    try {
      if (this.communicator) {
        await this.communicator.sendInboundSpanForReplay(span);
      }
    } catch (e) {
      logger.error("Failed to send inbound replay span:", e);
    }
  }

  private createMockRequestCore(
    mockRequest: MockRequestInput,
  ): { found: boolean; response?: unknown; error?: string } | null {
    if (!this.communicator || this.mode !== TuskDriftMode.REPLAY) {
      logger.error(
        "Cannot request mock: not in replay mode or no CLI connection",
        this.mode,
        this.communicator,
      );
      return { found: false, error: "Not in replay mode or no CLI connection" };
    }

    return null; // Indicates we should proceed with CLI request
  }

  async requestMockAsync(
    mockRequest: MockRequestInput,
  ): Promise<{ found: boolean; response?: unknown; error?: string }> {
    if (this.cliConnectionPromise && !this.isConnectedWithCLI) {
      logger.debug("Waiting for CLI connection to be established");
      await this.cliConnectionPromise;
    }

    const mockRequestCore = this.createMockRequestCore(mockRequest);
    if (mockRequestCore) {
      return mockRequestCore;
    }
    return this.requestMockFromCLIAsync(mockRequest);
  }

  private async requestMockFromCLIAsync(
    mockRequest: MockRequestInput,
  ): Promise<{ found: boolean; response?: unknown; error?: string }> {
    if (!this.communicator || this.mode !== TuskDriftMode.REPLAY) {
      logger.error("Cannot request mock: not in replay mode or no CLI connection");
      return { found: false, error: "Not in replay mode or no CLI connection" };
    }

    try {
      logger.debug("Sending protobuf request to CLI (async)", JSON.stringify(mockRequest, null, 2));

      const response = await this.communicator.requestMockAsync({
        testId: mockRequest.testId,
        outboundSpan: mockRequest.outboundSpan,
      });

      logger.debug("Received protobuf response from CLI", JSON.stringify(response, null, 2));
      return response;
    } catch (error) {
      logger.error("Error sending protobuf request to CLI:", error);
      return {
        found: false,
        error: `Error sending request: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  requestMockSync(mockRequest: MockRequestInput): {
    found: boolean;
    response?: unknown;
    error?: string;
  } {
    if (!this.isConnectedWithCLI) {
      // We cannot await for the CLI to be connected like we do in requestMockAsync since it's a synchronous call
      // That means this function will likely throw an error if the first mock requested needs to be sync
      // This is a limitation of the current implementation and will be fixed in the future
      logger.error("Requesting sync mock but CLI is not ready yet");
      throw new Error("Requesting sync mock but CLI is not ready yet");
    }

    const mockRequestCore = this.createMockRequestCore(mockRequest);
    if (mockRequestCore) {
      return mockRequestCore;
    }
    return this.requestMockFromCLISync(mockRequest);
  }

  private requestMockFromCLISync(mockRequest: MockRequestInput): {
    found: boolean;
    response?: unknown;
    error?: string;
  } {
    if (!this.communicator || this.mode !== TuskDriftMode.REPLAY) {
      logger.error(
        "Cannot request mock: not in replay mode or no CLI connection",
        this.mode,
        this.communicator,
      );
      return { found: false, error: "Not in replay mode or no CLI connection" };
    }

    try {
      logger.debug("Sending protobuf request to CLI (sync)", mockRequest);

      const response = this.communicator.requestMockSync({
        testId: mockRequest.testId,
        outboundSpan: mockRequest.outboundSpan,
      });

      logger.debug("Received protobuf response from CLI", response);
      return response;
    } catch (error) {
      logger.error("Error sending protobuf request to CLI:", error);
      return {
        found: false,
        error: `Error sending request: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  getMode(): TuskDriftMode {
    return this.mode;
  }

  getSamplingRate(): number {
    return this.samplingRate;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isAppReady(): boolean {
    return this.appReady;
  }

  getConfig(): TuskConfig {
    return this.config;
  }

  getInitParams(): InitParams {
    return this.initParams;
  }

  getTracer(): Tracer {
    return trace.getTracer(TD_INSTRUMENTATION_LIBRARY_NAME);
  }
}

// These JSDoc comments are exposed in the type definitions
interface TuskDriftPublicAPI {
  /**
   * Initialize the TuskDrift SDK instance
   *
   * This is the main initialization function for TuskDrift that must be called before importing/requiring any other modules.
   *
   * @param initParams - The initialization parameters object containing:
   *   - apiKey: string - Your TuskDrift API key (required)
   *   - env: string - The environment name (e.g., 'development', 'staging', 'production') (required)
   *   - logLevel?: LogLevel - Optional logging level ('silent' | 'error' | 'warn' | 'info' | 'debug'), defaults to 'info'
   *   - samplingRate?: number - Optional sampling rate (0.0-1.0) for recording requests. Overrides TUSK_SAMPLING_RATE env var and config.yaml. Defaults to 1.0
   *
   * @returns void - Initializes the SDK
   *
   * @example
   * ```typescript
   * import  { TuskDrift } from "@use-tusk/drift-node-sdk"
   *
   * TuskDrift.initialize({
   *   apiKey: 'your-api-key',
   *   env: 'production',
   *   logLevel: 'debug',
   *   samplingRate: 1  // Record 100% of requests
   * });
   *
   * ```
   */
  initialize(initParams: InitParams): void;

  /**
   * Mark the application as ready for recording/replay
   *
   * This should be called after the application has completed initialization and is ready to serve requests.
   *
   * @returns void
   */
  markAppAsReady(): void;

  /**
   * Check if the application is ready
   */
  isAppReady(): boolean;
}

class TuskDriftSDK implements TuskDriftPublicAPI {
  private tuskDrift = TuskDriftCore.getInstance();

  initialize(initParams: InitParams): void {
    return this.tuskDrift.initialize(initParams);
  }

  markAppAsReady(): void {
    return this.tuskDrift.markAppAsReady();
  }

  isAppReady(): boolean {
    return this.tuskDrift.isAppReady();
  }
}

// Export singleton instance with restricted API
export const TuskDrift: TuskDriftPublicAPI = new TuskDriftSDK();
