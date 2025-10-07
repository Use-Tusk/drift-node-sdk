import * as fs from "fs";
import * as path from "path";
import { CleanSpanData } from "./types";
import { logger } from "./utils/logger";

export interface HttpReplayResult {
  statusCode: number;
  headers: Record<string, any>;
  body: any;
  bodyEncoding?: string;
  [key: string]: any;
}

/**
 * Memory store singleton that provides access to mocks stored in the filesystem
 * and manages replay mappings for HTTP requests
 */
export class MemoryStore {
  private static instance: MemoryStore;
  private baseDirectory: string = "";
  private initialized = false;

  /**
   * Maps trace id to its replayed mocks
   */
  private requestReplayMockMap: Map<string, CleanSpanData[]> = new Map();

  /**
   * Cache for loaded mock files to avoid repeated filesystem reads
   */
  private mockFileCache: Map<string, CleanSpanData[]> = new Map();

  private constructor() {
    // Private constructor for singleton pattern
  }

  static getInstance(): MemoryStore {
    if (!MemoryStore.instance) {
      MemoryStore.instance = new MemoryStore();
    }
    return MemoryStore.instance;
  }

  /**
   * Initialize the memory store with a base directory
   *
   * Creates a mapping between file path (jsonl file of all mocks for a trace) and the mock data (CleanSpanData[])
   */
  initialize(baseDirectory: string): void {
    if (this.initialized) {
      logger.debug("MemoryStore already initialized, skipping...");
      return;
    }

    this.baseDirectory = path.resolve(baseDirectory);
    this.initialized = true;

    logger.debug(`MemoryStore initialized with base directory: ${this.baseDirectory}`);

    // Preload mocks if directory exists
    if (fs.existsSync(this.baseDirectory)) {
      this.preloadMocks();
    } else {
      logger.debug(`MemoryStore base directory does not exist: ${this.baseDirectory}`);
    }
  }

  /**
   * Preload all mock files from the base directory
   */
  private preloadMocks(): void {
    try {
      const files = this.getAllMockFiles();
      logger.debug(`MemoryStore found ${files.length} mock files to preload`);

      for (const filePath of files) {
        this.loadMockFile(filePath);
      }

      logger.debug(`MemoryStore preloaded ${this.mockFileCache.size} mock files`);
    } catch (error) {
      logger.error("MemoryStore error preloading mocks:", error);
    }
  }

  /**
   * Get all mock files from the base directory recursively
   */
  private getAllMockFiles(): string[] {
    const mockFiles: string[] = [];

    const walkDir = (dirPath: string) => {
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);

          if (entry.isDirectory()) {
            walkDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
            mockFiles.push(fullPath);
          }
        }
      } catch (error) {
        logger.error(`MemoryStore error reading directory ${dirPath}:`, error);
      }
    };

    walkDir(this.baseDirectory);
    return mockFiles;
  }

  /**
   * Load and parse a mock file (JSONL format)
   */
  private loadMockFile(filePath: string): CleanSpanData[] | null {
    try {
      // Check cache first
      if (this.mockFileCache.has(filePath)) {
        return this.mockFileCache.get(filePath)!;
      }

      const fileContent = fs.readFileSync(filePath, "utf8");
      const mockData: CleanSpanData[] = [];

      // Parse JSONL format - one JSON object per line
      const lines = fileContent.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        try {
          const jsonObject = JSON.parse(line);

          const mockDataItem: CleanSpanData = {
            ...jsonObject,
          };

          mockData.push(mockDataItem);
        } catch (lineError) {
          logger.error(`MemoryStore error parsing line in ${filePath}:`, lineError);
        }
      }

      // Validate that we have valid mock data
      if (mockData.length === 0) {
        logger.error(`MemoryStore no valid mock data found in: ${filePath}`);
        return null;
      }

      // Cache the loaded data
      this.mockFileCache.set(filePath, mockData);

      return mockData;
    } catch (error) {
      logger.error(`MemoryStore error loading mock file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Create a replay mock mapping for a specific trace ID
   */
  createRequestReplayMockMap(traceId: string): void {
    if (!this.initialized) {
      logger.error("MemoryStore not initialized. Call initialize() first.");
      return;
    }

    // Find all mocks related to this trace ID
    const relatedMocks: CleanSpanData[] = [];

    for (const [_, mocks] of this.mockFileCache.entries()) {
      const matchingMocks = mocks.filter((mock) => mock.traceId === traceId);
      relatedMocks.push(...matchingMocks);
    }

    if (relatedMocks.length > 0) {
      this.requestReplayMockMap.set(traceId, relatedMocks);
    } else {
      logger.debug(`MemoryStore no mocks found for trace ${traceId}`);
    }
  }

  /**
   * Get replay mocks for a specific trace ID
   */
  getRequestReplayMocks(traceId: string): CleanSpanData[] | undefined {
    return this.requestReplayMockMap.get(traceId);
  }

  markAllMocksAsUnused(traceId: string): void {
    const mocks = this.getRequestReplayMocks(traceId);
    if (!mocks) {
      return;
    }

    mocks.forEach((mock) => {
      mock.isUsed = false;
    });
  }

  /**
   * Check if the memory store is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Export singleton instance
export const memoryStore = MemoryStore.getInstance();
