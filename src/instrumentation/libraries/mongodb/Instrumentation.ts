import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { TdInstrumentationNodeModuleFile } from "../../core/baseClasses/TdInstrumentationNodeModuleFile";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode, context, Context } from "@opentelemetry/api";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { captureStackTrace, wrap } from "../../core/utils";
import { findMockResponseAsync } from "../../core/utils/mockResponseUtils";
import { handleRecordMode, handleReplayMode } from "../../core/utils/modeUtils";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import {
  MongodbModuleExports,
  MongodbInstrumentationConfig,
  MongodbCommandInputValue,
} from "./types";
import { logger, isEsm } from "../../../core/utils";
import {
  createMockInputValue,
  createSpanInputValue,
} from "../../../core/utils/dataNormalizationUtils";
import { TdSpanAttributes } from "../../../core/types";
import { ConnectionHandler } from "./handlers/ConnectionHandler";
import { TdFakeFindCursor, TdFakeAggregationCursor, TdFakeChangeStream } from "./mocks/FakeCursor";
import { TdFakeTopology } from "./mocks/FakeTopology";
import {
  sanitizeBsonValue,
  reconstructBsonValue,
  addOutputAttributesToSpan,
  sanitizeOptions,
  wrapCursorOutput,
  unwrapCursorOutput,
  wrapDirectOutput,
  unwrapDirectOutput,
} from "./utils/bsonConversion";

/**
 * Collection methods that return Promises directly (not cursors).
 * Each is wrapped with record/replay instrumentation.
 */
const COLLECTION_METHODS_TO_WRAP = [
  "findOne",
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "replaceOne",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndReplace",
  "countDocuments",
  "estimatedDocumentCount",
  "distinct",
  "bulkWrite",
  // Collection index operations
  "createIndex",
  "createIndexes",
  "dropIndex",
  "dropIndexes",
  "indexes",
];

/**
 * Cursor-returning methods on Collection.prototype.
 * These require special handling because they return cursors synchronously
 * rather than Promises.
 */
const CURSOR_METHODS_TO_WRAP = ["find", "aggregate", "listIndexes"] as const;

/**
 * Db.prototype methods that return Promises directly (not cursors).
 */
const DB_METHODS_TO_WRAP = [
  "command",
  "createCollection",
  "dropCollection",
  "dropDatabase",
] as const;

/**
 * Db.prototype methods that return cursors.
 */
const DB_CURSOR_METHODS_TO_WRAP = ["listCollections", "aggregate"] as const;

export class MongodbInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "MongodbInstrumentation";
  private mode: TuskDriftMode;
  private tuskDrift: TuskDriftCore;
  private connectionHandler: ConnectionHandler;
  private moduleExports: any;

  constructor(config: MongodbInstrumentationConfig = {}) {
    super("mongodb", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.tuskDrift = TuskDriftCore.getInstance();
    this.connectionHandler = new ConnectionHandler(this.mode, this.INSTRUMENTATION_NAME, () =>
      this.tuskDrift.isAppReady(),
    );
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: "mongodb",
        supportedVersions: ["5.*", "6.*", "7.*"],
        patch: (moduleExports: MongodbModuleExports) => this._patchMongodbModule(moduleExports),
        files: [
          new TdInstrumentationNodeModuleFile({
            name: "mongodb/lib/sessions.js",
            supportedVersions: ["5.*", "6.*", "7.*"],
            patch: (moduleExports: any) => this._patchSessionModule(moduleExports),
          }),
          // Ordered bulk operations
          new TdInstrumentationNodeModuleFile({
            name: "mongodb/lib/bulk/ordered.js",
            supportedVersions: ["5.*", "6.*", "7.*"],
            patch: (moduleExports: any) => this._patchOrderedBulkModule(moduleExports),
          }),
          // Unordered bulk operations
          new TdInstrumentationNodeModuleFile({
            name: "mongodb/lib/bulk/unordered.js",
            supportedVersions: ["5.*", "6.*", "7.*"],
            patch: (moduleExports: any) => this._patchUnorderedBulkModule(moduleExports),
          }),
        ],
      }),
    ];
  }

  /**
   * Patch the mongodb module exports.
   * Wraps MongoClient, Collection, Db, and cursor prototypes to intercept
   * all database operations for record/replay.
   */
  private _patchMongodbModule(mongodbModule: MongodbModuleExports): MongodbModuleExports {
    logger.debug(`[${this.INSTRUMENTATION_NAME}] Patching MongoDB module in ${this.mode} mode`);

    if (this.isModulePatched(mongodbModule)) {
      logger.debug(`[${this.INSTRUMENTATION_NAME}] MongoDB module already patched, skipping`);
      return mongodbModule;
    }

    // Resolve actual exports (handle ESM vs CJS)
    const actualExports = isEsm(mongodbModule) ? mongodbModule.default : mongodbModule;

    // Store module exports for BSON reconstruction during replay
    this.moduleExports = actualExports;

    if (!actualExports || !actualExports.MongoClient) {
      logger.error(
        `[${this.INSTRUMENTATION_NAME}] MongoClient not found in module exports, cannot patch`,
      );
      return mongodbModule;
    }

    // Patch MongoClient connection lifecycle methods
    this._wrap(actualExports.MongoClient.prototype, "connect", (original: any) => {
      const self = this;
      return function (this: any, ...args: any[]) {
        return self.connectionHandler.handleConnect(original, this, args);
      };
    });

    this._wrap(actualExports.MongoClient.prototype, "close", (original: any) => {
      const self = this;
      return function (this: any, ...args: any[]) {
        return self.connectionHandler.handleClose(original, this, args);
      };
    });

    this._wrap(actualExports.MongoClient.prototype, "db", (original: any) => {
      const self = this;
      return function (this: any, ...args: any[]) {
        return self.connectionHandler.handleDb(original, this, args);
      };
    });

    // Patch Collection.prototype CRUD methods
    try {
      this._patchCollectionMethods(actualExports);
    } catch (error) {
      logger.error(
        `[${this.INSTRUMENTATION_NAME}] Error patching Collection methods, skipping:`,
        error,
      );
    }

    // Patch cursor-returning Collection methods (find, aggregate, listIndexes)
    try {
      this._patchCursorReturningMethods(actualExports);
    } catch (error) {
      logger.error(
        `[${this.INSTRUMENTATION_NAME}] Error patching cursor-returning methods, skipping:`,
        error,
      );
    }

    // Patch Collection.prototype.initializeOrderedBulkOp / initializeUnorderedBulkOp
    // In replay mode, inject FakeTopology before calling original to prevent
    // "MongoClient must be connected" error from BulkOperationBase constructor.
    try {
      this._patchBulkOpInitMethods(actualExports);
    } catch (error) {
      logger.error(
        `[${this.INSTRUMENTATION_NAME}] Error patching bulk op init methods, skipping:`,
        error,
      );
    }

    // Patch Db.prototype methods
    try {
      this._patchDbMethods(actualExports);
      this._patchDbCursorMethods(actualExports);
    } catch (error) {
      logger.error(`[${this.INSTRUMENTATION_NAME}] Error patching Db methods, skipping:`, error);
    }

    // Patch MongoClient.prototype.startSession
    try {
      if (typeof actualExports.MongoClient.prototype.startSession === "function") {
        this._wrap(
          actualExports.MongoClient.prototype,
          "startSession",
          this._getStartSessionWrapper(),
        );
        logger.debug(`[${this.INSTRUMENTATION_NAME}] Wrapped MongoClient.prototype.startSession`);
      }
    } catch (error) {
      logger.error(`[${this.INSTRUMENTATION_NAME}] Error patching startSession, skipping:`, error);
    }

    // Wrap watch() methods as passthrough (RECORD) or no-op (REPLAY)
    try {
      this._patchWatchMethods(actualExports);
    } catch (error) {
      logger.error(`[${this.INSTRUMENTATION_NAME}] Error patching watch methods, skipping:`, error);
    }

    this.markModuleAsPatched(mongodbModule);
    logger.debug(`[${this.INSTRUMENTATION_NAME}] MongoDB module patching complete`);

    return mongodbModule;
  }

  // ---------------------------------------------------------------------------
  // Collection-level CRUD method patching
  // ---------------------------------------------------------------------------

  /**
   * Patch all Collection.prototype CRUD methods that return Promises.
   * Guards each method with typeof check for version compatibility.
   */
  private _patchCollectionMethods(actualExports: any): void {
    const Collection = actualExports.Collection;
    if (!Collection || !Collection.prototype) {
      logger.warn(
        `[${this.INSTRUMENTATION_NAME}] Collection not found in module exports, skipping collection method patching`,
      );
      return;
    }

    for (const methodName of COLLECTION_METHODS_TO_WRAP) {
      if (typeof Collection.prototype[methodName] === "function") {
        this._wrap(Collection.prototype, methodName, this._getCollectionMethodWrapper(methodName));
        logger.debug(`[${this.INSTRUMENTATION_NAME}] Wrapped Collection.prototype.${methodName}`);
      } else {
        logger.debug(
          `[${this.INSTRUMENTATION_NAME}] Collection.prototype.${methodName} not found (may not exist in this version), skipping`,
        );
      }
    }
  }

  /**
   * Returns a wrapper function for a given Collection method.
   * Handles RECORD, REPLAY, and DISABLED modes.
   */
  private _getCollectionMethodWrapper(methodName: string): (original: Function) => Function {
    const self = this;
    const spanName = `mongodb.${methodName}`;
    const submodule = `collection-${methodName}`;

    return (original: Function) => {
      return function (this: any, ...args: any[]) {
        const collectionName = this?.s?.namespace?.collection;
        const databaseName = this?.s?.namespace?.db;
        const inputValue = self._extractCollectionInput(
          methodName,
          collectionName,
          databaseName,
          args,
        );

        if (self.mode === TuskDriftMode.DISABLED) {
          return original.apply(this, args);
        }

        if (self.mode === TuskDriftMode.RECORD) {
          return self._handleRecordCollectionMethod(
            original,
            this,
            args,
            inputValue,
            spanName,
            submodule,
          );
        }

        if (self.mode === TuskDriftMode.REPLAY) {
          return self._handleReplayCollectionMethod(
            original,
            this,
            args,
            inputValue,
            spanName,
            submodule,
            methodName,
          );
        }

        return original.apply(this, args);
      };
    };
  }

  /**
   * Handle RECORD mode for a collection method.
   * Calls the original method, wraps the promise to capture output, creates a span.
   */
  private _handleRecordCollectionMethod(
    original: Function,
    thisArg: any,
    args: any[],
    inputValue: MongodbCommandInputValue,
    spanName: string,
    submodule: string,
  ): any {
    return handleRecordMode({
      originalFunctionCall: () => original.apply(thisArg, args),
      recordModeHandler: ({ isPreAppStart }) => {
        return SpanUtils.createAndExecuteSpan(
          this.mode,
          () => original.apply(thisArg, args),
          {
            name: spanName,
            kind: SpanKind.CLIENT,
            submodule,
            packageType: PackageType.MONGODB,
            packageName: "mongodb",
            instrumentationName: this.INSTRUMENTATION_NAME,
            inputValue,
            isPreAppStart,
            stopRecordingChildSpans: true,
          },
          (spanInfo: SpanInfo) => {
            const resultPromise = original.apply(thisArg, args) as Promise<any>;

            return resultPromise
              .then((result: any) => {
                try {
                  addOutputAttributesToSpan(spanInfo, wrapDirectOutput(result));
                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.OK,
                  });
                } catch (error) {
                  logger.error(
                    `[${this.INSTRUMENTATION_NAME}] Error adding span attributes for ${spanName}:`,
                    error,
                  );
                }
                return result;
              })
              .catch((error: any) => {
                try {
                  SpanUtils.addSpanAttributes(spanInfo.span, {
                    outputValue: {
                      error: error?.message || "Unknown error",
                    },
                  });
                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.ERROR,
                    message: error?.message || "Operation failed",
                  });
                } catch (spanError) {
                  logger.error(
                    `[${this.INSTRUMENTATION_NAME}] Error recording span for ${spanName} error:`,
                    spanError,
                  );
                }
                throw error;
              });
          },
        );
      },
      spanKind: SpanKind.CLIENT,
    });
  }

  /**
   * Handle REPLAY mode for a collection method.
   * Looks up mock data, reconstructs BSON types, returns mocked result.
   */
  private _handleReplayCollectionMethod(
    original: Function,
    thisArg: any,
    args: any[],
    inputValue: MongodbCommandInputValue,
    spanName: string,
    submodule: string,
    methodName: string,
  ): any {
    const stackTrace = captureStackTrace(["MongodbInstrumentation"]);
    return handleReplayMode({
      noOpRequestHandler: () => {
        return Promise.resolve(this._getNoOpResult(methodName));
      },
      isServerRequest: false,
      replayModeHandler: () => {
        return SpanUtils.createAndExecuteSpan(
          this.mode,
          () => original.apply(thisArg, args),
          {
            name: spanName,
            kind: SpanKind.CLIENT,
            submodule,
            packageType: PackageType.MONGODB,
            packageName: "mongodb",
            instrumentationName: this.INSTRUMENTATION_NAME,
            inputValue,
            isPreAppStart: !this.tuskDrift.isAppReady(),
            stopRecordingChildSpans: true,
          },
          async (spanInfo: SpanInfo) => {
            try {
              const mockData = await this._findMockData({
                spanInfo,
                name: spanName,
                inputValue,
                submoduleName: submodule,
                stackTrace,
              });

              if (!mockData) {
                const errorMsg = `[${this.INSTRUMENTATION_NAME}] No matching mock found for ${spanName} (collection: ${inputValue.collection})`;
                logger.warn(errorMsg);
                throw new Error(errorMsg);
              }

              const result = unwrapDirectOutput(
                reconstructBsonValue(mockData.result, this.moduleExports),
              );

              // Synchronize client-generated ObjectIds with recorded ones.
              // Libraries like Mongoose generate _id client-side before calling
              // insertOne/insertMany. During replay, the document's _id must match
              // the recorded value. We modify the ObjectId buffer IN-PLACE because
              // BSON's ObjectId shares the underlying Uint8Array by reference when
              // cloned (e.g., Mongoose's toObject() does new ObjectId(obj.id)),
              // so in-place mutation propagates back to the caller's model instance.
              if (methodName === "insertOne" && result?.insertedId != null && args[0]?._id?.id) {
                args[0]._id.id.set(result.insertedId.id);
              } else if (
                methodName === "insertMany" &&
                result?.insertedIds &&
                Array.isArray(args[0])
              ) {
                for (const [index, id] of Object.entries(result.insertedIds)) {
                  const idx = Number(index);
                  if (args[0]?.[idx]?._id?.id && (id as any)?.id) {
                    args[0][idx]._id.id.set((id as any).id);
                  }
                }
              }

              SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
              return result;
            } catch (error: any) {
              SpanUtils.endSpan(spanInfo.span, {
                code: SpanStatusCode.ERROR,
                message: error?.message || "Replay failed",
              });
              throw error;
            }
          },
        );
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Cursor-returning method patching (find, aggregate)
  // ---------------------------------------------------------------------------

  /**
   * Patch Collection.prototype methods that return cursors (find, aggregate).
   * Unlike CRUD methods, these are synchronous and return cursor objects.
   * The actual query doesn't execute until a terminal method is called.
   */
  private _patchCursorReturningMethods(actualExports: any): void {
    const Collection = actualExports.Collection;
    if (!Collection || !Collection.prototype) {
      logger.warn(
        `[${this.INSTRUMENTATION_NAME}] Collection not found, skipping cursor method patching`,
      );
      return;
    }

    for (const methodName of CURSOR_METHODS_TO_WRAP) {
      if (typeof Collection.prototype[methodName] === "function") {
        this._wrap(Collection.prototype, methodName, this._getCursorMethodWrapper(methodName));
        logger.debug(`[${this.INSTRUMENTATION_NAME}] Wrapped Collection.prototype.${methodName}`);
      } else {
        logger.debug(
          `[${this.INSTRUMENTATION_NAME}] Collection.prototype.${methodName} not found, skipping`,
        );
      }
    }
  }

  /**
   * Returns a wrapper function for a cursor-returning Collection method.
   *
   * - DISABLED: passthrough
   * - RECORD: call original (get real cursor), wrap terminal methods on the instance
   * - REPLAY: return a lazy fake cursor that loads mock data on first terminal call
   */
  private _getCursorMethodWrapper(methodName: string): (original: Function) => Function {
    const self = this;
    const spanName = `mongodb.${methodName}`;
    const submodule = `collection-${methodName}`;

    return (original: Function) => {
      return function (this: any, ...args: any[]) {
        const collectionName = this?.s?.namespace?.collection;
        const databaseName = this?.s?.namespace?.db;
        const inputValue = self._extractCursorInput(methodName, collectionName, databaseName, args);

        if (self.mode === TuskDriftMode.DISABLED) {
          return original.apply(this, args);
        }

        // Capture context at cursor creation time (before builder chaining)
        const creationContext = context.active();

        if (self.mode === TuskDriftMode.RECORD) {
          return self._handleRecordCursorMethod(
            original,
            this,
            args,
            inputValue,
            spanName,
            submodule,
            creationContext,
          );
        }

        if (self.mode === TuskDriftMode.REPLAY) {
          return self._handleReplayCursorMethod(
            inputValue,
            spanName,
            submodule,
            methodName,
            creationContext,
          );
        }

        return original.apply(this, args);
      };
    };
  }

  /**
   * Handle RECORD mode for a cursor-returning method.
   * Calls the original to get a real cursor, then wraps its terminal methods
   * to capture documents and create spans.
   */
  private _handleRecordCursorMethod(
    original: Function,
    thisArg: any,
    args: any[],
    inputValue: MongodbCommandInputValue,
    spanName: string,
    submodule: string,
    creationContext: Context,
  ): any {
    // Let MongoDB create the real cursor (no query executes yet)
    const cursor = original.apply(thisArg, args);

    // Shared state for this cursor's lifetime
    const cursorState = {
      collectedDocuments: [] as any[],
      spanInfo: null as SpanInfo | null,
      recorded: false,
      spanCreated: false,
    };

    this._wrapCursorTerminalMethods(
      cursor,
      inputValue,
      spanName,
      submodule,
      creationContext,
      cursorState,
    );

    return cursor;
  }

  /**
   * Wrap terminal methods on a real cursor instance for RECORD mode.
   * All terminal methods share state (collected documents, span, recorded flag).
   */
  private _wrapCursorTerminalMethods(
    cursor: any,
    inputValue: MongodbCommandInputValue,
    spanName: string,
    submodule: string,
    creationContext: Context,
    cursorState: {
      collectedDocuments: any[];
      spanInfo: SpanInfo | null;
      recorded: boolean;
      spanCreated: boolean;
    },
  ): void {
    const self = this;

    // Helper: finalize the cursor span (called once when cursor is exhausted)
    const finalizeCursorSpan = (): void => {
      if (cursorState.recorded || !cursorState.spanInfo) return;
      cursorState.recorded = true;
      try {
        addOutputAttributesToSpan(
          cursorState.spanInfo,
          wrapCursorOutput(cursorState.collectedDocuments),
        );
        SpanUtils.endSpan(cursorState.spanInfo.span, {
          code: SpanStatusCode.OK,
        });
      } catch (error) {
        logger.error(
          `[${self.INSTRUMENTATION_NAME}] Error finalizing cursor span for ${spanName}:`,
          error,
        );
      }
    };

    // Helper: handle errors on the cursor span
    const handleCursorError = (error: any): void => {
      if (cursorState.recorded || !cursorState.spanInfo) return;
      cursorState.recorded = true;
      try {
        SpanUtils.addSpanAttributes(cursorState.spanInfo.span, {
          outputValue: { error: error?.message || "Unknown error" },
        });
        SpanUtils.endSpan(cursorState.spanInfo.span, {
          code: SpanStatusCode.ERROR,
          message: error?.message || "Cursor operation failed",
        });
      } catch (spanError) {
        logger.error(
          `[${self.INSTRUMENTATION_NAME}] Error recording cursor error span for ${spanName}:`,
          spanError,
        );
      }
    };

    // Helper: create span on first terminal call for next/hasNext/asyncIterator
    // Returns false if recording should be skipped (background request).
    const ensureSpanCreated = (): boolean => {
      if (cursorState.spanCreated) return cursorState.spanInfo !== null;
      cursorState.spanCreated = true;

      const isAppReady = self.tuskDrift.isAppReady();
      const currentSpanInfo = SpanUtils.getCurrentSpanInfo();

      // Background request: app ready, no parent span, not a server request
      if (isAppReady && !currentSpanInfo) {
        return false;
      }

      const isPreAppStart = !isAppReady;

      const spanInfo = SpanUtils.createSpan({
        name: spanName,
        kind: SpanKind.CLIENT,
        isPreAppStart,
        parentContext: creationContext,
        attributes: {
          [TdSpanAttributes.NAME]: spanName,
          [TdSpanAttributes.PACKAGE_NAME]: "mongodb",
          [TdSpanAttributes.SUBMODULE_NAME]: submodule,
          [TdSpanAttributes.INSTRUMENTATION_NAME]: self.INSTRUMENTATION_NAME,
          [TdSpanAttributes.PACKAGE_TYPE]: PackageType.MONGODB,
          [TdSpanAttributes.INPUT_VALUE]: createSpanInputValue(inputValue),
          [TdSpanAttributes.IS_PRE_APP_START]: isPreAppStart,
        },
      });

      if (!spanInfo) {
        return false;
      }

      cursorState.spanInfo = spanInfo;
      return true;
    };

    // --- Wrap toArray ---
    if (typeof cursor.toArray === "function") {
      const originalToArray = cursor.toArray.bind(cursor);
      cursor.toArray = (): Promise<any[]> => {
        if (cursorState.recorded) return originalToArray();
        cursorState.recorded = true;

        return context.with(creationContext, () => {
          return handleRecordMode({
            originalFunctionCall: () => originalToArray(),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalToArray(),
                {
                  name: spanName,
                  kind: SpanKind.CLIENT,
                  submodule,
                  packageType: PackageType.MONGODB,
                  packageName: "mongodb",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue,
                  isPreAppStart,
                  stopRecordingChildSpans: true,
                },
                (spanInfo: SpanInfo) => {
                  return originalToArray()
                    .then((result: any[]) => {
                      try {
                        addOutputAttributesToSpan(spanInfo, wrapCursorOutput(result));
                        SpanUtils.endSpan(spanInfo.span, {
                          code: SpanStatusCode.OK,
                        });
                      } catch (error) {
                        logger.error(
                          `[${self.INSTRUMENTATION_NAME}] Error adding span attributes for ${spanName}.toArray:`,
                          error,
                        );
                      }
                      return result;
                    })
                    .catch((error: any) => {
                      try {
                        SpanUtils.addSpanAttributes(spanInfo.span, {
                          outputValue: {
                            error: error?.message || "Unknown error",
                          },
                        });
                        SpanUtils.endSpan(spanInfo.span, {
                          code: SpanStatusCode.ERROR,
                          message: error?.message || "toArray failed",
                        });
                      } catch (spanError) {
                        logger.error(
                          `[${self.INSTRUMENTATION_NAME}] Error recording cursor error span for ${spanName}.toArray:`,
                          spanError,
                        );
                      }
                      throw error;
                    });
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        });
      };
    }

    // --- Wrap next ---
    if (typeof cursor.next === "function") {
      const originalNext = cursor.next.bind(cursor);
      cursor.next = async (): Promise<any | null> => {
        if (cursorState.recorded) return originalNext();

        const shouldRecord = context.with(creationContext, () => ensureSpanCreated());
        if (!shouldRecord) return originalNext();

        try {
          const doc = await (cursorState.spanInfo
            ? SpanUtils.withSpan(cursorState.spanInfo, () => originalNext())
            : originalNext());

          if (doc !== null) {
            cursorState.collectedDocuments.push(doc);
          } else {
            finalizeCursorSpan();
          }
          return doc;
        } catch (error) {
          handleCursorError(error);
          throw error;
        }
      };
    }

    // --- Wrap hasNext ---
    if (typeof cursor.hasNext === "function") {
      const originalHasNext = cursor.hasNext.bind(cursor);
      cursor.hasNext = async (): Promise<boolean> => {
        if (cursorState.recorded) return originalHasNext();

        const shouldRecord = context.with(creationContext, () => ensureSpanCreated());
        if (!shouldRecord) return originalHasNext();

        try {
          const result = await (cursorState.spanInfo
            ? SpanUtils.withSpan(cursorState.spanInfo, () => originalHasNext())
            : originalHasNext());

          if (!result) {
            finalizeCursorSpan();
          }
          return result;
        } catch (error) {
          handleCursorError(error);
          throw error;
        }
      };
    }

    // --- Wrap forEach ---
    if (typeof cursor.forEach === "function") {
      const originalForEach = cursor.forEach.bind(cursor);
      cursor.forEach = (iterator: (doc: any) => boolean | void): Promise<void> => {
        if (cursorState.recorded) return originalForEach(iterator);
        cursorState.recorded = true;

        return context.with(creationContext, () => {
          return handleRecordMode({
            originalFunctionCall: () => originalForEach(iterator),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalForEach(iterator),
                {
                  name: spanName,
                  kind: SpanKind.CLIENT,
                  submodule,
                  packageType: PackageType.MONGODB,
                  packageName: "mongodb",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue,
                  isPreAppStart,
                  stopRecordingChildSpans: true,
                },
                (spanInfo: SpanInfo) => {
                  const collectedDocs: any[] = [];

                  const wrappedIterator = (doc: any) => {
                    collectedDocs.push(doc);
                    return iterator(doc);
                  };

                  return originalForEach(wrappedIterator)
                    .then(() => {
                      try {
                        addOutputAttributesToSpan(spanInfo, wrapCursorOutput(collectedDocs));
                        SpanUtils.endSpan(spanInfo.span, {
                          code: SpanStatusCode.OK,
                        });
                      } catch (error) {
                        logger.error(
                          `[${self.INSTRUMENTATION_NAME}] Error adding span attributes for ${spanName}.forEach:`,
                          error,
                        );
                      }
                    })
                    .catch((error: any) => {
                      try {
                        SpanUtils.addSpanAttributes(spanInfo.span, {
                          outputValue: {
                            error: error?.message || "Unknown error",
                          },
                        });
                        SpanUtils.endSpan(spanInfo.span, {
                          code: SpanStatusCode.ERROR,
                          message: error?.message || "forEach failed",
                        });
                      } catch (spanError) {
                        logger.error(
                          `[${self.INSTRUMENTATION_NAME}] Error recording cursor error span for ${spanName}.forEach:`,
                          spanError,
                        );
                      }
                      throw error;
                    });
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        });
      };
    }

    // --- Wrap [Symbol.asyncIterator] ---
    if (typeof cursor[Symbol.asyncIterator] === "function") {
      const originalAsyncIterator = cursor[Symbol.asyncIterator].bind(cursor);
      cursor[Symbol.asyncIterator] = async function* () {
        const shouldRecord = context.with(creationContext, () => ensureSpanCreated());
        if (!shouldRecord || cursorState.recorded) {
          yield* originalAsyncIterator();
          return;
        }
        cursorState.recorded = true;
        let spanFinalized = false;

        try {
          for await (const doc of {
            [Symbol.asyncIterator]: originalAsyncIterator,
          }) {
            cursorState.collectedDocuments.push(doc);
            yield doc;
          }
          // Directly finalize span — can't use finalizeCursorSpan() since recorded=true
          // is needed early to prevent the wrapped next() from double-recording documents
          if (cursorState.spanInfo) {
            addOutputAttributesToSpan(
              cursorState.spanInfo,
              wrapCursorOutput(cursorState.collectedDocuments),
            );
            SpanUtils.endSpan(cursorState.spanInfo.span, {
              code: SpanStatusCode.OK,
            });
            spanFinalized = true;
          }
        } catch (error: any) {
          // Directly handle error on span (same reason as above)
          if (cursorState.spanInfo) {
            SpanUtils.addSpanAttributes(cursorState.spanInfo.span, {
              outputValue: { error: error?.message || "Unknown error" },
            });
            SpanUtils.endSpan(cursorState.spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error?.message || "Cursor operation failed",
            });
            spanFinalized = true;
          }
          throw error;
        } finally {
          // Handle early break from for-await loop
          if (!spanFinalized && cursorState.spanInfo) {
            addOutputAttributesToSpan(
              cursorState.spanInfo,
              wrapCursorOutput(cursorState.collectedDocuments),
            );
            SpanUtils.endSpan(cursorState.spanInfo.span, {
              code: SpanStatusCode.OK,
            });
          }
        }
      };
    }
  }

  /**
   * Handle REPLAY mode for a cursor-returning method.
   * Returns a lazy fake cursor that defers mock data loading until
   * the first terminal method is called.
   */
  private _handleReplayCursorMethod(
    inputValue: MongodbCommandInputValue,
    spanName: string,
    submodule: string,
    methodName: string,
    creationContext: Context,
  ): any {
    const self = this;
    const stackTrace = captureStackTrace(["MongodbInstrumentation"]);

    // Create a mock data loader function (called lazily on first terminal method)
    const loadMockData = (): Promise<any[]> => {
      return context.with(creationContext, () => {
        return handleReplayMode({
          noOpRequestHandler: () => Promise.resolve([]),
          isServerRequest: false,
          replayModeHandler: () => {
            return SpanUtils.createAndExecuteSpan(
              self.mode,
              () => Promise.resolve([]),
              {
                name: spanName,
                kind: SpanKind.CLIENT,
                submodule,
                packageType: PackageType.MONGODB,
                packageName: "mongodb",
                instrumentationName: self.INSTRUMENTATION_NAME,
                inputValue,
                isPreAppStart: !self.tuskDrift.isAppReady(),
                stopRecordingChildSpans: true,
              },
              async (spanInfo: SpanInfo) => {
                try {
                  const mockData = await self._findMockData({
                    spanInfo,
                    name: spanName,
                    inputValue,
                    submoduleName: submodule,
                    stackTrace,
                  });

                  if (!mockData) {
                    const errorMsg = `[${self.INSTRUMENTATION_NAME}] No matching mock found for ${spanName} (collection: ${inputValue.collection})`;
                    logger.warn(errorMsg);
                    throw new Error(errorMsg);
                  }

                  const reconstructed = reconstructBsonValue(mockData.result, self.moduleExports);
                  const documents = unwrapCursorOutput(reconstructed);

                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.OK,
                  });
                  return documents;
                } catch (error: any) {
                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.ERROR,
                    message: error?.message || "Replay failed",
                  });
                  throw error;
                }
              },
            );
          },
        });
      });
    };

    if (methodName === "aggregate") {
      return new TdFakeAggregationCursor([], loadMockData);
    }
    return new TdFakeFindCursor([], loadMockData);
  }

  /**
   * Build the input value for a cursor-returning method call.
   * For find: captures filter and options.
   * For aggregate: captures pipeline and options.
   */
  private _extractCursorInput(
    methodName: string,
    collectionName: string | undefined,
    databaseName: string | undefined,
    args: any[],
  ): MongodbCommandInputValue {
    let commandArgs: Record<string, any>;

    if (methodName === "find") {
      commandArgs = {
        filter: args[0] || {},
        options: sanitizeOptions(args[1]),
      };
    } else if (methodName === "aggregate") {
      commandArgs = {
        pipeline: args[0] || [],
        options: sanitizeOptions(args[1]),
      };
    } else if (methodName === "listIndexes") {
      commandArgs = {
        options: sanitizeOptions(args[0]),
      };
    } else {
      commandArgs = { args: args.map((a: any, i: number) => ({ [i]: a })) };
    }

    return {
      command: methodName,
      collection: collectionName,
      database: databaseName,
      commandArgs: sanitizeBsonValue(commandArgs),
    };
  }

  // ---------------------------------------------------------------------------
  // Input extraction helpers
  // ---------------------------------------------------------------------------

  /**
   * Build the input value for a collection method call.
   * Extracts relevant arguments per method and sanitizes session/BSON.
   */
  private _extractCollectionInput(
    methodName: string,
    collectionName: string | undefined,
    databaseName: string | undefined,
    args: any[],
  ): MongodbCommandInputValue {
    const commandArgs = this._extractCommandArgs(methodName, args);

    return {
      command: methodName,
      collection: collectionName,
      database: databaseName,
      commandArgs: sanitizeBsonValue(commandArgs),
    };
  }

  /**
   * Extract command-specific arguments from the method call args.
   * Strips session from options for all methods.
   * Strips non-deterministic metadata from all operations so that mock
   * matching uses only the stable, user-provided content.
   */
  private _extractCommandArgs(methodName: string, args: any[]): Record<string, any> {
    // Strip non-deterministic metadata fields (_id, createdAt, updatedAt, __v)
    // from objects so the value hash is stable across recording and replay.
    // These fields change every run (client-generated ObjectIds, timestamps,
    // Mongoose version keys) and would cause hash mismatches.
    const stripMetadata = (obj: any) => {
      if (!obj || typeof obj !== "object") return obj;
      const { _id, createdAt, updatedAt, __v, ...rest } = obj;
      return rest;
    };

    switch (methodName) {
      case "findOne":
      case "countDocuments":
        // (filter?, options?)
        return {
          filter: stripMetadata(args[0]),
          options: sanitizeOptions(args[1]),
        };

      case "estimatedDocumentCount":
        // (options?)
        return {
          options: sanitizeOptions(args[0]),
        };

      case "insertOne":
        // (doc, options?)
        return {
          document: stripMetadata(args[0]),
          options: sanitizeOptions(args[1]),
        };

      case "insertMany":
        // (docs, options?)
        return {
          documents: Array.isArray(args[0]) ? args[0].map(stripMetadata) : args[0],
          options: sanitizeOptions(args[1]),
        };

      case "updateOne":
      case "updateMany":
      case "findOneAndUpdate":
        // (filter, update, options?)
        return {
          filter: stripMetadata(args[0]),
          update: args[1],
          options: sanitizeOptions(args[2]),
        };

      case "deleteOne":
      case "deleteMany":
      case "findOneAndDelete":
        // (filter, options?)
        return {
          filter: stripMetadata(args[0]),
          options: sanitizeOptions(args[1]),
        };

      case "replaceOne":
      case "findOneAndReplace":
        // (filter, replacement, options?)
        return {
          filter: stripMetadata(args[0]),
          replacement: args[1],
          options: sanitizeOptions(args[2]),
        };

      case "distinct":
        // (key, filter?, options?)
        return {
          key: args[0],
          filter: stripMetadata(args[1]),
          options: sanitizeOptions(args[2]),
        };

      case "bulkWrite":
        // (operations, options?)
        return {
          operations: args[0],
          options: sanitizeOptions(args[1]),
        };

      // Collection index operations
      case "createIndex":
        // (indexSpec, options?)
        return {
          indexSpec: args[0],
          options: sanitizeOptions(args[1]),
        };

      case "createIndexes":
        // (indexSpecs, options?)
        return {
          indexSpecs: args[0],
          options: sanitizeOptions(args[1]),
        };

      case "dropIndex":
        // (indexName, options?)
        return {
          indexName: args[0],
          options: sanitizeOptions(args[1]),
        };

      case "dropIndexes":
        // (options?)
        return {
          options: sanitizeOptions(args[0]),
        };

      case "indexes":
        // (options?)
        return {
          options: sanitizeOptions(args[0]),
        };

      default:
        return { args: args.map((a: any, i: number) => ({ [i]: a })) };
    }
  }

  // ---------------------------------------------------------------------------
  // Mock data lookup
  // ---------------------------------------------------------------------------

  /**
   * Find mock response data for replay mode.
   * Wraps the core findMockResponseAsync utility.
   */
  private async _findMockData({
    spanInfo,
    name,
    inputValue,
    submoduleName,
    stackTrace,
  }: {
    spanInfo: SpanInfo;
    name: string;
    inputValue: any;
    submoduleName: string;
    stackTrace?: string;
  }): Promise<any> {
    return findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name,
        inputValue: createMockInputValue(inputValue),
        packageName: "mongodb",
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName,
        kind: SpanKind.CLIENT,
        stackTrace,
      },
      tuskDrift: this.tuskDrift,
    });
  }

  // ---------------------------------------------------------------------------
  // No-op results for replay background requests
  // ---------------------------------------------------------------------------

  /**
   * Returns an appropriate empty result for a given collection method.
   * Used for background requests in replay mode (app ready, no parent span).
   */
  private _getNoOpResult(methodName: string): any {
    switch (methodName) {
      case "findOne":
      case "findOneAndUpdate":
      case "findOneAndDelete":
      case "findOneAndReplace":
        return null;

      case "insertOne":
        return { acknowledged: false, insertedId: null };

      case "insertMany":
        return { acknowledged: false, insertedIds: {}, insertedCount: 0 };

      case "updateOne":
      case "updateMany":
      case "replaceOne":
        return {
          acknowledged: false,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 0,
          upsertedId: null,
        };

      case "deleteOne":
      case "deleteMany":
        return { acknowledged: false, deletedCount: 0 };

      case "countDocuments":
      case "estimatedDocumentCount":
        return 0;

      case "distinct":
        return [];

      case "bulkWrite":
        return {
          acknowledged: false,
          insertedCount: 0,
          matchedCount: 0,
          modifiedCount: 0,
          deletedCount: 0,
          upsertedCount: 0,
          insertedIds: {},
          upsertedIds: {},
        };

      // Collection index operations
      case "createIndex":
        return "";

      case "createIndexes":
        return [];

      case "dropIndex":
        return {};

      case "dropIndexes":
        return { ok: 1 };

      case "indexes":
        return [];

      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Db-level promise method patching
  // ---------------------------------------------------------------------------

  /**
   * Patch Db.prototype methods that return Promises (command, createCollection,
   * dropCollection, dropDatabase).
   */
  private _patchDbMethods(actualExports: any): void {
    const Db = actualExports.Db;
    if (!Db || !Db.prototype) {
      logger.warn(
        `[${this.INSTRUMENTATION_NAME}] Db not found in module exports, skipping Db method patching`,
      );
      return;
    }

    for (const methodName of DB_METHODS_TO_WRAP) {
      if (typeof Db.prototype[methodName] === "function") {
        this._wrap(Db.prototype, methodName, this._getDbMethodWrapper(methodName));
        logger.debug(`[${this.INSTRUMENTATION_NAME}] Wrapped Db.prototype.${methodName}`);
      } else {
        logger.debug(
          `[${this.INSTRUMENTATION_NAME}] Db.prototype.${methodName} not found, skipping`,
        );
      }
    }
  }

  /**
   * Returns a wrapper function for a given Db method.
   * Handles RECORD, REPLAY, and DISABLED modes.
   */
  private _getDbMethodWrapper(methodName: string): (original: Function) => Function {
    const self = this;
    const spanName = `mongodb.db.${methodName}`;
    const submodule = `db-${methodName}`;

    return (original: Function) => {
      return function (this: any, ...args: any[]) {
        const databaseName = this?.databaseName || this?.s?.namespace?.db;
        const inputValue = self._extractDbInput(methodName, databaseName, args);

        if (self.mode === TuskDriftMode.DISABLED) {
          return original.apply(this, args);
        }

        if (self.mode === TuskDriftMode.RECORD) {
          if (methodName === "createCollection") {
            return self._handleRecordCreateCollection(
              original,
              this,
              args,
              inputValue,
              spanName,
              submodule,
            );
          }
          return self._handleRecordDbMethod(original, this, args, inputValue, spanName, submodule);
        }

        if (self.mode === TuskDriftMode.REPLAY) {
          if (methodName === "createCollection") {
            return self._handleReplayCreateCollection(this, args, inputValue, spanName, submodule);
          }
          return self._handleReplayDbMethod(
            original,
            this,
            args,
            inputValue,
            spanName,
            submodule,
            methodName,
          );
        }

        return original.apply(this, args);
      };
    };
  }

  /**
   * Handle RECORD mode for a Db method.
   * Same structure as _handleRecordCollectionMethod.
   */
  private _handleRecordDbMethod(
    original: Function,
    thisArg: any,
    args: any[],
    inputValue: MongodbCommandInputValue,
    spanName: string,
    submodule: string,
  ): any {
    return handleRecordMode({
      originalFunctionCall: () => original.apply(thisArg, args),
      recordModeHandler: ({ isPreAppStart }) => {
        return SpanUtils.createAndExecuteSpan(
          this.mode,
          () => original.apply(thisArg, args),
          {
            name: spanName,
            kind: SpanKind.CLIENT,
            submodule,
            packageType: PackageType.MONGODB,
            packageName: "mongodb",
            instrumentationName: this.INSTRUMENTATION_NAME,
            inputValue,
            isPreAppStart,
            stopRecordingChildSpans: true,
          },
          (spanInfo: SpanInfo) => {
            const resultPromise = original.apply(thisArg, args) as Promise<any>;

            return resultPromise
              .then((result: any) => {
                try {
                  addOutputAttributesToSpan(spanInfo, wrapDirectOutput(result));
                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.OK,
                  });
                } catch (error) {
                  logger.error(
                    `[${this.INSTRUMENTATION_NAME}] Error adding span attributes for ${spanName}:`,
                    error,
                  );
                }
                return result;
              })
              .catch((error: any) => {
                try {
                  SpanUtils.addSpanAttributes(spanInfo.span, {
                    outputValue: {
                      error: error?.message || "Unknown error",
                    },
                  });
                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.ERROR,
                    message: error?.message || "Operation failed",
                  });
                } catch (spanError) {
                  logger.error(
                    `[${this.INSTRUMENTATION_NAME}] Error recording span for ${spanName} error:`,
                    spanError,
                  );
                }
                throw error;
              });
          },
        );
      },
      spanKind: SpanKind.CLIENT,
    });
  }

  /**
   * Handle REPLAY mode for a Db method.
   * Same structure as _handleReplayCollectionMethod.
   */
  private _handleReplayDbMethod(
    original: Function,
    thisArg: any,
    args: any[],
    inputValue: MongodbCommandInputValue,
    spanName: string,
    submodule: string,
    methodName: string,
  ): any {
    const stackTrace = captureStackTrace(["MongodbInstrumentation"]);

    return handleReplayMode({
      noOpRequestHandler: () => {
        return Promise.resolve(this._getDbNoOpResult(methodName));
      },
      isServerRequest: false,
      replayModeHandler: () => {
        return SpanUtils.createAndExecuteSpan(
          this.mode,
          () => original.apply(thisArg, args),
          {
            name: spanName,
            kind: SpanKind.CLIENT,
            submodule,
            packageType: PackageType.MONGODB,
            packageName: "mongodb",
            instrumentationName: this.INSTRUMENTATION_NAME,
            inputValue,
            isPreAppStart: !this.tuskDrift.isAppReady(),
            stopRecordingChildSpans: true,
          },
          async (spanInfo: SpanInfo) => {
            try {
              const mockData = await this._findMockData({
                spanInfo,
                name: spanName,
                inputValue,
                submoduleName: submodule,
                stackTrace,
              });

              if (!mockData) {
                const errorMsg = `[${this.INSTRUMENTATION_NAME}] No matching mock found for ${spanName} (database: ${inputValue.database})`;
                logger.warn(errorMsg);
                throw new Error(errorMsg);
              }

              const result = unwrapDirectOutput(
                reconstructBsonValue(mockData.result, this.moduleExports),
              );

              SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
              return result;
            } catch (error: any) {
              SpanUtils.endSpan(spanInfo.span, {
                code: SpanStatusCode.ERROR,
                message: error?.message || "Replay failed",
              });
              throw error;
            }
          },
        );
      },
    });
  }

  // ---------------------------------------------------------------------------
  // createCollection special handling
  // ---------------------------------------------------------------------------

  /**
   * Handle RECORD mode for createCollection.
   * Collection objects are not serializable, so we record
   * { collectionName } as the output instead of the actual Collection.
   */
  private _handleRecordCreateCollection(
    original: Function,
    thisArg: any,
    args: any[],
    inputValue: MongodbCommandInputValue,
    spanName: string,
    submodule: string,
  ): any {
    return handleRecordMode({
      originalFunctionCall: () => original.apply(thisArg, args),
      recordModeHandler: ({ isPreAppStart }) => {
        return SpanUtils.createAndExecuteSpan(
          this.mode,
          () => original.apply(thisArg, args),
          {
            name: spanName,
            kind: SpanKind.CLIENT,
            submodule,
            packageType: PackageType.MONGODB,
            packageName: "mongodb",
            instrumentationName: this.INSTRUMENTATION_NAME,
            inputValue,
            isPreAppStart,
            stopRecordingChildSpans: true,
          },
          (spanInfo: SpanInfo) => {
            const resultPromise = original.apply(thisArg, args) as Promise<any>;

            return resultPromise
              .then((result: any) => {
                try {
                  // Collection objects are not serializable — record the name only
                  const collectionName = args[0];
                  SpanUtils.addSpanAttributes(spanInfo.span, {
                    outputValue: sanitizeBsonValue({ collectionName }),
                  });
                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.OK,
                  });
                } catch (error) {
                  logger.error(
                    `[${this.INSTRUMENTATION_NAME}] Error adding span attributes for ${spanName}:`,
                    error,
                  );
                }
                return result;
              })
              .catch((error: any) => {
                try {
                  SpanUtils.addSpanAttributes(spanInfo.span, {
                    outputValue: {
                      error: error?.message || "Unknown error",
                    },
                  });
                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.ERROR,
                    message: error?.message || "Operation failed",
                  });
                } catch (spanError) {
                  logger.error(
                    `[${this.INSTRUMENTATION_NAME}] Error recording span for ${spanName} error:`,
                    spanError,
                  );
                }
                throw error;
              });
          },
        );
      },
      spanKind: SpanKind.CLIENT,
    });
  }

  /**
   * Handle REPLAY mode for createCollection.
   * Returns a Collection reference via thisArg.collection(name) which
   * is synchronous and doesn't require a server connection.
   */
  private _handleReplayCreateCollection(
    thisArg: any,
    args: any[],
    inputValue: MongodbCommandInputValue,
    spanName: string,
    submodule: string,
  ): any {
    const stackTrace = captureStackTrace(["MongodbInstrumentation"]);
    const collectionName = args[0];

    return handleReplayMode({
      noOpRequestHandler: () => {
        return Promise.resolve(thisArg.collection(collectionName));
      },
      isServerRequest: false,
      replayModeHandler: () => {
        return SpanUtils.createAndExecuteSpan(
          this.mode,
          () => Promise.resolve(thisArg.collection(collectionName)),
          {
            name: spanName,
            kind: SpanKind.CLIENT,
            submodule,
            packageType: PackageType.MONGODB,
            packageName: "mongodb",
            instrumentationName: this.INSTRUMENTATION_NAME,
            inputValue,
            isPreAppStart: !this.tuskDrift.isAppReady(),
            stopRecordingChildSpans: true,
          },
          async (spanInfo: SpanInfo) => {
            try {
              // Consume mock data to advance the mock counter
              await this._findMockData({
                spanInfo,
                name: spanName,
                inputValue,
                submoduleName: submodule,
                stackTrace,
              });

              SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
              return thisArg.collection(collectionName);
            } catch (error: any) {
              SpanUtils.endSpan(spanInfo.span, {
                code: SpanStatusCode.ERROR,
                message: error?.message || "Replay failed",
              });
              throw error;
            }
          },
        );
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Db-level cursor method patching (listCollections, Db.aggregate)
  // ---------------------------------------------------------------------------

  /**
   * Patch Db.prototype cursor-returning methods (listCollections, aggregate).
   */
  private _patchDbCursorMethods(actualExports: any): void {
    const Db = actualExports.Db;
    if (!Db || !Db.prototype) {
      logger.warn(
        `[${this.INSTRUMENTATION_NAME}] Db not found, skipping Db cursor method patching`,
      );
      return;
    }

    for (const methodName of DB_CURSOR_METHODS_TO_WRAP) {
      if (typeof Db.prototype[methodName] === "function") {
        this._wrap(Db.prototype, methodName, this._getDbCursorMethodWrapper(methodName));
        logger.debug(`[${this.INSTRUMENTATION_NAME}] Wrapped Db.prototype.${methodName}`);
      } else {
        logger.debug(
          `[${this.INSTRUMENTATION_NAME}] Db.prototype.${methodName} not found, skipping`,
        );
      }
    }
  }

  /**
   * Returns a wrapper function for a cursor-returning Db method.
   * Similar to _getCursorMethodWrapper but for Db-level operations.
   */
  private _getDbCursorMethodWrapper(methodName: string): (original: Function) => Function {
    const self = this;
    const spanName = `mongodb.db.${methodName}`;
    const submodule = `db-${methodName}`;

    return (original: Function) => {
      return function (this: any, ...args: any[]) {
        const databaseName = this?.databaseName || this?.s?.namespace?.db;
        const inputValue = self._extractDbCursorInput(methodName, databaseName, args);

        if (self.mode === TuskDriftMode.DISABLED) {
          return original.apply(this, args);
        }

        const creationContext = context.active();

        if (self.mode === TuskDriftMode.RECORD) {
          return self._handleRecordCursorMethod(
            original,
            this,
            args,
            inputValue,
            spanName,
            submodule,
            creationContext,
          );
        }

        if (self.mode === TuskDriftMode.REPLAY) {
          return self._handleReplayDbCursorMethod(
            inputValue,
            spanName,
            submodule,
            methodName,
            creationContext,
          );
        }

        return original.apply(this, args);
      };
    };
  }

  /**
   * Handle REPLAY mode for a Db cursor-returning method.
   * Returns a fake cursor with lazy mock data loading.
   */
  private _handleReplayDbCursorMethod(
    inputValue: MongodbCommandInputValue,
    spanName: string,
    submodule: string,
    methodName: string,
    creationContext: Context,
  ): any {
    const self = this;
    const stackTrace = captureStackTrace(["MongodbInstrumentation"]);

    const loadMockData = (): Promise<any[]> => {
      return context.with(creationContext, () => {
        return handleReplayMode({
          noOpRequestHandler: () => Promise.resolve([]),
          isServerRequest: false,
          replayModeHandler: () => {
            return SpanUtils.createAndExecuteSpan(
              self.mode,
              () => Promise.resolve([]),
              {
                name: spanName,
                kind: SpanKind.CLIENT,
                submodule,
                packageType: PackageType.MONGODB,
                packageName: "mongodb",
                instrumentationName: self.INSTRUMENTATION_NAME,
                inputValue,
                isPreAppStart: !self.tuskDrift.isAppReady(),
                stopRecordingChildSpans: true,
              },
              async (spanInfo: SpanInfo) => {
                try {
                  const mockData = await self._findMockData({
                    spanInfo,
                    name: spanName,
                    inputValue,
                    submoduleName: submodule,
                    stackTrace,
                  });

                  if (!mockData) {
                    const errorMsg = `[${self.INSTRUMENTATION_NAME}] No matching mock found for ${spanName} (database: ${inputValue.database})`;
                    logger.warn(errorMsg);
                    throw new Error(errorMsg);
                  }

                  const reconstructed = reconstructBsonValue(mockData.result, self.moduleExports);
                  const documents = unwrapCursorOutput(reconstructed);

                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.OK,
                  });
                  return documents;
                } catch (error: any) {
                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.ERROR,
                    message: error?.message || "Replay failed",
                  });
                  throw error;
                }
              },
            );
          },
        });
      });
    };

    if (methodName === "aggregate") {
      return new TdFakeAggregationCursor([], loadMockData);
    }
    return new TdFakeFindCursor([], loadMockData);
  }

  // ---------------------------------------------------------------------------
  // Db-level input extraction
  // ---------------------------------------------------------------------------

  /**
   * Build the input value for a Db method call.
   */
  private _extractDbInput(
    methodName: string,
    databaseName: string | undefined,
    args: any[],
  ): MongodbCommandInputValue {
    const commandArgs = this._extractDbCommandArgs(methodName, args);

    return {
      command: methodName,
      database: databaseName,
      commandArgs: sanitizeBsonValue(commandArgs),
    };
  }

  /**
   * Extract command-specific arguments from a Db method call.
   */
  private _extractDbCommandArgs(methodName: string, args: any[]): Record<string, any> {
    switch (methodName) {
      case "command":
        // (command, options?)
        return {
          command: args[0],
          options: sanitizeOptions(args[1]),
        };

      case "createCollection":
        // (name, options?)
        return {
          collectionName: args[0],
          options: sanitizeOptions(args[1]),
        };

      case "dropCollection":
        // (name, options?)
        return {
          collectionName: args[0],
          options: sanitizeOptions(args[1]),
        };

      case "dropDatabase":
        // (options?)
        return {
          options: sanitizeOptions(args[0]),
        };

      default:
        return { args: args.map((a: any, i: number) => ({ [i]: a })) };
    }
  }

  /**
   * Build the input value for a cursor-returning Db method call.
   */
  private _extractDbCursorInput(
    methodName: string,
    databaseName: string | undefined,
    args: any[],
  ): MongodbCommandInputValue {
    let commandArgs: Record<string, any>;

    if (methodName === "listCollections") {
      commandArgs = {
        filter: args[0] || {},
        options: sanitizeOptions(args[1]),
      };
    } else if (methodName === "aggregate") {
      commandArgs = {
        pipeline: args[0] || [],
        options: sanitizeOptions(args[1]),
      };
    } else {
      commandArgs = { args: args.map((a: any, i: number) => ({ [i]: a })) };
    }

    return {
      command: methodName,
      database: databaseName,
      commandArgs: sanitizeBsonValue(commandArgs),
    };
  }

  // ---------------------------------------------------------------------------
  // Db no-op results
  // ---------------------------------------------------------------------------

  /**
   * Returns an appropriate empty result for a given Db method.
   * Used for background requests in replay mode.
   */
  private _getDbNoOpResult(methodName: string): any {
    switch (methodName) {
      case "command":
        return {};

      case "dropCollection":
        return true;

      case "dropDatabase":
        return true;

      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Session & Transaction patching
  // ---------------------------------------------------------------------------

  /**
   * Patch ClientSession.prototype methods from the mongodb/lib/sessions.js
   * internal module file. Wraps commitTransaction, abortTransaction, and
   * endSession for record/replay.
   */
  private _patchSessionModule(moduleExports: any): any {
    logger.debug(`[${this.INSTRUMENTATION_NAME}] Patching session module`);

    if (this.isModulePatched(moduleExports)) {
      logger.debug(`[${this.INSTRUMENTATION_NAME}] Session module already patched, skipping`);
      return moduleExports;
    }

    if (!moduleExports?.ClientSession?.prototype) {
      logger.warn(
        `[${this.INSTRUMENTATION_NAME}] ClientSession not found in sessions module, skipping`,
      );
      return moduleExports;
    }

    if (typeof moduleExports.ClientSession.prototype.commitTransaction === "function") {
      this._wrap(
        moduleExports.ClientSession.prototype,
        "commitTransaction",
        this._getSessionMethodWrapper("commitTransaction"),
      );
      logger.debug(
        `[${this.INSTRUMENTATION_NAME}] Wrapped ClientSession.prototype.commitTransaction`,
      );
    }

    if (typeof moduleExports.ClientSession.prototype.abortTransaction === "function") {
      this._wrap(
        moduleExports.ClientSession.prototype,
        "abortTransaction",
        this._getSessionMethodWrapper("abortTransaction"),
      );
      logger.debug(
        `[${this.INSTRUMENTATION_NAME}] Wrapped ClientSession.prototype.abortTransaction`,
      );
    }

    if (typeof moduleExports.ClientSession.prototype.endSession === "function") {
      this._wrap(moduleExports.ClientSession.prototype, "endSession", this._getEndSessionWrapper());
      logger.debug(`[${this.INSTRUMENTATION_NAME}] Wrapped ClientSession.prototype.endSession`);
    }

    this.markModuleAsPatched(moduleExports);
    logger.debug(`[${this.INSTRUMENTATION_NAME}] Session module patching complete`);
    return moduleExports;
  }

  /**
   * Returns a wrapper for MongoClient.prototype.startSession.
   * startSession is synchronous and returns a ClientSession instance.
   * In all modes we call the original — the session's prototype methods
   * (commitTransaction, abortTransaction, endSession) are already patched
   * via file-level patching of mongodb/lib/sessions.js.
   */
  private _getStartSessionWrapper(): (original: Function) => Function {
    const self = this;
    return (original: Function) => {
      return function (this: any, ...args: any[]) {
        if (self.mode === TuskDriftMode.REPLAY) {
          // In replay mode, still create a real session object.
          // Its methods (commitTransaction, abortTransaction, endSession)
          // are already patched on the prototype and will handle replay.
          logger.debug(`[${self.INSTRUMENTATION_NAME}] startSession called in REPLAY mode`);
          return original.apply(this, args);
        }
        return original.apply(this, args);
      };
    };
  }

  // ---------------------------------------------------------------------------
  // ChangeStream (watch) handling
  // ---------------------------------------------------------------------------

  /**
   * Patch watch() methods on Collection, Db, and MongoClient prototypes.
   * ChangeStreams are long-lived event-based streams not suited for
   * span-level record/replay. In RECORD mode: passthrough.
   * In REPLAY mode: return a fake ChangeStream that emits no events.
   */
  private _patchWatchMethods(actualExports: any): void {
    const self = this;

    const targets = [
      { proto: actualExports.Collection?.prototype, name: "Collection" },
      { proto: actualExports.Db?.prototype, name: "Db" },
      { proto: actualExports.MongoClient?.prototype, name: "MongoClient" },
    ];

    for (const { proto, name } of targets) {
      if (proto && typeof proto.watch === "function") {
        this._wrap(proto, "watch", (original: Function) => {
          return function (this: any, ...args: any[]) {
            if (self.mode === TuskDriftMode.REPLAY) {
              logger.debug(
                `[${self.INSTRUMENTATION_NAME}] ${name}.watch() called in REPLAY mode, returning fake ChangeStream`,
              );
              return new TdFakeChangeStream();
            }
            // RECORD and DISABLED: passthrough
            return original.apply(this, args);
          };
        });
        logger.debug(`[${this.INSTRUMENTATION_NAME}] Wrapped ${name}.prototype.watch`);
      }
    }
  }

  /**
   * Returns a wrapper function for commitTransaction or abortTransaction.
   * Both are async and follow the same record/replay pattern.
   */
  private _getSessionMethodWrapper(methodName: string): (original: Function) => Function {
    const self = this;
    const spanName = `mongodb.session.${methodName}`;
    const submodule = `session-${methodName}`;

    return (original: Function) => {
      return function (this: any, ...args: any[]) {
        const inputValue: MongodbCommandInputValue = {
          command: methodName,
        };

        if (self.mode === TuskDriftMode.DISABLED) {
          return original.apply(this, args);
        }

        if (self.mode === TuskDriftMode.RECORD) {
          return self._handleRecordSessionMethod(
            original,
            this,
            args,
            inputValue,
            spanName,
            submodule,
          );
        }

        if (self.mode === TuskDriftMode.REPLAY) {
          return self._handleReplaySessionMethod(
            original,
            this,
            args,
            inputValue,
            spanName,
            submodule,
          );
        }

        return original.apply(this, args);
      };
    };
  }

  /**
   * Handle RECORD mode for a session method (commitTransaction / abortTransaction).
   * Calls the original method, wraps the promise to capture output, creates a span.
   */
  private _handleRecordSessionMethod(
    original: Function,
    thisArg: any,
    args: any[],
    inputValue: MongodbCommandInputValue,
    spanName: string,
    submodule: string,
  ): any {
    return handleRecordMode({
      originalFunctionCall: () => original.apply(thisArg, args),
      recordModeHandler: ({ isPreAppStart }) => {
        return SpanUtils.createAndExecuteSpan(
          this.mode,
          () => original.apply(thisArg, args),
          {
            name: spanName,
            kind: SpanKind.CLIENT,
            submodule,
            packageType: PackageType.MONGODB,
            packageName: "mongodb",
            instrumentationName: this.INSTRUMENTATION_NAME,
            inputValue,
            isPreAppStart,
            stopRecordingChildSpans: true,
          },
          (spanInfo: SpanInfo) => {
            const resultPromise = original.apply(thisArg, args) as Promise<any>;

            return resultPromise
              .then((result: any) => {
                try {
                  addOutputAttributesToSpan(spanInfo, result ?? { success: true });
                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.OK,
                  });
                } catch (error) {
                  logger.error(
                    `[${this.INSTRUMENTATION_NAME}] Error adding span attributes for ${spanName}:`,
                    error,
                  );
                }
                return result;
              })
              .catch((error: any) => {
                try {
                  SpanUtils.addSpanAttributes(spanInfo.span, {
                    outputValue: {
                      error: error?.message || "Unknown error",
                    },
                  });
                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.ERROR,
                    message: error?.message || "Operation failed",
                  });
                } catch (spanError) {
                  logger.error(
                    `[${this.INSTRUMENTATION_NAME}] Error recording span for ${spanName} error:`,
                    spanError,
                  );
                }
                throw error;
              });
          },
        );
      },
      spanKind: SpanKind.CLIENT,
    });
  }

  /**
   * Handle REPLAY mode for a session method (commitTransaction / abortTransaction).
   * Looks up mock data, returns mocked result.
   */
  private _handleReplaySessionMethod(
    original: Function,
    thisArg: any,
    args: any[],
    inputValue: MongodbCommandInputValue,
    spanName: string,
    submodule: string,
  ): any {
    const stackTrace = captureStackTrace(["MongodbInstrumentation"]);

    return handleReplayMode({
      noOpRequestHandler: () => Promise.resolve(undefined),
      isServerRequest: false,
      replayModeHandler: () => {
        return SpanUtils.createAndExecuteSpan(
          this.mode,
          () => original.apply(thisArg, args),
          {
            name: spanName,
            kind: SpanKind.CLIENT,
            submodule,
            packageType: PackageType.MONGODB,
            packageName: "mongodb",
            instrumentationName: this.INSTRUMENTATION_NAME,
            inputValue,
            isPreAppStart: !this.tuskDrift.isAppReady(),
            stopRecordingChildSpans: true,
          },
          async (spanInfo: SpanInfo) => {
            try {
              const mockData = await this._findMockData({
                spanInfo,
                name: spanName,
                inputValue,
                submoduleName: submodule,
                stackTrace,
              });

              // Session operations return void — treat missing mock result as success
              const result =
                mockData?.result != null
                  ? reconstructBsonValue(mockData.result, this.moduleExports)
                  : undefined;

              SpanUtils.endSpan(spanInfo.span, {
                code: SpanStatusCode.OK,
              });
              return result;
            } catch (error: any) {
              SpanUtils.endSpan(spanInfo.span, {
                code: SpanStatusCode.ERROR,
                message: error?.message || "Replay failed",
              });
              throw error;
            }
          },
        );
      },
    });
  }

  /**
   * Returns a wrapper for ClientSession.prototype.endSession.
   * - RECORD: call original (let real session clean up)
   * - REPLAY: no-op (no real session to end)
   * - DISABLED: passthrough
   */
  private _getEndSessionWrapper(): (original: Function) => Function {
    const self = this;
    return (original: Function) => {
      return function (this: any, ...args: any[]) {
        if (self.mode === TuskDriftMode.RECORD) {
          return original.apply(this, args);
        }
        if (self.mode === TuskDriftMode.REPLAY) {
          return Promise.resolve();
        }
        return original.apply(this, args);
      };
    };
  }

  // ---------------------------------------------------------------------------
  // Bulk Operations (Ordered/Unordered)
  // ---------------------------------------------------------------------------

  /**
   * Patch Collection.prototype.initializeOrderedBulkOp and
   * Collection.prototype.initializeUnorderedBulkOp.
   *
   * In replay mode, BulkOperationBase's constructor calls getTopology(collection)
   * which throws if no topology is connected. We inject a FakeTopology onto the
   * collection (and its client) BEFORE calling the original, so the constructor
   * finds a valid topology object and proceeds with default size limits.
   */
  private _patchBulkOpInitMethods(actualExports: any): void {
    const Collection = actualExports.Collection;
    if (!Collection || !Collection.prototype) {
      logger.warn(
        `[${this.INSTRUMENTATION_NAME}] Collection not found, skipping bulk op init patching`,
      );
      return;
    }

    const self = this;

    // Patch initializeOrderedBulkOp
    if (typeof Collection.prototype.initializeOrderedBulkOp === "function") {
      this._wrap(Collection.prototype, "initializeOrderedBulkOp", (original: Function) => {
        return function (this: any, ...args: any[]) {
          if (self.mode === TuskDriftMode.REPLAY) {
            self._injectFakeTopology(this);
          }
          return original.apply(this, args);
        };
      });
      logger.debug(
        `[${this.INSTRUMENTATION_NAME}] Wrapped Collection.prototype.initializeOrderedBulkOp`,
      );
    }

    // Patch initializeUnorderedBulkOp
    if (typeof Collection.prototype.initializeUnorderedBulkOp === "function") {
      this._wrap(Collection.prototype, "initializeUnorderedBulkOp", (original: Function) => {
        return function (this: any, ...args: any[]) {
          if (self.mode === TuskDriftMode.REPLAY) {
            self._injectFakeTopology(this);
          }
          return original.apply(this, args);
        };
      });
      logger.debug(
        `[${this.INSTRUMENTATION_NAME}] Wrapped Collection.prototype.initializeUnorderedBulkOp`,
      );
    }
  }

  /**
   * Inject a FakeTopology onto a collection and its client for replay mode.
   *
   * getTopology() in the MongoDB driver checks:
   *   1. provider.topology (direct property on collection)
   *   2. provider.client.topology (via the MongoClient)
   * We set both to ensure the topology lookup succeeds.
   */
  private _injectFakeTopology(collection: any): void {
    const fakeTopology = new TdFakeTopology();

    // Set on the client (satisfies getTopology's client.topology check)
    if (collection.client && !collection.client.topology) {
      collection.client.topology = fakeTopology;
    }

    // Set on collection directly as fallback
    if (!collection.topology) {
      collection.topology = fakeTopology;
    }
  }

  /**
   * Patch OrderedBulkOperation.prototype.execute from mongodb/lib/bulk/ordered.js.
   */
  private _patchOrderedBulkModule(moduleExports: any): any {
    logger.debug(`[${this.INSTRUMENTATION_NAME}] Patching ordered bulk operation module`);

    if (this.isModulePatched(moduleExports)) {
      logger.debug(`[${this.INSTRUMENTATION_NAME}] Ordered bulk module already patched, skipping`);
      return moduleExports;
    }

    if (!moduleExports?.OrderedBulkOperation?.prototype) {
      logger.warn(
        `[${this.INSTRUMENTATION_NAME}] OrderedBulkOperation not found in bulk/ordered module, skipping`,
      );
      return moduleExports;
    }

    if (typeof moduleExports.OrderedBulkOperation.prototype.execute === "function") {
      this._wrap(
        moduleExports.OrderedBulkOperation.prototype,
        "execute",
        this._getBulkOpExecuteWrapper(true),
      );
      logger.debug(`[${this.INSTRUMENTATION_NAME}] Wrapped OrderedBulkOperation.prototype.execute`);
    }

    this.markModuleAsPatched(moduleExports);
    return moduleExports;
  }

  /**
   * Patch UnorderedBulkOperation.prototype.execute from mongodb/lib/bulk/unordered.js.
   */
  private _patchUnorderedBulkModule(moduleExports: any): any {
    logger.debug(`[${this.INSTRUMENTATION_NAME}] Patching unordered bulk operation module`);

    if (this.isModulePatched(moduleExports)) {
      logger.debug(
        `[${this.INSTRUMENTATION_NAME}] Unordered bulk module already patched, skipping`,
      );
      return moduleExports;
    }

    if (!moduleExports?.UnorderedBulkOperation?.prototype) {
      logger.warn(
        `[${this.INSTRUMENTATION_NAME}] UnorderedBulkOperation not found in bulk/unordered module, skipping`,
      );
      return moduleExports;
    }

    if (typeof moduleExports.UnorderedBulkOperation.prototype.execute === "function") {
      this._wrap(
        moduleExports.UnorderedBulkOperation.prototype,
        "execute",
        this._getBulkOpExecuteWrapper(false),
      );
      logger.debug(
        `[${this.INSTRUMENTATION_NAME}] Wrapped UnorderedBulkOperation.prototype.execute`,
      );
    }

    this.markModuleAsPatched(moduleExports);
    return moduleExports;
  }

  /**
   * Returns a wrapper function for BulkOperation.prototype.execute.
   * @param isOrdered — true for OrderedBulkOperation, false for UnorderedBulkOperation
   */
  private _getBulkOpExecuteWrapper(isOrdered: boolean): (original: Function) => Function {
    const self = this;
    const opType = isOrdered ? "ordered" : "unordered";
    const spanName = "mongodb.bulkOp.execute";
    const submodule = `bulkOp-${opType}Execute`;

    return (original: Function) => {
      return function (this: any, ...args: any[]) {
        const collectionName = this?.s?.namespace?.collection;
        const databaseName = this?.s?.namespace?.db;
        const inputValue = self._extractBulkOpInput(
          this,
          isOrdered,
          collectionName,
          databaseName,
          args,
        );

        if (self.mode === TuskDriftMode.DISABLED) {
          return original.apply(this, args);
        }

        if (self.mode === TuskDriftMode.RECORD) {
          return self._handleRecordBulkOpExecute(
            original,
            this,
            args,
            inputValue,
            spanName,
            submodule,
          );
        }

        if (self.mode === TuskDriftMode.REPLAY) {
          return self._handleReplayBulkOpExecute(
            original,
            this,
            args,
            inputValue,
            spanName,
            submodule,
          );
        }

        return original.apply(this, args);
      };
    };
  }

  /**
   * Extract input from a bulk operation's internal state.
   * Reads queued operations from batches before execute() moves them.
   */
  private _extractBulkOpInput(
    bulkOp: any,
    isOrdered: boolean,
    collectionName: string | undefined,
    databaseName: string | undefined,
    args: any[],
  ): MongodbCommandInputValue {
    const operations = this._extractBulkOpOperations(bulkOp, isOrdered);

    return {
      command: "bulkOp.execute",
      collection: collectionName,
      database: databaseName,
      commandArgs: sanitizeBsonValue({
        isOrdered,
        operations,
        options: sanitizeOptions(args[0]),
      }),
    };
  }

  /**
   * Extract readable operations from a bulk operation's internal state.
   * Must be called BEFORE original execute() since execute() moves
   * currentBatch into batches and clears state.
   *
   * Internal state layout:
   * - Ordered: s.batches[] + s.currentBatch
   * - Unordered: s.batches[] + s.currentInsertBatch + s.currentUpdateBatch + s.currentRemoveBatch
   *
   * BatchType constants: INSERT=1, UPDATE=2, DELETE=3
   */
  private _extractBulkOpOperations(bulkOp: any, isOrdered: boolean): any[] {
    try {
      const internalState = bulkOp?.s;
      if (!internalState) {
        return [];
      }

      let batches: any[] = [];

      if (isOrdered) {
        const { batches: internalBatches, currentBatch } = internalState;
        batches = [...(internalBatches || [])];
        if (currentBatch) {
          batches.push(currentBatch);
        }
      } else {
        const {
          batches: internalBatches,
          currentInsertBatch,
          currentUpdateBatch,
          currentRemoveBatch,
        } = internalState;
        batches = [...(internalBatches || [])];
        if (currentInsertBatch) {
          batches.push(currentInsertBatch);
        }
        if (currentUpdateBatch) {
          batches.push(currentUpdateBatch);
        }
        if (currentRemoveBatch) {
          batches.push(currentRemoveBatch);
        }
      }

      const readableOperations: any[] = [];
      for (const batch of batches) {
        if (!batch?.operations) {
          continue;
        }
        const { batchType, operations } = batch;
        for (const operation of operations) {
          readableOperations.push(this._makeReadableOperation(operation, batchType));
        }
      }

      return readableOperations;
    } catch (error) {
      logger.error(`[${this.INSTRUMENTATION_NAME}] Error extracting bulk op operations:`, error);
      return [];
    }
  }

  /**
   * Convert an internal bulk operation to a readable format.
   * BatchType: 1=INSERT, 2=UPDATE, 3=DELETE
   */
  private _makeReadableOperation(operation: any, batchType: number): Record<string, any> {
    const readableOp: Record<string, any> = {};

    // Strip non-deterministic metadata from documents and filters
    const stripMetadata = (obj: any) => {
      if (!obj || typeof obj !== "object") return obj;
      const { _id, createdAt, updatedAt, __v, ...rest } = obj;
      return rest;
    };

    if (batchType === 1) {
      // INSERT
      readableOp.operation = "Insert";
      readableOp.document = stripMetadata(operation);
    } else if (batchType === 2) {
      // UPDATE / REPLACE
      if (!this._hasAtomicOperators(operation.u)) {
        readableOp.operation = "ReplaceOne";
      } else if (operation.multi === true) {
        readableOp.operation = "Update";
      } else {
        readableOp.operation = "UpdateOne";
      }
      readableOp.query = stripMetadata(operation.q);
      readableOp.document = { ...operation.u };
    } else if (batchType === 3) {
      // DELETE
      readableOp.operation = operation.limit === 1 ? "DeleteOne" : "Delete";
      readableOp.query = stripMetadata(operation.q);
    }

    if (operation.upsert) {
      readableOp.upsert = operation.upsert;
    }
    if (operation.hint) {
      readableOp.hint = operation.hint;
    }
    if (operation.collation) {
      readableOp.collation = operation.collation;
    }
    if (operation.arrayFilters) {
      readableOp.arrayFilters = operation.arrayFilters;
    }

    return readableOp;
  }

  /**
   * Check if a document contains atomic operators (keys starting with '$').
   */
  private _hasAtomicOperators(doc: any): boolean {
    if (Array.isArray(doc)) {
      for (const item of doc) {
        if (this._hasAtomicOperators(item)) {
          return true;
        }
      }
      return false;
    }
    if (!doc || typeof doc !== "object") {
      return false;
    }
    const keys = Object.keys(doc);
    return keys.length > 0 && keys[0][0] === "$";
  }

  /**
   * Handle RECORD mode for BulkOperation.prototype.execute.
   * Same pattern as _handleRecordCollectionMethod.
   */
  private _handleRecordBulkOpExecute(
    original: Function,
    thisArg: any,
    args: any[],
    inputValue: MongodbCommandInputValue,
    spanName: string,
    submodule: string,
  ): any {
    return handleRecordMode({
      originalFunctionCall: () => original.apply(thisArg, args),
      recordModeHandler: ({ isPreAppStart }) => {
        return SpanUtils.createAndExecuteSpan(
          this.mode,
          () => original.apply(thisArg, args),
          {
            name: spanName,
            kind: SpanKind.CLIENT,
            submodule,
            packageType: PackageType.MONGODB,
            packageName: "mongodb",
            instrumentationName: this.INSTRUMENTATION_NAME,
            inputValue,
            isPreAppStart,
            stopRecordingChildSpans: true,
          },
          (spanInfo: SpanInfo) => {
            const resultPromise = original.apply(thisArg, args) as Promise<any>;

            return resultPromise
              .then((result: any) => {
                try {
                  addOutputAttributesToSpan(spanInfo, wrapDirectOutput(result));
                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.OK,
                  });
                } catch (error) {
                  logger.error(
                    `[${this.INSTRUMENTATION_NAME}] Error adding span attributes for ${spanName}:`,
                    error,
                  );
                }
                return result;
              })
              .catch((error: any) => {
                try {
                  SpanUtils.addSpanAttributes(spanInfo.span, {
                    outputValue: {
                      error: error?.message || "Unknown error",
                    },
                  });
                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.ERROR,
                    message: error?.message || "Operation failed",
                  });
                } catch (spanError) {
                  logger.error(
                    `[${this.INSTRUMENTATION_NAME}] Error recording span for ${spanName} error:`,
                    spanError,
                  );
                }
                throw error;
              });
          },
        );
      },
      spanKind: SpanKind.CLIENT,
    });
  }

  /**
   * Handle REPLAY mode for BulkOperation.prototype.execute.
   * Same pattern as _handleReplayCollectionMethod.
   */
  private _handleReplayBulkOpExecute(
    original: Function,
    thisArg: any,
    args: any[],
    inputValue: MongodbCommandInputValue,
    spanName: string,
    submodule: string,
  ): any {
    const stackTrace = captureStackTrace(["MongodbInstrumentation"]);

    return handleReplayMode({
      noOpRequestHandler: () => {
        return Promise.resolve({
          acknowledged: false,
          insertedCount: 0,
          matchedCount: 0,
          modifiedCount: 0,
          deletedCount: 0,
          upsertedCount: 0,
          insertedIds: {},
          upsertedIds: {},
        });
      },
      isServerRequest: false,
      replayModeHandler: () => {
        return SpanUtils.createAndExecuteSpan(
          this.mode,
          () => original.apply(thisArg, args),
          {
            name: spanName,
            kind: SpanKind.CLIENT,
            submodule,
            packageType: PackageType.MONGODB,
            packageName: "mongodb",
            instrumentationName: this.INSTRUMENTATION_NAME,
            inputValue,
            isPreAppStart: !this.tuskDrift.isAppReady(),
            stopRecordingChildSpans: true,
          },
          async (spanInfo: SpanInfo) => {
            try {
              const mockData = await this._findMockData({
                spanInfo,
                name: spanName,
                inputValue,
                submoduleName: submodule,
                stackTrace,
              });

              if (!mockData) {
                const errorMsg = `[${this.INSTRUMENTATION_NAME}] No matching mock found for ${spanName} (collection: ${inputValue.collection})`;
                logger.warn(errorMsg);
                throw new Error(errorMsg);
              }

              const result = unwrapDirectOutput(
                reconstructBsonValue(mockData.result, this.moduleExports),
              );

              SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
              return result;
            } catch (error: any) {
              SpanUtils.endSpan(spanInfo.span, {
                code: SpanStatusCode.ERROR,
                message: error?.message || "Replay failed",
              });
              throw error;
            }
          },
        );
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  /**
   * Convenience wrapper around the shimmer wrap utility.
   */
  private _wrap(target: any, propertyName: string, wrapper: (original: any) => any): void {
    wrap(target, propertyName, wrapper);
  }
}
