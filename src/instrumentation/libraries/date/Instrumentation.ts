import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { SpanUtils } from "../../../core/tracing/SpanUtils";
import { SpanKind } from "@opentelemetry/api";
import { TuskDriftMode } from "../../../core/TuskDrift";
import { SPAN_KIND_CONTEXT_KEY } from "../../../core/types";
import { wrap } from "../../core/utils";
import { DateInstrumentationConfig } from "./types";
import { DateTracker } from "../../core/trackers";
import { logger } from "../../../core/utils/logger";

/**
 * Date instrumentation that provides consistent dates in replay mode.
 * In replay mode, new Date() calls return the latest mock response timestamp.
 *
 * Note: this probably won't match exactly to the milliseconds, but it will be very close to date the application probably expects
 */
export class DateInstrumentation extends TdInstrumentationBase {
  private mode: TuskDriftMode;
  private originalDate?: typeof Date;
  private isInPatchedCall = false;
  private static instance: DateInstrumentation;

  constructor(config: DateInstrumentationConfig = {}) {
    super("date", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    DateInstrumentation.instance = this;
  }

  init(): TdInstrumentationNodeModule[] {
    // Date is a global, not a module, so we patch it directly
    this.patchGlobalDate();
    return [];
  }

  private patchGlobalDate(): void {
    // Unlike other instrumentations that patch modules when they're required (lazy patching),
    // date instrumentation patches the global Date function immediately during init() since
    // Date is a global API, not a module. This means we need to explicitly check if the
    // instrumentation is enabled before patching, otherwise we'd always patch globalThis.Date
    // even when the user has disabled date instrumentation.
    if (this.mode === TuskDriftMode.DISABLED || !this._config.enabled) {
      return;
    }

    this.originalDate = globalThis.Date;

    const _TdDate = this._wrap(globalThis, "Date", this.getDatePatchFn());

    // Copy static methods
    _TdDate.now = function (): number {
      return new _TdDate().getTime();
    };
    _TdDate.parse = this.originalDate!.parse.bind(this.originalDate!);
    _TdDate.UTC = this.originalDate!.UTC.bind(this.originalDate!);

    // Set up prototype chain
    Object.setPrototypeOf(_TdDate.prototype, this.originalDate!.prototype);
    Object.defineProperty(_TdDate, Symbol.hasInstance, {
      value: (instance: any) => instance instanceof this.originalDate!,
    });

    logger.debug("Global Date patching complete");
  }

  static getOriginalDate(): Date | string {
    return new DateInstrumentation.instance.originalDate!();
  }

  private _handleDateCall(args: any[], isConstructorCall: boolean): Date | string {
    // Prevent recursion
    if (this.isInPatchedCall) {
      return this._callOriginalDate(args, isConstructorCall);
    }

    // Only handle replay mode, pass through everything else
    if (this.mode !== TuskDriftMode.REPLAY) {
      return this._callOriginalDate(args, isConstructorCall);
    }

    const currentSpanInfo = SpanUtils.getCurrentSpanInfo();
    if (!currentSpanInfo) {
      return this._callOriginalDate(args, isConstructorCall);
    }

    // We only want to replace Date calls from server spans
    const spanKind = currentSpanInfo.context.getValue(SPAN_KIND_CONTEXT_KEY);
    if (spanKind !== SpanKind.SERVER) {
      return this._callOriginalDate(args, isConstructorCall);
    }

    this.isInPatchedCall = true;
    try {
      return this._handleReplayDate(args, isConstructorCall);
    } finally {
      this.isInPatchedCall = false;
    }
  }

  private _handleReplayDate(args: any[], isConstructorCall: boolean): Date | string {
    // If new Date() is called without arguments, use the latest timestamp from trace
    if (args.length === 0) {
      const latestDate = DateTracker.getCurrentTraceLatestDate();
      if (latestDate) {
        logger.debug(
          `Replacing new Date() with latest trace timestamp: ${latestDate.toISOString()}`,
        );
        return isConstructorCall
          ? new this.originalDate!(latestDate.getTime())
          : latestDate.toString();
      }
    }

    // For all other cases (Date with arguments), use original behavior
    return this._callOriginalDate(args, isConstructorCall);
  }

  private _callOriginalDate(args: any[], isConstructorCall: boolean): Date | string {
    if (isConstructorCall) {
      if (args.length === 0) {
        return new this.originalDate!();
      }
      return new (this.originalDate as any)(...args);
    } else {
      // Function call: Date() - should return string
      return new this.originalDate!().toString();
    }
  }

  private getDatePatchFn() {
    const self = this;
    return (OriginalDate: typeof Date) => {
      function _TdDate(this: any, ...args: any[]): Date | string {
        const isConstructorCall = new.target !== undefined;
        return self._handleDateCall(args, isConstructorCall);
      }
      return _TdDate;
    };
  }

  private _wrap(target: any, propertyName: string, wrapper: (original: any) => any): any {
    wrap(target, propertyName, wrapper);
    return target[propertyName];
  }
}
