import * as fs from "fs";
import * as path from "path";
import { execSync, spawn } from "child_process";
import axios, { AxiosResponse } from "axios";

enum TestMode {
  RECORD = "RECORD",
  REPLAY = "REPLAY",
}

interface TestConfig {
  module: string;
  version: string;
  endpoints: Array<{
    path: string;
    method: string;
    body?: any;
  }>;
}

interface TestResult {
  endpoint: string;
  method: string;
  recordResponse?: any;
  replayResponse?: any;
  success: boolean;
  error?: string;
}

interface EndpointResult {
  endpoint: string;
  method: string;
  body?: any;
  response?: any;
  status?: number;
  success: boolean;
  error?: string;
}

export class TestRunner {
  private scenarioPath: string;
  private config: TestConfig;
  private containerName: string;
  private baseUrl: string;

  constructor(scenarioPath: string) {
    this.scenarioPath = scenarioPath;
    this.config = JSON.parse(fs.readFileSync(path.join(scenarioPath, "test-config.json"), "utf8"));
    this.containerName = `tusk-drift-test-${this.config.module}-${this.config.version}`.replace(
      /[^a-zA-Z0-9-]/g,
      "-",
    );
    this.baseUrl = "http://localhost:3000";
  }

  async runScenario(): Promise<TestResult[]> {
    console.log(`Running tests for ${this.config.module} v${this.config.version}`);

    try {
      // Record mode
      console.log("Running in record mode...");
      // Delete all files in tmp/traces directory
      const tracesDir = path.join(this.getSdkRoot(), "tmp", "traces");
      fs.readdirSync(tracesDir).forEach((file) => {
        fs.unlinkSync(path.join(tracesDir, file));
      });
      await this.runMode(TestMode.RECORD);

      console.log("Running in replay mode...");
      const comparison = await this.runMode(TestMode.REPLAY);
      return comparison;
    } finally {
      await this.cleanup();
    }
  }

  private async runMode(mode: TestMode): Promise<TestResult[]> {
    // If we have replay results, we are in record mode
    console.log(`Building and starting container in ${mode} mode...`);

    // Get the SDK root directory
    const sdkRoot = this.getSdkRoot();

    // Build the Docker image
    execSync(`docker build -t ${this.containerName} ${this.scenarioPath}`, {
      stdio: "inherit",
    });

    // Run the container
    const containerProcess = spawn(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        this.containerName,
        "-p",
        "3000:3000",
        "-e",
        `TUSK_DRIFT_MODE=${mode}`,
        "-e",
        `TUSK_DRIFT_INTEGRATION_TEST=TRUE`,
        "-e",
        `TUSK_ENV=prod`,
        "-v",
        `${sdkRoot}/node_modules/@use-tusk/drift-schemas:/app/node_modules/@use-tusk/drift-schemas:ro`,
        "-v",
        `${sdkRoot}/dist:/app/node_modules/tusk-drift-sdk/dist:ro`,
        "-v",
        `${sdkRoot}/package.json:/app/node_modules/tusk-drift-sdk/package.json:ro`,
        "-v",
        `${sdkRoot}/node_modules:/app/node_modules/tusk-drift-sdk/node_modules:ro`,
        "-v",
        `${sdkRoot}/tmp:/app/tmp`,
        "-v",
        "/var/run/docker.sock:/var/run/docker.sock", // Needed so testcontainers can use docker
        this.containerName,
      ],
      { stdio: "inherit", detached: false },
    );

    let results: TestResult[] = [];

    try {
      // Wait for the server to be ready
      await this.waitForServerToBeReady();

      if (mode === TestMode.RECORD) {
        await this.runEndpointTestsRecord();
        // Wait for spans to be exported
        await this.sleep(4000);
      } else {
        // Only replaying returns results
        results = await this.runEndpointTestsReplay();
      }
    } finally {
      // Stop the container (it might have already exited)
      try {
        execSync(`docker stop ${this.containerName}`, { stdio: "inherit" });
      } catch (error) {
        // Container might have already stopped, that's ok
        console.log("Container already stopped");
      }

      // Wait for the container process to exit
      if (!containerProcess.killed) {
        containerProcess.kill("SIGTERM");
        await new Promise((resolve) => {
          containerProcess.on("exit", resolve);
          // Force kill after 5 seconds if it doesn't exit gracefully
          setTimeout(() => {
            if (!containerProcess.killed) {
              containerProcess.kill("SIGKILL");
            }
          }, 5000);
        });
      }
    }

    return results;
  }

  private async waitForServerToBeReady(): Promise<void> {
    let retries = 0;
    while (true) {
      try {
        const response = await axios.get(`${this.baseUrl}/health`);
        console.log(`Health check response: ${response.status}`, retries);
        if (response.status === 200) {
          console.log("Server is ready");
          break;
        }
      } catch (error) {
        console.log("Health check failed, retrying...");
      }
      if (retries > 20) {
        throw new Error("Server not ready after 20 retries");
      }
      retries++;
      await this.sleep(5000);
    }
  }

  private async runEndpointTestsRecord(): Promise<void> {
    for (const endpoint of this.config.endpoints) {
      console.log(`🧪 Testing ${endpoint.method} ${endpoint.path}`);

      try {
        // Traces will get stored in tmp/traces directory
        await axios({
          method: endpoint.method.toLowerCase(),
          url: `${this.baseUrl}${endpoint.path}`,
          data: endpoint.body,
          timeout: 10000,
        });
      } catch (error: any) {
        console.error(`Error testing ${endpoint.method} ${endpoint.path}:`, error.message);
      }
    }
  }

  /**
   * Runs the endpoint tests in replay mode
   *
   * Iterates through all JSONL files in the traces directory, parses the first line that has kind: 2 (SPAN_KIND_SERVER),
   * and pushes the trace_id to the jsonLinesToRun array.
   *
   * Then, it runs the tests in parallel for each trace_id.
   *
   * If the input_value.url includes "/health", it skips the test.
   * @returns The results of the tests
   */
  private async runEndpointTestsReplay(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    // Get all JSONL files from the traces directory
    const sdkRoot = this.getSdkRoot();
    const tracesDir = path.join(sdkRoot, "tmp", "traces");

    if (!fs.existsSync(tracesDir)) {
      console.error("Traces directory does not exist:", tracesDir);
      return results;
    }

    const jsonlFiles = fs
      .readdirSync(tracesDir)
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) => path.join(tracesDir, file));

    console.log(`Found ${jsonlFiles.length} JSONL files to process`);

    const jsonLinesToRun: string[] = [];

    // Process each JSONL file
    for (const filePath of jsonlFiles) {
      try {
        const fileContent = fs.readFileSync(filePath, "utf8");
        const lines = fileContent
          .trim()
          .split("\n")
          .filter((line) => line.trim());

        // find the first line that has kind: 1 (SPAN_KIND_SERVER)
        const firstLineWithKindOne = lines.find((line) => {
          const span = JSON.parse(line);
          return span.kind === 1;
        });

        if (firstLineWithKindOne) {
          const firstLineWithKindOneParsed = JSON.parse(firstLineWithKindOne);
          if (
            firstLineWithKindOneParsed.inputValue.url &&
            firstLineWithKindOneParsed.inputValue.url.includes("/health")
          ) {
            continue;
          } else {
            jsonLinesToRun.push(firstLineWithKindOne);
          }
        }
      } catch (fileError) {
        console.error(`Error reading JSONL file ${filePath}:`, fileError);
      }
    }

    // Run the tests in parallel
    // do this sequentially for now
    for (const jsonLine of jsonLinesToRun) {
      try {
        const span = JSON.parse(jsonLine);

        // Check if this span has kind: 1 (SPAN_KIND_SERVER)
        if (span.kind === 1 && span.inputValue) {
          const inputValue = span.inputValue;
          const outputValue = span.outputValue;

          // Extract URL, method, and body from input_value
          if (inputValue.url && inputValue.method) {
            console.log(
              `🧪 Testing ${inputValue.method} ${inputValue.url} (from trace: ${span.traceId})`,
            );

            try {
              let requestBody = inputValue.body;
              if (requestBody) {
                requestBody = Buffer.from(requestBody, "base64").toString("utf8");
                requestBody = JSON.parse(requestBody);
              }
              const response = await axios({
                method: inputValue.method.toLowerCase(),
                url: inputValue.url,
                data: requestBody || undefined,
                headers: {
                  "x-td-trace-id": span.traceId,
                },
                timeout: 10000,
              });
              const result = this.compareResults({
                inputValue,
                outputValue,
                replayResponse: response,
              });
              results.push(result);
            } catch (error: any) {
              console.error(
                `🚨 Error testing ${inputValue.method} ${inputValue.url}:`,
                error.message,
              );
              results.push({
                endpoint: inputValue.url,
                method: inputValue.method,
                recordResponse: outputValue,
                success: false,
                error: error.message,
              });
            }
          }
        }
      } catch (lineError) {
        console.warn(`Error parsing line in ${jsonLine}:`, lineError);
      }
    }

    return results;
  }

  // Add this method to the TestRunner class
  private getSdkRoot(): string {
    let currentDir = __dirname;
    while (currentDir !== path.dirname(currentDir)) {
      const packageJsonPath = path.join(currentDir, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
          if (packageJson.name === "@use-tusk/drift-sdk") {
            return currentDir;
          }
        } catch (error) {
          // Invalid package.json, continue searching
        }
      }
      currentDir = path.dirname(currentDir);
    }
    throw new Error("Could not find @use-tusk/drift-sdk root directory");
  }

  private compareResults({
    inputValue,
    outputValue,
    replayResponse,
  }: {
    inputValue: any;
    outputValue: any;
    replayResponse: AxiosResponse;
  }): TestResult {
    if (!outputValue || !replayResponse) {
      return {
        endpoint: inputValue.url,
        method: inputValue.method,
        recordResponse: outputValue,
        replayResponse: replayResponse.data,
        success: true,
        error: undefined,
      };
    }

    if (outputValue.statusCode !== replayResponse.status) {
      return {
        endpoint: inputValue.url,
        method: inputValue.method,
        recordResponse: outputValue,
        replayResponse: replayResponse.data,
        success: false,
        error: "Status code mismatch between record and replay modes",
      };
    }

    const outputValueBodyBuffer = Buffer.from(outputValue.body, "base64");
    const outputValueBodyToString = outputValueBodyBuffer.toString("utf8");
    const outputValueBody = JSON.parse(outputValueBodyToString);

    const success = this.deepEqual(outputValueBody, replayResponse.data);

    return {
      endpoint: inputValue.url,
      method: inputValue.method,
      recordResponse: outputValueBody,
      replayResponse: replayResponse.data,
      success,
      error: success ? undefined : "Response mismatch between record and replay modes",
    };
  }

  private deepEqual(obj1: any, obj2: any): boolean {
    if (obj1?.data?.headers && obj2?.data?.headers) {
      delete obj1.data.headers;
      delete obj2.data.headers;
    }
    if (obj1?.headers && obj2?.headers) {
      delete obj1.headers;
      delete obj2.headers;
    }

    return JSON.stringify(obj1) === JSON.stringify(obj2);
  }

  private async cleanup(): Promise<void> {
    try {
      // Stop and remove container if it exists
      execSync(`docker stop ${this.containerName} 2>/dev/null || true`, { stdio: "inherit" });
      execSync(`docker rm ${this.containerName} 2>/dev/null || true`, { stdio: "inherit" });

      console.log("Cleanup completed");
    } catch (error) {
      console.warn("Cleanup warning:", error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export async function runScenario(scenarioPath: string): Promise<TestResult[]> {
  const runner = new TestRunner(scenarioPath);
  return await runner.runScenario();
}
