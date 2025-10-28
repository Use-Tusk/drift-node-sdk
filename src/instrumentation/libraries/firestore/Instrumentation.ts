import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { TdInstrumentationNodeModuleFile } from "../../core/baseClasses/TdInstrumentationNodeModuleFile";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { handleRecordMode, handleReplayMode } from "../../core/utils/modeUtils";
import { findMockResponseAsync, findMockResponseSync } from "../../core/utils/mockResponseUtils";
import { createMockInputValue } from "../../../core/utils";
import {
  FirestoreInstrumentationConfig,
  FirestoreInputValue,
  FirestoreDocumentResult,
  FirestoreQueryResult,
  FirestoreWriteResult,
} from "./types";
import { TdFirestoreDocumentMock } from "./mocks/TdFirestoreDocumentMock";
import { TdFirestoreQueryMock } from "./mocks/TdFirestoreQueryMock";
import { TdFirestoreWriteResultMock } from "./mocks/TdFirestoreWriteResultMock";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { logger } from "../../../core/utils/logger";

const FIRESTORE_VERSION = "7.*";
const PACKAGE_NAME = "@google-cloud/firestore";

export class FirestoreInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "FirestoreInstrumentation";
  private mode: TuskDriftMode;
  private tuskDrift: TuskDriftCore;
  private originalCollectionDocFn: Function | null = null;

  constructor(config: FirestoreInstrumentationConfig = {}) {
    super(PACKAGE_NAME, config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.tuskDrift = TuskDriftCore.getInstance();
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: PACKAGE_NAME,
        supportedVersions: [FIRESTORE_VERSION],
        files: [
          // Patch DocumentReference methods
          new TdInstrumentationNodeModuleFile({
            name: "@google-cloud/firestore/build/src/reference/document-reference.js",
            supportedVersions: [FIRESTORE_VERSION],
            patch: (moduleExports: any) => this._patchDocumentReference(moduleExports),
          }),
          // Patch CollectionReference methods
          new TdInstrumentationNodeModuleFile({
            name: "@google-cloud/firestore/build/src/reference/collection-reference.js",
            supportedVersions: [FIRESTORE_VERSION],
            patch: (moduleExports: any) => this._patchCollectionReference(moduleExports),
          }),
          // Patch Query methods
          new TdInstrumentationNodeModuleFile({
            name: "@google-cloud/firestore/build/src/reference/query.js",
            supportedVersions: [FIRESTORE_VERSION],
            patch: (moduleExports: any) => this._patchQuery(moduleExports),
          }),
        ],
      }),
    ];
  }

  private _patchDocumentReference(moduleExports: any): any {
    logger.debug(`[FirestoreInstrumentation] Patching DocumentReference in ${this.mode} mode`);

    if (this.isModulePatched(moduleExports)) {
      logger.debug(`[FirestoreInstrumentation] DocumentReference already patched, skipping`);
      return moduleExports;
    }

    const DocumentReference = moduleExports.DocumentReference;
    if (!DocumentReference || !DocumentReference.prototype) {
      logger.warn(`[FirestoreInstrumentation] DocumentReference.prototype not found`);
      return moduleExports;
    }

    // Patch DocumentReference methods
    this._wrap(DocumentReference.prototype, "get", this._getDocumentGetPatchFn());
    this._wrap(DocumentReference.prototype, "create", this._getDocumentCreatePatchFn());
    this._wrap(DocumentReference.prototype, "set", this._getDocumentSetPatchFn());
    this._wrap(DocumentReference.prototype, "update", this._getDocumentUpdatePatchFn());
    this._wrap(DocumentReference.prototype, "delete", this._getDocumentDeletePatchFn());

    this.markModuleAsPatched(moduleExports);
    logger.debug(`[FirestoreInstrumentation] DocumentReference patching complete`);

    return moduleExports;
  }

  private _patchCollectionReference(moduleExports: any): any {
    logger.debug(`[FirestoreInstrumentation] Patching CollectionReference in ${this.mode} mode`);

    if (this.isModulePatched(moduleExports)) {
      logger.debug(`[FirestoreInstrumentation] CollectionReference already patched, skipping`);
      return moduleExports;
    }

    const CollectionReference = moduleExports.CollectionReference;
    if (!CollectionReference || !CollectionReference.prototype) {
      logger.warn(`[FirestoreInstrumentation] CollectionReference.prototype not found`);
      return moduleExports;
    }

    // Save original doc function before patching (needed for replay handlers)
    this.originalCollectionDocFn = CollectionReference.prototype.doc;

    // Patch CollectionReference methods
    this._wrap(CollectionReference.prototype, "add", this._getCollectionAddPatchFn());
    this._wrap(CollectionReference.prototype, "doc", this._getCollectionDocPatchFn());

    this.markModuleAsPatched(moduleExports);
    logger.debug(`[FirestoreInstrumentation] CollectionReference patching complete`);

    return moduleExports;
  }

  private _patchQuery(moduleExports: any): any {
    logger.debug(`[FirestoreInstrumentation] Patching Query in ${this.mode} mode`);

    if (this.isModulePatched(moduleExports)) {
      logger.debug(`[FirestoreInstrumentation] Query already patched, skipping`);
      return moduleExports;
    }

    const Query = moduleExports.Query;
    if (!Query || !Query.prototype) {
      logger.warn(`[FirestoreInstrumentation] Query.prototype not found`);
      return moduleExports;
    }

    // Patch Query methods
    this._wrap(Query.prototype, "get", this._getQueryGetPatchFn());

    this.markModuleAsPatched(moduleExports);
    logger.debug(`[FirestoreInstrumentation] Query patching complete`);

    return moduleExports;
  }

  private _getDocumentGetPatchFn() {
    const self = this;

    return (originalGet: Function) => {
      return function (this: any) {
        const documentPath = this.path;

        const inputValue: FirestoreInputValue = {
          operation: "document.get",
          path: documentPath,
        };

        // Handle replay mode
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalGet.call(this),
                {
                  name: "firestore.document.get",
                  kind: SpanKind.CLIENT,
                  submodule: "document",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  return self._handleReplayDocumentGet(spanInfo, inputValue);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalGet.call(this),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalGet.call(this),
                {
                  name: "firestore.document.get",
                  kind: SpanKind.CLIENT,
                  submodule: "document",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  return self._handleRecordDocumentGet(spanInfo, originalGet, this);
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalGet.call(this);
        }
      };
    };
  }

  private async _handleRecordDocumentGet(
    spanInfo: SpanInfo,
    originalGet: Function,
    context: any,
  ): Promise<any> {
    const snapshot = await originalGet.call(context);

    // Capture document data
    const documentResult: FirestoreDocumentResult = {
      id: snapshot.id,
      path: snapshot.ref.path,
      exists: snapshot.exists,
      data: snapshot.exists ? snapshot.data() : undefined,
      createTime: snapshot.createTime
        ? { seconds: snapshot.createTime.seconds, nanoseconds: snapshot.createTime.nanoseconds }
        : undefined,
      updateTime: snapshot.updateTime
        ? { seconds: snapshot.updateTime.seconds, nanoseconds: snapshot.updateTime.nanoseconds }
        : undefined,
      readTime: snapshot.readTime
        ? { seconds: snapshot.readTime.seconds, nanoseconds: snapshot.readTime.nanoseconds }
        : undefined,
    };

    try {
      SpanUtils.addSpanAttributes(spanInfo.span, {
        outputValue: documentResult,
      });
      SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
    } catch {
      logger.error(`[FirestoreInstrumentation] Error updating span attributes for document.get`);
    }

    return snapshot;
  }

  private async _handleReplayDocumentGet(
    spanInfo: SpanInfo,
    inputValue: FirestoreInputValue,
  ): Promise<any> {
    logger.debug(`[FirestoreInstrumentation] Replaying document.get`);

    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: "firestore.document.get",
        inputValue: createMockInputValue(inputValue),
        packageName: PACKAGE_NAME,
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: "document",
        kind: SpanKind.CLIENT,
      },
      tuskDrift: this.tuskDrift,
    });

    if (!mockData) {
      logger.warn(
        `[FirestoreInstrumentation] No mock data found for document.get: ${inputValue.path}`,
      );
      const emptyDocumentResult: FirestoreDocumentResult = {
        exists: false,
        id: "",
        path: "",
      };
      return new TdFirestoreDocumentMock(emptyDocumentResult);
    }

    const documentResult = mockData.result as FirestoreDocumentResult;
    return new TdFirestoreDocumentMock(documentResult);
  }

  private _getDocumentCreatePatchFn() {
    const self = this;

    return (originalCreate: Function) => {
      return function (this: any, data: any) {
        const documentPath = this.path;

        const inputValue: FirestoreInputValue = {
          operation: "document.create",
          path: documentPath,
          data: data,
        };

        // Handle replay mode
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalCreate.call(this, data),
                {
                  name: "firestore.document.create",
                  kind: SpanKind.CLIENT,
                  submodule: "document",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  return self._handleReplayDocumentWrite(spanInfo, inputValue);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalCreate.call(this, data),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalCreate.call(this, data),
                {
                  name: "firestore.document.create",
                  kind: SpanKind.CLIENT,
                  submodule: "document",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  return self._handleRecordDocumentWrite(spanInfo, originalCreate, this, data);
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalCreate.call(this, data);
        }
      };
    };
  }

  private _getDocumentSetPatchFn() {
    const self = this;

    return (originalSet: Function) => {
      return function (this: any, data: any, options?: any) {
        const documentPath = this.path;

        const inputValue: FirestoreInputValue = {
          operation: "document.set",
          path: documentPath,
          data: data,
          options: options,
        };

        // Handle replay mode
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalSet.call(this, data, options),
                {
                  name: "firestore.document.set",
                  kind: SpanKind.CLIENT,
                  submodule: "document",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  return self._handleReplayDocumentWrite(spanInfo, inputValue);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalSet.call(this, data, options),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalSet.call(this, data, options),
                {
                  name: "firestore.document.set",
                  kind: SpanKind.CLIENT,
                  submodule: "document",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  return self._handleRecordDocumentWrite(
                    spanInfo,
                    originalSet,
                    this,
                    data,
                    options,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalSet.call(this, data, options);
        }
      };
    };
  }

  private _getDocumentUpdatePatchFn() {
    const self = this;

    return (originalUpdate: Function) => {
      return function (this: any, ...args: any[]) {
        const documentPath = this.path;

        // Firestore update() can take either (data) or (field, value, ...moreFieldsAndValues)
        const inputValue: FirestoreInputValue = {
          operation: "document.update",
          path: documentPath,
          data: args.length === 1 ? args[0] : args, // Capture all args
        };

        // Handle replay mode
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalUpdate.apply(this, args),
                {
                  name: "firestore.document.update",
                  kind: SpanKind.CLIENT,
                  submodule: "document",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  return self._handleReplayDocumentWrite(spanInfo, inputValue);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalUpdate.apply(this, args),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalUpdate.apply(this, args),
                {
                  name: "firestore.document.update",
                  kind: SpanKind.CLIENT,
                  submodule: "document",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  return self._handleRecordDocumentWrite(spanInfo, originalUpdate, this, ...args);
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalUpdate.apply(this, args);
        }
      };
    };
  }

  private _getDocumentDeletePatchFn() {
    const self = this;

    return (originalDelete: Function) => {
      return function (this: any, precondition?: any) {
        const documentPath = this.path;

        const inputValue: FirestoreInputValue = {
          operation: "document.delete",
          path: documentPath,
          options: precondition,
        };

        // Handle replay mode
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalDelete.call(this, precondition),
                {
                  name: "firestore.document.delete",
                  kind: SpanKind.CLIENT,
                  submodule: "document",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  return self._handleReplayDocumentWrite(spanInfo, inputValue);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalDelete.call(this, precondition),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalDelete.call(this, precondition),
                {
                  name: "firestore.document.delete",
                  kind: SpanKind.CLIENT,
                  submodule: "document",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  return self._handleRecordDocumentWrite(
                    spanInfo,
                    originalDelete,
                    this,
                    precondition,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalDelete.call(this, precondition);
        }
      };
    };
  }

  private async _handleRecordDocumentWrite(
    spanInfo: SpanInfo,
    originalWrite: Function,
    context: any,
    ...args: any[]
  ): Promise<any> {
    const writeResult = await originalWrite.apply(context, args);

    // Capture write result
    const result: FirestoreWriteResult = {
      writeTime: writeResult.writeTime
        ? {
            seconds: writeResult.writeTime.seconds,
            nanoseconds: writeResult.writeTime.nanoseconds,
          }
        : undefined,
    };

    try {
      SpanUtils.addSpanAttributes(spanInfo.span, {
        outputValue: result,
      });
      SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
    } catch {
      logger.error(`[FirestoreInstrumentation] Error updating span attributes for document.write`);
    }

    return writeResult;
  }

  private async _handleReplayDocumentWrite(
    spanInfo: SpanInfo,
    inputValue: FirestoreInputValue,
  ): Promise<any> {
    logger.debug(`[FirestoreInstrumentation] Replaying document write: ${inputValue.operation}`);

    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: `firestore.${inputValue.operation}`,
        inputValue: createMockInputValue(inputValue),
        packageName: PACKAGE_NAME,
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: "document",
        kind: SpanKind.CLIENT,
      },
      tuskDrift: this.tuskDrift,
    });

    if (!mockData) {
      logger.warn(
        `[FirestoreInstrumentation] No mock data found for ${inputValue.operation}: ${inputValue.path}`,
      );
      const now = Date.now();
      const emptyWriteResult: FirestoreWriteResult = {
        writeTime: {
          seconds: Math.floor(now / 1000),
          nanoseconds: (now % 1000) * 1000000,
        },
      };
      return new TdFirestoreWriteResultMock(emptyWriteResult);
    }

    // Return mock write result with proper API
    const writeResult = mockData.result as FirestoreWriteResult;
    return new TdFirestoreWriteResultMock(writeResult);
  }

  private _getCollectionAddPatchFn() {
    const self = this;

    return (originalAdd: Function) => {
      return function (this: any, data: any) {
        const collectionPath = this.path;

        const inputValue: FirestoreInputValue = {
          operation: "collection.add",
          path: collectionPath,
          data: data,
        };

        // Handle replay mode
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalAdd.call(this, data),
                {
                  name: "firestore.collection.add",
                  kind: SpanKind.CLIENT,
                  submodule: "collection",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  return self._handleReplayCollectionAdd(spanInfo, inputValue, this);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalAdd.call(this, data),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalAdd.call(this, data),
                {
                  name: "firestore.collection.add",
                  kind: SpanKind.CLIENT,
                  submodule: "collection",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  return self._handleRecordCollectionAdd(spanInfo, originalAdd, this, data);
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalAdd.call(this, data);
        }
      };
    };
  }

  private async _handleRecordCollectionAdd(
    spanInfo: SpanInfo,
    originalAdd: Function,
    context: any,
    data: any,
  ): Promise<any> {
    const docRef = await originalAdd.call(context, data);

    // Capture the auto-generated document ID
    const result = {
      id: docRef.id,
      path: docRef.path,
    };

    try {
      SpanUtils.addSpanAttributes(spanInfo.span, {
        outputValue: result,
      });
      SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
    } catch {
      logger.error(`[FirestoreInstrumentation] Error updating span attributes for collection.add`);
    }

    return docRef;
  }
  private async _handleReplayCollectionAdd(
    spanInfo: SpanInfo,
    inputValue: FirestoreInputValue,
    collectionRef: any,
  ): Promise<any> {
    logger.debug(`[FirestoreInstrumentation] Replaying collection.add`);
    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: "firestore.collection.add",
        inputValue: createMockInputValue(inputValue),
        packageName: PACKAGE_NAME,
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: "collection",
        kind: SpanKind.CLIENT,
      },
      tuskDrift: this.tuskDrift,
    });

    if (!mockData) {
      logger.warn(
        `[FirestoreInstrumentation] No mock data found for collection.add: ${inputValue.path}`,
      );

      if (!this.originalCollectionDocFn) {
        logger.error(`[FirestoreInstrumentation] Original doc function not available`);
        return Promise.reject(new Error("Original doc function not available"));
      }
      return this.originalCollectionDocFn.call(collectionRef, "");
    }

    // Return a DocumentReference with the recorded ID
    // Use original doc function to avoid nested instrumentation
    const recordedId = mockData.result.id;
    if (!this.originalCollectionDocFn) {
      logger.error(`[FirestoreInstrumentation] Original doc function not available`);
      return Promise.reject(new Error("Original doc function not available"));
    }
    return this.originalCollectionDocFn.call(collectionRef, recordedId);
  }

  private _getCollectionDocPatchFn() {
    const self = this;

    return (originalDoc: Function) => {
      return function (this: any, documentPath?: string) {
        const collectionPath = this.path;

        const inputValue: FirestoreInputValue = {
          operation: "collection.doc",
          path: collectionPath,
          documentId: documentPath,
        };

        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () =>
                  documentPath ? originalDoc.call(this, documentPath) : originalDoc.call(this),
                {
                  name: "firestore.collection.doc",
                  kind: SpanKind.CLIENT,
                  submodule: "collection",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  // doc is a sync function so we need to fetch the mock syncronously
                  // This function might throw an error if this is the frist mock requested in replay mode
                  // and the CLI/SDK connection couldn't be awaited
                  // This is a known limitation that is only relevant in replay mode so not the biggest deal
                  const mockData = findMockResponseSync({
                    mockRequestData: {
                      traceId: spanInfo.traceId,
                      spanId: spanInfo.spanId,
                      name: "firestore.collection.doc",
                      inputValue: createMockInputValue(inputValue),
                      packageName: PACKAGE_NAME,
                      instrumentationName: self.INSTRUMENTATION_NAME,
                      submoduleName: "collection",
                      kind: SpanKind.CLIENT,
                    },
                    tuskDrift: self.tuskDrift,
                  });

                  if (!mockData) {
                    logger.warn(
                      `[FirestoreInstrumentation] No mock data found for collection.doc: ${collectionPath}`,
                    );
                    return originalDoc.call(this, "");
                  }

                  // Use the recorded ID (this ensures deterministic replay)
                  const recordedId = mockData.result.id;

                  logger.debug(
                    `[FirestoreInstrumentation] replaying doc call with recorded id: ${recordedId}`,
                  );
                  const docRef = originalDoc.call(this, recordedId);
                  logger.debug(`[FirestoreInstrumentation] doc ref, id`, docRef, recordedId);
                  return docRef;
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () =>
              documentPath ? originalDoc.call(this, documentPath) : originalDoc.call(this),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () =>
                  documentPath ? originalDoc.call(this, documentPath) : originalDoc.call(this),
                {
                  name: "firestore.collection.doc",
                  kind: SpanKind.CLIENT,
                  submodule: "collection",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  // Record the ID (whether auto-generated or provided)
                  const docRef = documentPath
                    ? originalDoc.call(this, documentPath)
                    : originalDoc.call(this);
                  const result = {
                    id: docRef.id,
                    path: docRef.path,
                  };
                  try {
                    SpanUtils.addSpanAttributes(spanInfo.span, {
                      outputValue: result,
                    });
                    SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
                  } catch {
                    logger.error(
                      `[FirestoreInstrumentation] Error updating span attributes for collection.doc`,
                    );
                  }
                  return docRef;
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return documentPath ? originalDoc.call(this, documentPath) : originalDoc.call(this);
        }
      };
    };
  }

  private _getQueryGetPatchFn() {
    const self = this;

    return (originalGet: Function) => {
      return function (this: any) {
        // Try to extract query path - queries have a _queryOptions property
        const queryPath = this._queryOptions?.parentPath?.formattedName || "unknown";

        const inputValue: FirestoreInputValue = {
          operation: "query.get",
          path: queryPath,
          // Could capture query constraints here if needed
        };

        // Handle replay mode
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalGet.call(this),
                {
                  name: "firestore.query.get",
                  kind: SpanKind.CLIENT,
                  submodule: "query",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  return self._handleReplayQueryGet(spanInfo, inputValue);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalGet.call(this),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalGet.call(this),
                {
                  name: "firestore.query.get",
                  kind: SpanKind.CLIENT,
                  submodule: "query",
                  packageType: PackageType.FIRESTORE,
                  packageName: PACKAGE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  return self._handleRecordQueryGet(spanInfo, originalGet, this);
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalGet.call(this);
        }
      };
    };
  }

  private async _handleRecordQueryGet(
    spanInfo: SpanInfo,
    originalGet: Function,
    context: any,
  ): Promise<any> {
    const querySnapshot = await originalGet.call(context);

    // Capture query results
    const queryResult: FirestoreQueryResult = {
      docs: querySnapshot.docs.map((doc: any) => ({
        id: doc.id,
        path: doc.ref.path,
        exists: doc.exists,
        data: doc.exists ? doc.data() : undefined,
        createTime: doc.createTime
          ? { seconds: doc.createTime.seconds, nanoseconds: doc.createTime.nanoseconds }
          : undefined,
        updateTime: doc.updateTime
          ? { seconds: doc.updateTime.seconds, nanoseconds: doc.updateTime.nanoseconds }
          : undefined,
        readTime: doc.readTime
          ? { seconds: doc.readTime.seconds, nanoseconds: doc.readTime.nanoseconds }
          : undefined,
      })),
      size: querySnapshot.size,
      empty: querySnapshot.empty,
      readTime: querySnapshot.readTime
        ? {
            seconds: querySnapshot.readTime.seconds,
            nanoseconds: querySnapshot.readTime.nanoseconds,
          }
        : undefined,
    };

    try {
      SpanUtils.addSpanAttributes(spanInfo.span, {
        outputValue: queryResult,
      });
      SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
    } catch {
      logger.error(`[FirestoreInstrumentation] Error updating span attributes for query.get`);
    }

    return querySnapshot;
  }

  private async _handleReplayQueryGet(
    spanInfo: SpanInfo,
    inputValue: FirestoreInputValue,
  ): Promise<any> {
    logger.debug(`[FirestoreInstrumentation] Replaying query.get`);

    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: "firestore.query.get",
        inputValue: createMockInputValue(inputValue),
        packageName: PACKAGE_NAME,
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: "query",
        kind: SpanKind.CLIENT,
      },
      tuskDrift: this.tuskDrift,
    });

    if (!mockData) {
      logger.warn(
        `[FirestoreInstrumentation] No mock data found for query.get: ${inputValue.path}`,
      );
      const emptyQueryResult: FirestoreQueryResult = {
        size: 0,
        empty: true,
        docs: [],
      };
      return new TdFirestoreQueryMock(emptyQueryResult);
    }

    const queryResult = mockData.result as FirestoreQueryResult;
    return new TdFirestoreQueryMock(queryResult);
  }

  protected _wrap<T extends (...args: any[]) => any>(
    target: any,
    propertyName: string,
    wrapper: (original: T) => T,
  ): void {
    if (!target || typeof target[propertyName] !== "function") {
      logger.warn(
        `[FirestoreInstrumentation] Cannot wrap ${propertyName}: not a function or target is undefined`,
      );
      return;
    }

    const original = target[propertyName];
    const wrapped = wrapper(original);
    target[propertyName] = wrapped;
  }
}
