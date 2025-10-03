import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TdInstrumentationNodeModuleFile } from "../../core/baseClasses/TdInstrumentationNodeModuleFile";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { wrap } from "../../core/utils";
import { getOperationDefinition } from "./utils";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { Span } from "@opentelemetry/api";
import { logger } from "../../../core/utils/logger";

export interface GraphqlInstrumentationConfig extends TdInstrumentationConfig {
  mode?: TuskDriftMode;
}

/**
 * GraphQL is instrumented purely for presentational metadata.
 * We do not replay GraphQL operations.
 *
 * Behavior:
 * - REPLAY mode: Just call original functions (no patching)
 * - RECORD mode: Intercept GraphQL execute calls and add presentational metadata to parent HTTP spans
 *   - Add presentational metadata to parent HTTP spans
 *   - Always call original GraphQL functions
 */
export class GraphqlInstrumentation extends TdInstrumentationBase {
  private tuskDrift: TuskDriftCore;

  constructor(config: GraphqlInstrumentationConfig = {}) {
    super("graphql", config);
    this.tuskDrift = TuskDriftCore.getInstance();
  }

  init(): TdInstrumentationNodeModule[] {
    // Patch GraphQL v16
    const patchGraphqlExecuteV16 = new TdInstrumentationNodeModuleFile({
      name: "graphql/execution/execute.js",
      supportedVersions: ["16.*"],
      // Graphql v16 deprecated executeSync
      patch: (moduleExports: any) => {
        this._wrap(moduleExports, "execute", this._patchExecuteFn());
        return moduleExports;
      },
    });

    // Patch GraphQL v15
    const patchGraphqlExecuteV15 = new TdInstrumentationNodeModuleFile({
      name: "graphql/execution/execute.js",
      supportedVersions: ["15.*"],
      patch: (moduleExports: any) => {
        this._wrap(moduleExports, "execute", this._patchExecuteFn());
        this._wrap(moduleExports, "executeSync", this._patchExecuteFn());
        return moduleExports;
      },
    });

    const moduleGraphqlV16 = new TdInstrumentationNodeModule({
      name: "graphql",
      supportedVersions: ["16.*"],
      patch: (moduleExports: any) => moduleExports,
      // execute doesn't exist in the main module export
      // Hence we patch the files directly
      files: [patchGraphqlExecuteV16],
    });

    const moduleGraphqlV15 = new TdInstrumentationNodeModule({
      name: "graphql",
      supportedVersions: ["15.*"],
      patch: (moduleExports: any) => moduleExports,
      // execute and executeSync don't exist in the main module export
      // Hence we patch the files directly
      files: [patchGraphqlExecuteV15],
    });

    return [moduleGraphqlV15, moduleGraphqlV16];
  }

  /**
   * Patch GraphQL execute function to add metadata to parent HTTP server spans
   */
  private _patchExecuteFn() {
    const self = this;
    return (originalExecute: any) => {
      return function execute(this: any, ...args: any[]) {
        return self._handleGraphQLExecution("execute", originalExecute, args, this);
      };
    };
  }

  /**
   * Handle GraphQL execution - add metadata to parent server span if present
   */
  private _handleGraphQLExecution(
    methodName: string,
    originalMethod: Function,
    args: any[],
    context: any,
  ): any {
    if (this.tuskDrift.getMode() !== TuskDriftMode.RECORD) {
      logger.debug(`[GraphQLInstrumentation] Not in RECORD mode, skipping instrumentation`);
      return originalMethod.apply(context, args);
    }

    let currentSpanInfo: SpanInfo | null = null;
    try {
      currentSpanInfo = SpanUtils.getCurrentSpanInfo();
    } catch (error) {
      logger.error(`[GraphQLInstrumentation] error getting current span info:`, error);
    }

    if (!currentSpanInfo) {
      logger.debug(
        `[GraphQLInstrumentation] No current span found for ${methodName}, calling original`,
      );
      return originalMethod.apply(context, args);
    }

    try {
      logger.debug(`[GraphQLInstrumentation] Update span attributes with GraphQL info`);
      this._addGraphQLMetadataToSpan(currentSpanInfo.span, args);
    } catch (error) {
      logger.warn(
        `[GraphQLInstrumentation] Failed to update span attributes with GraphQL info:`,
        error,
      );
    }

    return originalMethod.apply(context, args);
  }

  /**
   * Extract GraphQL metadata from execution args and add to span
   */
  private _addGraphQLMetadataToSpan(span: Span, args: any[]): void {
    const [executionArgs] = args;

    if (!executionArgs || !executionArgs.document) {
      logger.warn(`[GraphQLInstrumentation] No execution args or document found`);
      return;
    }

    try {
      // Extract operation information
      const operationDef = getOperationDefinition(executionArgs);
      const operationType = operationDef?.operation || "query";
      const operationName = executionArgs.operationName || operationDef?.name?.value || "Anonymous";

      SpanUtils.addSpanAttributes(span, {
        name: `${operationType} ${operationName}`,
        packageType: PackageType.GRAPHQL,
      });
    } catch (error) {
      logger.warn(`[GraphQLInstrumentation] Error extracting GraphQL metadata:`, error);
    }
  }

  private _wrap(target: any, propertyName: string, wrapper: (original: any) => any): void {
    wrap(target, propertyName, wrapper);
  }
}
