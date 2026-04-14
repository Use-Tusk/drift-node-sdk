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
  PostgresInstrumentation,
  Mysql2Instrumentation,
  IORedisInstrumentation,
  RedisInstrumentation,
  UpstashRedisInstrumentation,
  GrpcInstrumentation,
  FirestoreInstrumentation,
  NextjsInstrumentation,
  PrismaInstrumentation,
  MysqlInstrumentation,
  MongodbInstrumentation,
} from "../instrumentation/libraries";
import { TdSpanExporter } from "./tracing/TdSpanExporter";
import { context, trace, Tracer, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ProtobufCommunicator, MockRequestInput, MockResponseOutput } from "./ProtobufCommunicator";
import { CleanSpanData, TD_INSTRUMENTATION_LIBRARY_NAME, STOP_RECORDING_CHILD_SPANS_CONTEXT_KEY } from "./types";
import { TuskDriftInstrumentationModuleNames } from "./TuskDriftInstrumentationModuleNames";
import { SDK_VERSION } from "../version";
import { SpanUtils } from "./tracing/SpanUtils";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import {
  LogLevel,
  initializeGlobalLogger,
  logger,
  loadTuskConfig,
  TuskConfig,
  OriginalGlobalUtils,
  isCommonJS,
} from "./utils";
import { TransformConfigs } from "../instrumentation/libraries/types";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { Resource } from "@opentelemetry/resources";
import { getRustCoreStartupStatus } from "./rustCoreBinding";
import { initializeEsmLoader } from "./esmLoader";
import { monitorEventLoopDelay } from "perf_hooks";
import type { IntervalHistogram } from "perf_hooks";
import {
  AdaptiveSamplingController,
  RootSamplingDecision,
  SamplingMode,
} from "./sampling/AdaptiveSamplingController";
import { DriftBatchSpanProcessor } from "./tracing/DriftBatchSpanProcessor";

export interface InitParams {
  apiKey?: string;
  env?: string;
  logLevel?: LogLevel;
  transforms?: TransformConfigs;
  samplingRate?: number;
  /** Set to `false` to disable automatic ESM loader hook registration. Defaults to `true`. */
  registerEsmLoaderHooks?: boolean;
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
  private initParams: InitParams = {};
  private config: TuskConfig;
  private communicator?: ProtobufCommunicator | undefined;
  private samplingRate = 1;
  private samplingMode: SamplingMode = "fixed";
  private minSamplingRate = 0;
  private samplingLogTransitions = true;
  private adaptiveSamplingController?: AdaptiveSamplingController;
  private adaptiveSamplingInterval: NodeJS.Timeout | null = null;
  private eventLoopDelayHistogram: IntervalHistogram | null = null;
  private effectiveMemoryLimitBytes: number | null = null;
  private cliConnectionPromise: Promise<void> | null = null;
  private isConnectedWithCLI = false;
  spanExporter?: TdSpanExporter;
  private driftBatchSpanProcessor?: DriftBatchSpanProcessor;

  constructor() {
    this.mode = this.detectMode();
    this.config = loadTuskConfig() || {};
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

    if (isCommonJS()) {
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

  private logRustCoreStartupStatus(): void {
    const status = getRustCoreStartupStatus();
    const envDisplay = status.rawEnv ?? "<unset>";

    if (status.reason === "invalid_env_value_defaulted") {
      logger.warn(
        `Invalid TUSK_USE_RUST_CORE value '${envDisplay}'; defaulting to enabled rust core path.`,
      );
    }

    if (!status.enabled) {
      logger.info(
        `Rust core path disabled at startup (env=${envDisplay}, reason=${status.reason}).`,
      );
      return;
    }

    if (status.bindingLoaded) {
      logger.info(
        `Rust core path enabled at startup (env=${envDisplay}, reason=${status.reason}).`,
      );
      return;
    }

    logger.info(
      `Rust core path unavailable at startup; using JavaScript path instead (env=${envDisplay}, reason=${status.reason}, error=${status.bindingError}).`,
    );
  }

  private logStartupSummary(): void {
    const serviceName = this.config.service?.name || "unknown";
    const serviceId = this.config.service?.id || "<unset>";
    const environment = this.initParams.env || "<unset>";
    const exportSpans = this.config.recording?.export_spans || false;

    logger.info(
      `SDK initialized successfully (version=${SDK_VERSION}, mode=${this.mode}, env=${environment}, service=${serviceName}, serviceId=${serviceId}, exportSpans=${exportSpans}, samplingMode=${this.samplingMode}, samplingBaseRate=${this.samplingRate}, samplingMinRate=${this.minSamplingRate}, samplingLogTransitions=${this.samplingLogTransitions}, logLevel=${logger.getLogLevel()}, runtime=node ${process.version}, platform=${process.platform}/${process.arch}).`,
    );
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

  private validateSamplingMode(value: string | undefined, source: string): value is SamplingMode {
    if (!value) {
      return false;
    }

    if (value === "fixed" || value === "adaptive") {
      return true;
    }

    logger.warn(
      `Invalid sampling mode from ${source}: ${value}. Must be 'fixed' or 'adaptive'. Ignoring.`,
    );
    return false;
  }

  private determineSamplingConfig(initParams: InitParams): {
    mode: SamplingMode;
    baseRate: number;
    minRate: number;
    logTransitions: boolean;
  } {
    const configSampling = this.config.recording?.sampling;

    let mode: SamplingMode = "fixed";
    if (this.validateSamplingMode(configSampling?.mode, "config.yaml")) {
      mode = configSampling!.mode!;
    }

    let baseRate: number | undefined;
    if (initParams.samplingRate !== undefined) {
      if (this.validateSamplingRate(initParams.samplingRate, "init params")) {
        logger.debug(`Using sampling rate from init params: ${initParams.samplingRate}`);
        baseRate = initParams.samplingRate;
      }
    }

    if (baseRate === undefined) {
      for (const envVarName of ["TUSK_RECORDING_SAMPLING_RATE", "TUSK_SAMPLING_RATE"] as const) {
        const envSamplingRate = OriginalGlobalUtils.getOriginalProcessEnvVar(envVarName);
        if (envSamplingRate === undefined) {
          continue;
        }

        const parsed = parseFloat(envSamplingRate);
        if (this.validateSamplingRate(parsed, `${envVarName} env var`)) {
          logger.debug(`Using sampling rate from ${envVarName} env var: ${parsed}`);
          baseRate = parsed;
          break;
        }
      }
    }

    if (baseRate === undefined && configSampling?.base_rate !== undefined) {
      if (this.validateSamplingRate(configSampling.base_rate, "config.yaml recording.sampling.base_rate")) {
        baseRate = configSampling.base_rate;
      }
    }

    if (baseRate === undefined && this.config.recording?.sampling_rate !== undefined) {
      if (this.validateSamplingRate(this.config.recording.sampling_rate, "config.yaml recording.sampling_rate")) {
        baseRate = this.config.recording.sampling_rate;
      }
    }

    if (baseRate === undefined) {
      logger.debug("Using default sampling rate: 1.0");
      baseRate = 1;
    }

    let minRate = 0;
    if (mode === "adaptive") {
      if (configSampling?.min_rate !== undefined) {
        if (this.validateSamplingRate(configSampling.min_rate, "config.yaml recording.sampling.min_rate")) {
          minRate = configSampling.min_rate;
        }
      } else {
        minRate = 0.001;
      }

      minRate = Math.min(baseRate, minRate);
    }

    let logTransitions = true;
    const envLogTransitions = OriginalGlobalUtils.getOriginalProcessEnvVar(
      "TUSK_RECORDING_SAMPLING_LOG_TRANSITIONS",
    );
    if (envLogTransitions !== undefined) {
      const parsed = this.parseBooleanSetting(
        envLogTransitions,
        "TUSK_RECORDING_SAMPLING_LOG_TRANSITIONS env var",
      );
      if (parsed !== undefined) {
        logger.debug(
          `Using adaptive sampling log_transitions from TUSK_RECORDING_SAMPLING_LOG_TRANSITIONS env var: ${parsed}`,
        );
        logTransitions = parsed;
      }
    } else if (configSampling?.log_transitions !== undefined) {
      if (typeof configSampling.log_transitions === "boolean") {
        logTransitions = configSampling.log_transitions;
      } else {
        logger.warn(
          `Invalid sampling.log_transitions in config.yaml: expected boolean, got ${typeof configSampling.log_transitions}. Ignoring.`,
        );
      }
    }

    return {
      mode,
      baseRate,
      minRate,
      logTransitions,
    };
  }

  private parseBooleanSetting(value: string, source: string): boolean | undefined {
    const normalizedValue = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalizedValue)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalizedValue)) {
      return false;
    }

    logger.warn(`Invalid ${source}: ${value}. Expected one of true/false/1/0/yes/no/on/off.`);
    return undefined;
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

    new RedisInstrumentation({
      enabled: true,
      mode: this.mode,
    });

    new UpstashRedisInstrumentation({
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

    new MysqlInstrumentation({
      enabled: true,
      mode: this.mode,
    });

    new MongodbInstrumentation({
      enabled: true,
      mode: this.mode,
    });
  }

  private initializeTracing({ baseDirectory }: { baseDirectory: string }): void {
    const serviceName = this.config.service?.name || "unknown";
    const batchProcessorConfig = {
      maxQueueSize: 2048,
      maxExportBatchSize: 512,
      scheduledDelayMillis: 2000,
    };

    logger.debug(`Initializing OpenTelemetry tracing for service: ${serviceName}`);

    this.spanExporter = new TdSpanExporter({
      baseDirectory,
      mode: this.mode,
      useRemoteExport: this.config.recording?.export_spans || false,
      observableServiceId: this.config.service?.id,
      apiKey: this.initParams.apiKey,
      tuskBackendBaseUrl: this.config.tusk_api?.url || "https://api.usetusk.ai",
      environment: this.initParams.env,
      sdkVersion: SDK_VERSION,
      sdkInstanceId: this.generateSdkInstanceId(),
      exportTimeoutMillis: 30000,
    });

    this.driftBatchSpanProcessor = new DriftBatchSpanProcessor({
      exporter: this.spanExporter,
      config: batchProcessorConfig,
      mode: this.mode,
    });

    const tracerProvider = new NodeTracerProvider({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: serviceName,
      }),
      spanProcessors: [this.driftBatchSpanProcessor],
    });

    // Register the tracer provider
    tracerProvider.register();
    logger.debug(`OpenTelemetry tracing initialized`);
  }

  private generateSdkInstanceId(): string {
    const originalDate = OriginalGlobalUtils.getOriginalDate();
    return `sdk-${originalDate.getTime()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private startAdaptiveSamplingController(): void {
    if (this.mode !== TuskDriftMode.RECORD || this.samplingMode !== "adaptive") {
      return;
    }

    this.adaptiveSamplingController = new AdaptiveSamplingController({
      mode: this.samplingMode,
      baseRate: this.samplingRate,
      minRate: this.minSamplingRate,
    }, {
      logTransitions: this.samplingLogTransitions,
    });

    this.effectiveMemoryLimitBytes = this.detectEffectiveMemoryLimitBytes();

    this.eventLoopDelayHistogram = monitorEventLoopDelay({
      resolution: 20,
    });
    this.eventLoopDelayHistogram.enable();

    this.adaptiveSamplingInterval = setInterval(() => {
      this.updateAdaptiveSamplingHealth();
    }, 2000);
    this.adaptiveSamplingInterval.unref?.();

    this.updateAdaptiveSamplingHealth();
  }

  private updateAdaptiveSamplingHealth(): void {
    if (!this.adaptiveSamplingController) {
      return;
    }

    const batchHealth = this.driftBatchSpanProcessor?.getHealthSnapshot();
    const exporterHealth = this.spanExporter?.getHealthSnapshot();

    const eventLoopLagP95Ms =
      this.eventLoopDelayHistogram && this.eventLoopDelayHistogram.exceeds > 0
        ? this.eventLoopDelayHistogram.percentile(95) / 1_000_000
        : this.eventLoopDelayHistogram
          ? this.eventLoopDelayHistogram.percentile(95) / 1_000_000
          : null;

    this.eventLoopDelayHistogram?.reset();

    this.adaptiveSamplingController.update({
      queueFillRatio: batchHealth?.queueFillRatio ?? null,
      droppedSpanCount: batchHealth?.droppedSpanCount ?? 0,
      exportFailureCount:
        (batchHealth?.exportFailureCount ?? 0) + (exporterHealth?.failureCount ?? 0),
      exportTimeoutCount: exporterHealth?.timeoutCount ?? 0,
      exportCircuitOpen: exporterHealth?.circuitOpen ?? false,
      eventLoopLagP95Ms,
      memoryPressureRatio: this.getMemoryPressureRatio(),
    });
  }

  private stopAdaptiveSamplingController(): void {
    if (this.adaptiveSamplingInterval) {
      clearInterval(this.adaptiveSamplingInterval);
      this.adaptiveSamplingInterval = null;
    }

    if (this.eventLoopDelayHistogram) {
      this.eventLoopDelayHistogram.disable();
      this.eventLoopDelayHistogram = null;
    }
  }

  private detectEffectiveMemoryLimitBytes(): number | null {
    const candidates = [
      "/sys/fs/cgroup/memory.max",
      "/sys/fs/cgroup/memory/memory.limit_in_bytes",
    ];

    for (const filePath of candidates) {
      const parsed = this.readNumericControlFile(filePath);
      if (parsed === null) {
        continue;
      }
      if (parsed <= 0 || parsed > 1_000_000_000_000_000) {
        continue;
      }
      return parsed;
    }

    return null;
  }

  private getMemoryPressureRatio(): number | null {
    if (!this.effectiveMemoryLimitBytes || this.effectiveMemoryLimitBytes <= 0) {
      return null;
    }

    const cgroupCurrent = this.readNumericControlFile("/sys/fs/cgroup/memory.current");
    if (cgroupCurrent !== null) {
      return cgroupCurrent / this.effectiveMemoryLimitBytes;
    }

    const cgroupV1Current = this.readNumericControlFile("/sys/fs/cgroup/memory/memory.usage_in_bytes");
    if (cgroupV1Current !== null) {
      return cgroupV1Current / this.effectiveMemoryLimitBytes;
    }

    return process.memoryUsage().rss / this.effectiveMemoryLimitBytes;
  }

  private readNumericControlFile(filePath: string): number | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const rawValue = fs.readFileSync(filePath, "utf8").trim();
      if (!rawValue || rawValue === "max") {
        return null;
      }

      const parsed = Number.parseInt(rawValue, 10);
      return Number.isFinite(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  executeWithoutRecording<T>(fn: () => T): T {
    const suppressedContext = context
      .active()
      .setValue(STOP_RECORDING_CHILD_SPANS_CONTEXT_KEY, true);
    return context.with(suppressedContext, fn);
  }

  shouldRecordRootRequest({ isPreAppStart }: { isPreAppStart: boolean }): RootSamplingDecision {
    if (this.adaptiveSamplingController) {
      return this.adaptiveSamplingController.getDecision({
        isPreAppStart,
      });
    }

    if (isPreAppStart) {
      return {
        shouldRecord: true,
        reason: "pre_app_start",
        mode: this.samplingMode,
        state: "fixed",
        baseRate: this.samplingRate,
        minRate: this.minSamplingRate,
        effectiveRate: 1,
        admissionMultiplier: 1,
      };
    }

    const shouldRecord = Math.random() < this.samplingRate;
    return {
      shouldRecord,
      reason: shouldRecord ? "sampled" : "not_sampled",
      mode: this.samplingMode,
      state: "fixed",
      baseRate: this.samplingRate,
      minRate: this.minSamplingRate,
      effectiveRate: this.samplingRate,
      admissionMultiplier: 1,
    };
  }

  /**
   * Creates a pre-app-start span containing a snapshot of all environment variables.
   * Only runs in RECORD mode when env var recording is enabled.
   */
  private createEnvVarsSnapshot(): void {
    // Only create snapshot in RECORD mode and if env var recording is enabled
    if (this.mode !== TuskDriftMode.RECORD || !this.config.recording?.enable_env_var_recording) {
      return;
    }

    try {
      // Capture all env vars from process.env
      const envVarsSnapshot: Record<string, string | undefined> = {};
      for (const key of Object.keys(process.env)) {
        envVarsSnapshot[key] = process.env[key];
      }

      logger.debug(
        `Creating env vars snapshot with ${Object.keys(envVarsSnapshot).length} variables`,
      );

      // Create a span to hold the env vars snapshot
      SpanUtils.createAndExecuteSpan(
        this.mode,
        () => {}, // No-op function since this is just a metadata snapshot
        {
          name: "ENV_VARS_SNAPSHOT",
          kind: SpanKind.INTERNAL,
          packageName: "process.env",
          packageType: PackageType.UNSPECIFIED,
          instrumentationName: "TuskDriftCore",
          submodule: "env",
          inputValue: {},
          outputValue: {
            ENV_VARS: envVarsSnapshot,
          },
          isPreAppStart: true,
        },
        (spanInfo) => {
          // Span is created with metadata, just end it immediately
          SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          logger.debug(`Env vars snapshot span created: ${spanInfo.spanId}`);
        },
      );
    } catch (error) {
      logger.error("Failed to create env vars snapshot:", error);
    }
  }

  initialize(initParams: InitParams): void {
    // Initialize logging with provided level or default to 'info'
    initializeGlobalLogger({
      logLevel: initParams.logLevel || "info",
      prefix: "TuskDrift",
    });

    this.initParams = initParams;

    if (this.initialized) {
      logger.debug("Already initialized, skipping...");
      return;
    }

    // Coverage snapshot handling is done via the protobuf channel (ProtobufCommunicator).
    // NODE_V8_COVERAGE env var enables V8 coverage collection at the process level.

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

    if (this.mode === TuskDriftMode.DISABLED) {
      logger.debug("SDK disabled via environment variable");
      return;
    }

    if (initParams.registerEsmLoaderHooks !== false) {
      initializeEsmLoader();
    }

    this.logRustCoreStartupStatus();
    logger.debug(`Initializing in ${this.mode} mode`);

    if (!this.initParams.env) {
      const nodeEnv = OriginalGlobalUtils.getOriginalProcessEnvVar("NODE_ENV") || "development";
      logger.warn(
        `Environment not provided in initialization parameters. Using '${nodeEnv}' as the environment.`,
      );
      this.initParams.env = nodeEnv;
    }

    const samplingConfig = this.determineSamplingConfig(initParams);
    this.samplingMode = samplingConfig.mode;
    this.samplingRate = samplingConfig.baseRate;
    this.minSamplingRate = samplingConfig.minRate;
    this.samplingLogTransitions = samplingConfig.logTransitions;

    // Need to have observable service id if exporting spans to Tusk backend
    if (this.config.recording?.export_spans && !this.config.service?.id) {
      logger.error(
        "Observable service ID not provided. Please provide an observable service ID in the configuration file.",
      );
      return;
    }

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

        // Check if socket exists
        if (!fs.existsSync(socketPath)) {
          throw new Error(`Socket not found at ${socketPath}. Make sure Tusk CLI is running.`);
        }
        logger.debug("Socket found at", socketPath);

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
    this.startAdaptiveSamplingController();

    // Create env vars snapshot span (only in RECORD mode with env var recording enabled)
    this.createEnvVarsSnapshot();

    this.initialized = true;
    this.logStartupSummary();
  }

  // Coverage snapshot handling is now done via the protobuf communication channel
  // (ProtobufCommunicator.handleCoverageSnapshotRequest). No separate HTTP server needed.
  // NODE_V8_COVERAGE env var is still required for V8 to collect coverage data.

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

  private createMockRequestCore(): MockResponseOutput | null {
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

  async requestMockAsync(mockRequest: MockRequestInput): Promise<MockResponseOutput> {
    if (this.cliConnectionPromise && !this.isConnectedWithCLI) {
      logger.debug("Waiting for CLI connection to be established");
      await this.cliConnectionPromise;
    }

    const mockRequestCore = this.createMockRequestCore();
    if (mockRequestCore) {
      return mockRequestCore;
    }
    return this.requestMockFromCLIAsync(mockRequest);
  }

  private async requestMockFromCLIAsync(
    mockRequest: MockRequestInput,
  ): Promise<MockResponseOutput> {
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
      return response;
    } catch (error) {
      logger.error("Error sending protobuf request to CLI:", error);
      return {
        found: false,
        error: `Error sending request: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  requestMockSync(mockRequest: MockRequestInput): MockResponseOutput {
    if (!this.isConnectedWithCLI) {
      // We cannot await for the CLI to be connected like we do in requestMockAsync since it's a synchronous call
      // That means this function will likely throw an error if the first mock requested needs to be sync
      // This is a limitation of the current implementation and will be fixed in the future
      logger.error("Requesting sync mock but CLI is not ready yet");
      throw new Error("Requesting sync mock but CLI is not ready yet");
    }

    const mockRequestCore = this.createMockRequestCore();
    if (mockRequestCore) {
      return mockRequestCore;
    }
    return this.requestMockFromCLISync(mockRequest);
  }

  private requestMockFromCLISync(mockRequest: MockRequestInput): MockResponseOutput {
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

  getEnvironment(): string | undefined {
    return this.initParams.env;
  }

  getTracer(): Tracer {
    return trace.getTracer(TD_INSTRUMENTATION_LIBRARY_NAME);
  }

  getProtobufCommunicator(): ProtobufCommunicator | undefined {
    return this.communicator;
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
   *   - samplingRate?: number - Optional sampling rate (0.0-1.0) for recording requests. Overrides TUSK_RECORDING_SAMPLING_RATE, the legacy TUSK_SAMPLING_RATE alias, and config.yaml. Defaults to 1.0
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
