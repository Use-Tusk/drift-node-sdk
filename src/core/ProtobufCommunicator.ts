import net from "net";
import { MIN_CLI_VERSION, SDK_VERSION } from "../version";
import { execSync } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
import {
  CLIMessage,
  MessageType,
  GetMockRequest,
  GetMockResponse,
  ConnectRequest,
  SDKMessage,
  SendInboundSpanForReplayRequest,
  SendAlertRequest,
  InstrumentationVersionMismatchAlert,
  UnpatchedDependencyAlert,
  EnvVarRequest,
  EnvVarResponse,
} from "@use-tusk/drift-schemas/core/communication";
import { context, Context, SpanKind as OtSpanKind } from "@opentelemetry/api";
import { Value } from "@use-tusk/drift-schemas/google/protobuf/struct";
import { CleanSpanData, CALLING_LIBRARY_CONTEXT_KEY } from "./types";
import { Span } from "@use-tusk/drift-schemas/core/span";
import { logger, objectToProtobufStruct, toStruct, mapOtToPb, OriginalGlobalUtils } from "./utils";

export interface MockRequestInput {
  testId: string;
  outboundSpan: CleanSpanData;
}

interface MockResponseOutput {
  found: boolean;
  response?: Record<string, unknown>;
  error?: string;
}

export class ProtobufCommunicator {
  /**
   * Shared child process script for synchronous protobuf requests.
   * This script establishes its own connection to the CLI and handles async socket communication.
   */
  private static readonly SYNC_CHILD_SCRIPT = `
const net = require('net');
const fs = require('fs');

const requestFile = process.argv[2];
const responseFile = process.argv[3];
const config = JSON.parse(process.argv[4]);

let responseReceived = false;
let timeoutId;

function cleanup(exitCode) {
  if (timeoutId) clearTimeout(timeoutId);
  process.exit(exitCode);
}

try {
  // Read the request data
  const requestData = fs.readFileSync(requestFile);

  // Create connection based on config
  const client = config.type === 'unix'
    ? net.createConnection({ path: config.path })
    : net.createConnection({ host: config.host, port: config.port });

  const incomingChunks = [];
  let incomingBuffer = Buffer.alloc(0);

  // Set timeout
  timeoutId = setTimeout(() => {
    if (!responseReceived) {
      console.error('Timeout waiting for response');
      client.destroy();
      cleanup(1);
    }
  }, 10000);

  client.on('connect', () => {
    // Send the request
    client.write(requestData);
  });

  client.on('data', (data) => {
    incomingBuffer = Buffer.concat([incomingBuffer, data]);

    // Try to parse complete message (4 byte length prefix + message)
    while (incomingBuffer.length >= 4) {
      const messageLength = incomingBuffer.readUInt32BE(0);

      if (incomingBuffer.length < 4 + messageLength) {
        // Incomplete message, wait for more data
        break;
      }

      // We have a complete message
      const messageData = incomingBuffer.slice(4, 4 + messageLength);
      incomingBuffer = incomingBuffer.slice(4 + messageLength);

      // Write the complete response (including length prefix)
      const lengthPrefix = Buffer.allocUnsafe(4);
      lengthPrefix.writeUInt32BE(messageLength, 0);
      fs.writeFileSync(responseFile, Buffer.concat([lengthPrefix, messageData]));

      responseReceived = true;
      client.destroy();
      cleanup(0);
      break;
    }
  });

  client.on('error', (err) => {
    if (!responseReceived) {
      console.error('Connection error:', err.message);
      cleanup(1);
    }
  });

  client.on('close', () => {
    if (!responseReceived) {
      console.error('Connection closed without response');
      cleanup(1);
    }
  });

} catch (err) {
  console.error('Script error:', err.message);
  cleanup(1);
}
`;

  private client: net.Socket | null = null;
  private pendingRequests = new Map<
    string,
    {
      resolve: (response: any) => void;
      reject: (error: Error) => void;
    }
  >();
  private incomingBuffer = Buffer.alloc(0);
  // Store the context when connecting and reuse it
  private protobufContext: Context | null = null;

  private makeConnection(
    connectionInfo: { socketPath: string } | { host: string; port: number },
    callback: () => void,
  ) {
    const currentContext = context.active();
    this.protobufContext = currentContext.setValue(
      CALLING_LIBRARY_CONTEXT_KEY,
      "ProtobufCommunicator",
    );

    // Create connection in context so TCP instrumentation knows to ignore these TCP calls
    return context.with(this.protobufContext, () => {
      if ("socketPath" in connectionInfo) {
        // Unix socket connection
        this.client = net.createConnection(connectionInfo.socketPath, callback);
      } else {
        // TCP connection
        this.client = net.createConnection(
          { host: connectionInfo.host, port: connectionInfo.port },
          callback,
        );
      }
    });
  }

  async connect(
    connectionInfo: { socketPath: string } | { host: string; port: number },
    serviceId: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.makeConnection(connectionInfo, () => {
        const connType = "socketPath" in connectionInfo ? "Unix socket" : "TCP";
        logger.debug(`Connected to CLI via protobuf (${connType})`);
        this.sendConnectMessage(serviceId).then(resolve).catch(reject);
      });

      this.client?.on("error", (err) => {
        logger.error("Connection error:", err);
        reject(err);
      });

      this.client?.on("data", (data) => {
        this.handleIncomingData(data);
      });

      this.client?.on("timeout", () => {
        logger.error("Connection timeout");
        reject(new Error("Connection timeout"));
      });

      this.client?.on("end", () => {
        logger.debug("Connection to CLI ended");
      });

      this.client?.on("close", () => {
        logger.debug("Connection to CLI closed");
        // Reject all pending requests
        for (const [requestId, { reject }] of this.pendingRequests) {
          reject(new Error("Connection closed before response received"));
        }
        this.pendingRequests.clear();
      });
    });
  }

  private async sendConnectMessage(serviceId: string): Promise<void> {
    const connectRequest = ConnectRequest.create({
      serviceId,
      sdkVersion: SDK_VERSION,
      minCliVersion: MIN_CLI_VERSION,
    });

    const sdkMessage = SDKMessage.create({
      type: MessageType.SDK_CONNECT,
      requestId: this.generateRequestId(),
      payload: {
        oneofKind: "connectRequest",
        connectRequest,
      },
    });

    await this.sendProtobufMessage(sdkMessage);

    // SDK awaits CLI's decision
    // If CLI accepts -> connection proceeds
    // If CLI rejects -> CLI closes the connection and terminates the service.
  }

  private getStackTrace(): string {
    Error.stackTraceLimit = 100;
    const s = new Error().stack || "";
    Error.stackTraceLimit = 10;
    return s
      .split("\n")
      .slice(2)
      .filter((l) => !l.includes("ProtobufCommunicator"))
      .join("\n");
  }

  async requestMockAsync(mockRequest: MockRequestInput): Promise<MockResponseOutput> {
    const requestId = this.generateRequestId();

    // Clean the input data to remove undefined values
    const cleanSpan = mockRequest.outboundSpan
      ? this.cleanSpan(mockRequest.outboundSpan)
      : undefined;

    // Convert inputValue to protobuf Struct format
    if (cleanSpan?.inputValue) {
      cleanSpan.inputValue = objectToProtobufStruct(cleanSpan.inputValue);
    }

    // Convert inputSchema to protobuf Struct format
    if (cleanSpan?.inputSchema) {
      cleanSpan.inputSchema = objectToProtobufStruct(cleanSpan.inputSchema);
    }

    // Convert kind to protobuf format
    if (cleanSpan?.kind) {
      cleanSpan.kind = mapOtToPb(cleanSpan.kind as OtSpanKind);
    }

    const protoMockRequest = GetMockRequest.create({
      ...mockRequest,
      requestId,
      tags: {},
      outboundSpan: cleanSpan,
      stackTrace: cleanSpan?.stackTrace,
    });

    const sdkMessage: SDKMessage = SDKMessage.create({
      type: MessageType.MOCK_REQUEST,
      requestId: requestId,
      payload: {
        oneofKind: "getMockRequest",
        getMockRequest: protoMockRequest,
      },
    });

    logger.debug(
      `[ProtobufCommunicator] Creating mock request with requestId: ${requestId}, testId: ${mockRequest.testId}`,
    );

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
      this.sendProtobufMessage(sdkMessage).catch(reject);
    });
  }

  /**
   * Request environment variables from CLI synchronously using a child process.
   * This blocks the main thread, so it should be used carefully.
   * Similar to requestMockSync but for environment variables.
   */
  requestEnvVarsSync(traceTestServerSpanId: string): Record<string, string> {
    const requestId = this.generateRequestId();

    const envVarRequest = EnvVarRequest.create({
      traceTestServerSpanId,
    });

    const sdkMessage = SDKMessage.create({
      type: MessageType.ENV_VAR_REQUEST,
      requestId: requestId,
      payload: {
        oneofKind: "envVarRequest",
        envVarRequest,
      },
    });

    logger.debug(
      `[ProtobufCommunicator] Requesting env vars (sync) for trace: ${traceTestServerSpanId}`,
    );

    // Serialize the message to binary
    const messageBytes = SDKMessage.toBinary(sdkMessage);

    // Create temporary file for the request and response
    const tempDir = os.tmpdir();
    const requestFile = path.join(tempDir, `tusk-sync-envvar-request-${requestId}.bin`);
    const responseFile = path.join(tempDir, `tusk-sync-envvar-response-${requestId}.bin`);
    const scriptFile = path.join(tempDir, `tusk-sync-envvar-script-${requestId}.js`);

    try {
      // Write length prefix (4 bytes big-endian) + message to temp file
      const lengthBuffer = Buffer.allocUnsafe(4);
      lengthBuffer.writeUInt32BE(messageBytes.length, 0);
      const fullMessage = Buffer.concat([lengthBuffer, Buffer.from(messageBytes)]);
      fs.writeFileSync(requestFile, fullMessage);

      // Determine connection method (Unix socket or TCP)
      const mockSocket = OriginalGlobalUtils.getOriginalProcessEnvVar("TUSK_MOCK_SOCKET");
      const mockHost = OriginalGlobalUtils.getOriginalProcessEnvVar("TUSK_MOCK_HOST");
      const mockPort = OriginalGlobalUtils.getOriginalProcessEnvVar("TUSK_MOCK_PORT");

      let connectionConfig: any;
      if (mockSocket) {
        connectionConfig = { type: "unix", path: mockSocket };
      } else if (mockHost && mockPort) {
        connectionConfig = { type: "tcp", host: mockHost, port: parseInt(mockPort, 10) };
      } else {
        const socketPath = path.join(os.tmpdir(), "tusk-connect.sock");
        connectionConfig = { type: "unix", path: socketPath };
      }

      // Write the script to a file
      fs.writeFileSync(scriptFile, ProtobufCommunicator.SYNC_CHILD_SCRIPT);

      try {
        // Execute the child process synchronously using execSync
        execSync(
          `node "${scriptFile}" "${requestFile}" "${responseFile}" '${JSON.stringify(connectionConfig)}'`,
          {
            timeout: 12000, // Slightly longer than the child's timeout
            stdio: "pipe",
          },
        );

        // Read the response from the file
        const responseBuffer = fs.readFileSync(responseFile);

        // Parse the response (4 byte length prefix + message)
        if (responseBuffer.length < 4) {
          throw new Error("Invalid response: too short");
        }

        const responseLength = responseBuffer.readUInt32BE(0);
        if (responseBuffer.length < 4 + responseLength) {
          throw new Error("Invalid response: incomplete message");
        }

        const responseData = responseBuffer.slice(4, 4 + responseLength);
        const cliMessage = CLIMessage.fromBinary(responseData);

        if (cliMessage.payload.oneofKind !== "envVarResponse") {
          throw new Error(`Unexpected response type: ${cliMessage.type}`);
        }

        const envVarResponse = cliMessage.payload.envVarResponse;
        if (!envVarResponse) {
          throw new Error("No env var response received");
        }

        // Convert protobuf map to Record<string, string>
        const envVars: Record<string, string> = {};
        if (envVarResponse.envVars) {
          Object.entries(envVarResponse.envVars).forEach(([key, value]) => {
            envVars[key] = value;
          });
        }

        logger.debug(
          `[ProtobufCommunicator] Received env vars (sync), count: ${Object.keys(envVars).length}`,
        );
        return envVars;
      } catch (error: any) {
        logger.error("[ProtobufCommunicator] error in sync env var request child process:", error);
        throw error;
      }
    } catch (error: any) {
      throw new Error(`Sync env var request failed: ${error.message}`);
    } finally {
      // Clean up temp files
      try {
        if (fs.existsSync(requestFile)) fs.unlinkSync(requestFile);
      } catch (e) {
        logger.error("[ProtobufCommunicator] error cleaning up request file:", e);
      }
      try {
        if (fs.existsSync(responseFile)) fs.unlinkSync(responseFile);
      } catch (e) {
        logger.error("[ProtobufCommunicator] error cleaning up response file:", e);
      }
      try {
        if (fs.existsSync(scriptFile)) fs.unlinkSync(scriptFile);
      } catch (e) {
        logger.error("[ProtobufCommunicator] error cleaning up script file:", e);
      }
    }
  }

  /**
   * This function uses a separate Node.js child process to communicate with the CLI over a socket.
   * The child process creates its own connection and event loop, allowing proper async socket handling.
   * The parent process blocks synchronously waiting for the child to complete.
   *
   * Since this function blocks the main thread, there is a performance impact. We should use requestMockAsync whenever possible and only use this function
   * for instrumentations that require fetching mocks synchronously.
   */
  requestMockSync(mockRequest: MockRequestInput): MockResponseOutput {
    const requestId = this.generateRequestId();

    // Clean the input data to remove undefined values
    const cleanSpan = mockRequest.outboundSpan
      ? this.cleanSpan(mockRequest.outboundSpan)
      : undefined;

    // Convert inputValue to protobuf Struct format
    if (cleanSpan?.inputValue) {
      cleanSpan.inputValue = objectToProtobufStruct(cleanSpan.inputValue);
    }

    // Convert inputSchema to protobuf Struct format
    if (cleanSpan?.inputSchema) {
      cleanSpan.inputSchema = objectToProtobufStruct(cleanSpan.inputSchema);
    }

    // Convert kind to protobuf format
    if (cleanSpan?.kind) {
      cleanSpan.kind = mapOtToPb(cleanSpan.kind as OtSpanKind);
    }

    const protoMockRequest = GetMockRequest.create({
      ...mockRequest,
      requestId,
      tags: {},
      outboundSpan: cleanSpan,
      stackTrace: cleanSpan?.stackTrace,
    });

    const sdkMessage = SDKMessage.create({
      type: MessageType.MOCK_REQUEST,
      requestId: requestId,
      payload: {
        oneofKind: "getMockRequest",
        getMockRequest: protoMockRequest,
      },
    });

    logger.debug("Sending protobuf request to CLI (sync)", {
      outboundSpan: mockRequest.outboundSpan,
      testId: mockRequest.testId,
    });

    // Serialize the message to binary
    const messageBytes = SDKMessage.toBinary(sdkMessage);

    // Create temporary file for the request and response
    const tempDir = os.tmpdir();
    const requestFile = path.join(tempDir, `tusk-sync-request-${requestId}.bin`);
    const responseFile = path.join(tempDir, `tusk-sync-response-${requestId}.bin`);
    const scriptFile = path.join(tempDir, `tusk-sync-script-${requestId}.js`);

    try {
      // Write length prefix (4 bytes big-endian) + message to temp file
      const lengthBuffer = Buffer.allocUnsafe(4);
      lengthBuffer.writeUInt32BE(messageBytes.length, 0);
      const fullMessage = Buffer.concat([lengthBuffer, Buffer.from(messageBytes)]);
      fs.writeFileSync(requestFile, fullMessage);

      // Determine connection method
      const mockSocket = OriginalGlobalUtils.getOriginalProcessEnvVar("TUSK_MOCK_SOCKET");
      const mockHost = OriginalGlobalUtils.getOriginalProcessEnvVar("TUSK_MOCK_HOST");
      const mockPort = OriginalGlobalUtils.getOriginalProcessEnvVar("TUSK_MOCK_PORT");

      let connectionConfig: any;
      if (mockSocket) {
        connectionConfig = { type: "unix", path: mockSocket };
      } else if (mockHost && mockPort) {
        connectionConfig = { type: "tcp", host: mockHost, port: parseInt(mockPort, 10) };
      } else {
        const socketPath = path.join(os.tmpdir(), "tusk-connect.sock");
        connectionConfig = { type: "unix", path: socketPath };
      }

      // Write the script to a file
      fs.writeFileSync(scriptFile, ProtobufCommunicator.SYNC_CHILD_SCRIPT);

      try {
        // Execute the child process synchronously
        execSync(
          `node "${scriptFile}" "${requestFile}" "${responseFile}" '${JSON.stringify(connectionConfig)}'`,
          {
            timeout: 12000, // Slightly longer than the child's timeout
            stdio: "pipe",
          },
        );

        // Read the response
        const responseBuffer = fs.readFileSync(responseFile);

        // Parse the response
        if (responseBuffer.length < 4) {
          throw new Error("Invalid response: too short");
        }

        const responseLength = responseBuffer.readUInt32BE(0);
        if (responseBuffer.length < 4 + responseLength) {
          throw new Error("Invalid response: incomplete message");
        }

        const responseData = responseBuffer.slice(4, 4 + responseLength);
        const cliMessage = CLIMessage.fromBinary(responseData);

        if (cliMessage.payload.oneofKind !== "getMockResponse") {
          throw new Error(`Unexpected response type: ${cliMessage.type}`);
        }

        const mockResponse = cliMessage.payload.getMockResponse;
        if (!mockResponse) {
          throw new Error("No mock response received");
        }

        if (mockResponse.found) {
          try {
            const responseData = this.extractResponseData(mockResponse);
            return {
              found: true,
              response: responseData,
            };
          } catch (error) {
            throw new Error(`Failed to extract response data: ${error}`);
          }
        } else {
          return {
            found: false,
            error: mockResponse.error || "Mock not found",
          };
        }
      } catch (error: any) {
        logger.error("[ProtobufCommunicator] error in sync request child process:", error);
        throw error;
      }
    } catch (error: any) {
      throw new Error(`Sync request failed: ${error.message}`);
    } finally {
      // Clean up temp files
      try {
        if (fs.existsSync(requestFile)) fs.unlinkSync(requestFile);
      } catch (e) {
        logger.error("[ProtobufCommunicator] error cleaning up request file:", e);
      }
      try {
        if (fs.existsSync(responseFile)) fs.unlinkSync(responseFile);
      } catch (e) {
        logger.error("[ProtobufCommunicator] error cleaning up response file:", e);
      }
      try {
        if (fs.existsSync(scriptFile)) fs.unlinkSync(scriptFile);
      } catch (e) {
        logger.error("[ProtobufCommunicator] error cleaning up script file:", e);
      }
    }
  }

  private async sendProtobufMessage(message: SDKMessage): Promise<void> {
    if (!this.client || !this.protobufContext) {
      throw new Error("Not connected to CLI");
    }

    const messageBytes = SDKMessage.toBinary(message);
    const lengthBuffer = Buffer.allocUnsafe(4);
    lengthBuffer.writeUInt32BE(messageBytes.length, 0);

    // Send message in context so TCP instrumentation knows to ignore these TCP calls
    context.with(this.protobufContext, () => {
      this.client!.write(lengthBuffer);
      this.client!.write(Buffer.from(messageBytes));
    });
  }

  async sendInboundSpanForReplay(span: CleanSpanData): Promise<void> {
    if (!this.client) return;

    const pbSpan = Span.create({
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId || "",
      name: span.name || "",
      packageName: span.packageName,
      instrumentationName: span.instrumentationName,
      submoduleName: span.submoduleName || "",
      inputValue: toStruct(span.inputValue),
      outputValue: toStruct(span.outputValue),
      inputSchema: span.inputSchema,
      outputSchema: span.outputSchema,
      inputSchemaHash: span.inputSchemaHash || "",
      outputSchemaHash: span.outputSchemaHash || "",
      inputValueHash: span.inputValueHash || "",
      outputValueHash: span.outputValueHash || "",
      kind: mapOtToPb(span.kind as OtSpanKind),
      status: { code: span.status.code, message: span.status.message || "" },
      timestamp: span.timestamp
        ? { seconds: BigInt(span.timestamp.seconds), nanos: span.timestamp.nanos }
        : undefined,
      isRootSpan: span.isRootSpan ?? false,
      metadata: toStruct(span.metadata),
      packageType: span.packageType,
    });

    const req = SendInboundSpanForReplayRequest.create({ span: pbSpan });

    const sdkMessage = SDKMessage.create({
      type: MessageType.INBOUND_SPAN,
      requestId: this.generateRequestId(),
      payload: {
        oneofKind: "sendInboundSpanForReplayRequest",
        sendInboundSpanForReplayRequest: req,
      },
    });

    await this.sendProtobufMessage(sdkMessage);
  }

  /**
   * Send an alert to the CLI (fire-and-forget, no response expected)
   */
  private async sendAlert(alert: SendAlertRequest): Promise<void> {
    if (!this.client || !this.protobufContext) {
      logger.debug("[ProtobufCommunicator] Not connected to CLI, skipping alert");
      return;
    }

    const sdkMessage = SDKMessage.create({
      type: MessageType.ALERT,
      requestId: this.generateRequestId(),
      payload: {
        oneofKind: "sendAlertRequest",
        sendAlertRequest: alert,
      },
    });

    // Fire-and-forget - don't wait for response
    try {
      await this.sendProtobufMessage(sdkMessage);
      logger.debug("[ProtobufCommunicator] Alert sent to CLI");
    } catch (error) {
      logger.debug("[ProtobufCommunicator] Failed to send alert to CLI:", error);
      // Swallow error - alerts are non-critical
    }
  }

  /**
   * Send instrumentation version mismatch alert to CLI
   */
  async sendInstrumentationVersionMismatchAlert(params: {
    moduleName: string;
    requestedVersion: string | undefined;
    supportedVersions: string[];
  }): Promise<void> {
    const alert = SendAlertRequest.create({
      alert: {
        oneofKind: "versionMismatch",
        versionMismatch: InstrumentationVersionMismatchAlert.create({
          moduleName: params.moduleName,
          requestedVersion: params.requestedVersion || "",
          supportedVersions: params.supportedVersions,
          sdkVersion: SDK_VERSION,
        }),
      },
    });
    await this.sendAlert(alert);
  }

  /**
   * Send unpatched dependency alert to CLI
   */
  async sendUnpatchedDependencyAlert(params: {
    stackTrace: string;
    traceTestServerSpanId: string;
  }): Promise<void> {
    const alert = SendAlertRequest.create({
      alert: {
        oneofKind: "unpatchedDependency",
        unpatchedDependency: UnpatchedDependencyAlert.create({
          stackTrace: params.stackTrace,
          traceTestServerSpanId: params.traceTestServerSpanId,
          sdkVersion: SDK_VERSION,
        }),
      },
    });
    await this.sendAlert(alert);
  }

  private handleIncomingData(data: Buffer): void {
    this.incomingBuffer = Buffer.concat([this.incomingBuffer, data]);
    logger.debug(`[ProtobufCommunicator] Processing buffer, length: ${this.incomingBuffer.length}`);

    while (this.incomingBuffer.length >= 4) {
      const messageLength = this.incomingBuffer.readUInt32BE(0);
      logger.debug(
        `[ProtobufCommunicator] Message length from prefix: ${messageLength}, buffer has: ${this.incomingBuffer.length - 4}`,
      );

      if (this.incomingBuffer.length < 4 + messageLength) {
        logger.debug(
          `[ProtobufCommunicator] Incomplete message, waiting for more data. Need ${4 + messageLength}, have ${this.incomingBuffer.length}`,
        );
        break;
      }

      const messageData = this.incomingBuffer.slice(4, 4 + messageLength);
      this.incomingBuffer = this.incomingBuffer.slice(4 + messageLength);

      try {
        const cliMessage = CLIMessage.fromBinary(messageData);
        logger.debug(
          `[ProtobufCommunicator] Parsed CLI message type: ${cliMessage.type}, requestId: ${cliMessage.requestId}`,
        );
        this.handleCLIMessage(cliMessage);
      } catch (error) {
        logger.error("[ProtobufCommunicator] failed to parse CLI message:", error);
      }
    }
  }

  private handleCLIMessage(message: CLIMessage): void {
    const requestId = message.requestId;

    logger.debug(
      `[ProtobufCommunicator] Received CLI message for requestId: ${requestId}, pending requests:`,
      Array.from(this.pendingRequests.keys()),
    );

    if (message.payload.oneofKind === "connectResponse") {
      const connectResponse = message.payload.connectResponse;
      if (connectResponse?.success) {
        logger.debug("[ProtobufCommunicator] CLI acknowledged connection");
      } else {
        logger.error("[ProtobufCommunicator] CLI rejected connection:", connectResponse?.error);
      }
      return;
    }

    if (message.payload.oneofKind === "getMockResponse") {
      const mockResponse = message.payload.getMockResponse;
      logger.debug(
        `[ProtobufCommunicator] Received mock response for requestId: ${requestId}, pending requests:`,
        Array.from(this.pendingRequests.keys()),
      );
      const pendingRequest = this.pendingRequests.get(requestId);

      if (!pendingRequest) {
        logger.warn(
          "[ProtobufCommunicator] received response for unknown request:",
          requestId,
          "Available pending requests:",
          Array.from(this.pendingRequests.keys()),
        );
        return;
      }

      this.pendingRequests.delete(requestId);

      if (!mockResponse) {
        pendingRequest.reject(new Error("No mock response received"));
        return;
      }

      if (mockResponse.found) {
        try {
          const responseData = this.extractResponseData(mockResponse);
          pendingRequest.resolve({
            found: true,
            response: responseData,
          });
        } catch (error) {
          pendingRequest.reject(new Error(`Failed to extract response data: ${error}`));
        }
      } else {
        pendingRequest.resolve({
          found: false,
          error: mockResponse.error || "Mock not found",
        });
      }
    }

    if (message.payload.oneofKind === "envVarResponse") {
      const envVarResponse = message.payload.envVarResponse;
      logger.debug(
        `[ProtobufCommunicator] Received env var response for requestId: ${requestId}`,
      );
      const pendingRequest = this.pendingRequests.get(requestId);

      if (!pendingRequest) {
        logger.warn(
          "[ProtobufCommunicator] received env var response for unknown request:",
          requestId,
        );
        return;
      }

      this.pendingRequests.delete(requestId);

      // Convert protobuf map to Record<string, string>
      const envVars: Record<string, string> = {};
      if (envVarResponse?.envVars) {
        Object.entries(envVarResponse.envVars).forEach(([key, value]) => {
          envVars[key] = value;
        });
      }

      pendingRequest.resolve(envVars);
      return;
    }
  }

  /**
   * Extract response data from MockResponse
   */
  private extractResponseData(mockResponse: GetMockResponse): Record<string, unknown> {
    if (!mockResponse.responseData) {
      return {};
    }

    try {
      const struct = mockResponse.responseData;

      logger.debug("[ProtobufCommunicator] extracting response data directly from protobuf");

      if (struct.fields && struct.fields["response"]) {
        const responseValue = Value.toJson(struct.fields["response"]);
        if (responseValue) {
          logger.debug(
            "[ProtobufCommunicator] Extracted response data:",
            JSON.stringify(responseValue, null, 2),
          );
          return responseValue as Record<string, unknown>;
        }
      }

      return {};
    } catch (error) {
      logger.error("[ProtobufCommunicator] failed to extract response data:", error);
      throw error;
    }
  }

  private generateRequestId(): string {
    return Math.random().toString(36).slice(2, 11);
  }

  private cleanSpan(data: any): any {
    if (data === null || data === undefined) {
      return null;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.cleanSpan(item)).filter((item) => item !== undefined);
    }

    if (typeof data === "object") {
      const cleaned: any = {};
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          cleaned[key] = this.cleanSpan(value);
        }
      }
      return cleaned;
    }

    return data;
  }

  disconnect(): void {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }
}
