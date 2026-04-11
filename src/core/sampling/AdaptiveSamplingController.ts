import { logger } from "../utils/logger";

export type SamplingMode = "fixed" | "adaptive";
export type AdaptiveSamplingState = "fixed" | "healthy" | "warm" | "hot" | "critical_pause";
export type RootSamplingDecisionReason =
  | "pre_app_start"
  | "sampled"
  | "not_sampled"
  | "load_shed"
  | "critical_pause";

export interface ResolvedSamplingConfig {
  mode: SamplingMode;
  baseRate: number;
  minRate: number;
}

export interface AdaptiveSamplingHealthSnapshot {
  queueFillRatio?: number | null;
  droppedSpanCount?: number;
  exportFailureCount?: number;
  exportTimeoutCount?: number;
  exportCircuitOpen?: boolean;
  eventLoopLagP95Ms?: number | null;
  memoryPressureRatio?: number | null;
}

export interface RootSamplingDecision {
  shouldRecord: boolean;
  reason: RootSamplingDecisionReason;
  mode: SamplingMode;
  state: AdaptiveSamplingState;
  baseRate: number;
  minRate: number;
  effectiveRate: number;
  admissionMultiplier: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function normalizeBetween(value: number | null | undefined, zeroPoint: number, onePoint: number): number {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 0;
  }
  if (onePoint <= zeroPoint) {
    return 0;
  }
  return clamp01((value - zeroPoint) / (onePoint - zeroPoint));
}

export class AdaptiveSamplingController {
  private readonly config: ResolvedSamplingConfig;
  private readonly randomFn: () => number;
  private readonly nowFn: () => number;

  private admissionMultiplier = 1;
  private state: AdaptiveSamplingState;
  private pausedUntilMs = 0;
  private lastUpdatedAtMs = 0;
  private lastDecreaseAtMs = 0;

  private prevDroppedSpanCount = 0;
  private prevExportFailureCount = 0;
  private prevExportTimeoutCount = 0;

  private queueFillEwma: number | null = null;
  private recentDropSignal = 0;
  private recentFailureSignal = 0;
  private recentTimeoutSignal = 0;

  constructor(
    config: ResolvedSamplingConfig,
    {
      randomFn = Math.random,
      nowFn = Date.now,
    }: {
      randomFn?: () => number;
      nowFn?: () => number;
    } = {},
  ) {
    this.config = config;
    this.randomFn = randomFn;
    this.nowFn = nowFn;
    this.state = config.mode === "fixed" ? "fixed" : "healthy";
  }

  update(snapshot: AdaptiveSamplingHealthSnapshot): void {
    if (this.config.mode !== "adaptive") {
      this.state = "fixed";
      this.admissionMultiplier = 1;
      return;
    }

    const now = this.nowFn();
    const elapsedMs = this.lastUpdatedAtMs === 0 ? 2000 : Math.max(1, now - this.lastUpdatedAtMs);
    this.lastUpdatedAtMs = now;

    const decay = Math.exp(-elapsedMs / 30000);
    this.recentDropSignal *= decay;
    this.recentFailureSignal *= decay;
    this.recentTimeoutSignal *= decay;

    const droppedSpanCount = Math.max(0, snapshot.droppedSpanCount ?? 0);
    const exportFailureCount = Math.max(0, snapshot.exportFailureCount ?? 0);
    const exportTimeoutCount = Math.max(0, snapshot.exportTimeoutCount ?? 0);

    const droppedDelta = Math.max(0, droppedSpanCount - this.prevDroppedSpanCount);
    const exportFailureDelta = Math.max(0, exportFailureCount - this.prevExportFailureCount);
    const exportTimeoutDelta = Math.max(0, exportTimeoutCount - this.prevExportTimeoutCount);

    this.prevDroppedSpanCount = droppedSpanCount;
    this.prevExportFailureCount = exportFailureCount;
    this.prevExportTimeoutCount = exportTimeoutCount;

    this.recentDropSignal += droppedDelta;
    this.recentFailureSignal += exportFailureDelta;
    this.recentTimeoutSignal += exportTimeoutDelta;

    const queueFillRatio =
      snapshot.queueFillRatio === null || snapshot.queueFillRatio === undefined
        ? null
        : clamp01(snapshot.queueFillRatio);

    if (queueFillRatio !== null) {
      this.queueFillEwma = this.queueFillEwma === null ? queueFillRatio : 0.25 * queueFillRatio + 0.75 * this.queueFillEwma;
    }

    const queuePressure = normalizeBetween(this.queueFillEwma, 0.2, 0.85);
    const eventLoopPressure = normalizeBetween(snapshot.eventLoopLagP95Ms ?? null, 20, 150);
    const memoryPressure = normalizeBetween(snapshot.memoryPressureRatio ?? null, 0.8, 0.92);
    const exportFailurePressure = clamp01(this.recentFailureSignal / 5);

    const pressure = Math.max(queuePressure, eventLoopPressure, memoryPressure, exportFailurePressure);
    const hardBrake =
      droppedDelta > 0 ||
      exportTimeoutDelta > 0 ||
      Boolean(snapshot.exportCircuitOpen) ||
      (snapshot.eventLoopLagP95Ms ?? 0) >= 150 ||
      (snapshot.memoryPressureRatio ?? 0) >= 0.92;

    const previousState = this.state;
    const previousMultiplier = this.admissionMultiplier;

    if (hardBrake) {
      this.pausedUntilMs = now + 15000;
      this.admissionMultiplier = 0;
      this.state = "critical_pause";
      this.lastDecreaseAtMs = now;
      this.logTransition(previousState, previousMultiplier, pressure, snapshot);
      return;
    }

    if (now < this.pausedUntilMs) {
      this.state = "critical_pause";
      this.logTransition(previousState, previousMultiplier, pressure, snapshot);
      return;
    }

    const minMultiplier = this.getMinMultiplier();

    if (pressure >= 0.7) {
      this.admissionMultiplier = Math.max(minMultiplier, this.admissionMultiplier * 0.4);
      this.state = "hot";
      this.lastDecreaseAtMs = now;
    } else if (pressure >= 0.45) {
      this.admissionMultiplier = Math.max(minMultiplier, this.admissionMultiplier * 0.7);
      this.state = "warm";
      this.lastDecreaseAtMs = now;
    } else {
      if (pressure <= 0.2 && now - this.lastDecreaseAtMs >= 10000) {
        this.admissionMultiplier = Math.min(1, this.admissionMultiplier + 0.05);
      }
      this.state = "healthy";
    }

    this.logTransition(previousState, previousMultiplier, pressure, snapshot);
  }

  getDecision({ isPreAppStart }: { isPreAppStart: boolean }): RootSamplingDecision {
    if (isPreAppStart) {
      return {
        shouldRecord: true,
        reason: "pre_app_start",
        mode: this.config.mode,
        state: this.state,
        baseRate: this.config.baseRate,
        minRate: this.config.minRate,
        effectiveRate: 1,
        admissionMultiplier: 1,
      };
    }

    const effectiveRate =
      this.config.mode === "adaptive" ? this.getEffectiveSamplingRate() : clamp01(this.config.baseRate);

    if (effectiveRate <= 0) {
      return {
        shouldRecord: false,
        reason: this.state === "critical_pause" ? "critical_pause" : "not_sampled",
        mode: this.config.mode,
        state: this.state,
        baseRate: this.config.baseRate,
        minRate: this.config.minRate,
        effectiveRate,
        admissionMultiplier: this.admissionMultiplier,
      };
    }

    const shouldRecord = this.randomFn() < effectiveRate;
    return {
      shouldRecord,
      reason: shouldRecord
        ? "sampled"
        : this.config.mode === "adaptive" && effectiveRate < this.config.baseRate
          ? "load_shed"
          : "not_sampled",
      mode: this.config.mode,
      state: this.state,
      baseRate: this.config.baseRate,
      minRate: this.config.minRate,
      effectiveRate,
      admissionMultiplier: this.config.mode === "adaptive" ? this.admissionMultiplier : 1,
    };
  }

  getEffectiveSamplingRate(): number {
    if (this.config.mode !== "adaptive") {
      return clamp01(this.config.baseRate);
    }
    if (this.nowFn() < this.pausedUntilMs || this.state === "critical_pause") {
      return 0;
    }
    const effectiveRate = this.config.baseRate * this.admissionMultiplier;
    return clamp(
      effectiveRate,
      Math.min(this.config.baseRate, this.config.minRate),
      this.config.baseRate,
    );
  }

  getSnapshot(): Omit<RootSamplingDecision, "shouldRecord" | "reason"> {
    return {
      mode: this.config.mode,
      state: this.state,
      baseRate: this.config.baseRate,
      minRate: this.config.minRate,
      effectiveRate:
        this.config.mode === "adaptive" ? this.getEffectiveSamplingRate() : clamp01(this.config.baseRate),
      admissionMultiplier: this.config.mode === "adaptive" ? this.admissionMultiplier : 1,
    };
  }

  private getMinMultiplier(): number {
    if (this.config.baseRate <= 0 || this.config.minRate <= 0) {
      return 0;
    }
    return clamp01(this.config.minRate / this.config.baseRate);
  }

  private logTransition(
    previousState: AdaptiveSamplingState,
    previousMultiplier: number,
    pressure: number,
    snapshot: AdaptiveSamplingHealthSnapshot,
  ): void {
    if (
      previousState === this.state &&
      Math.abs(previousMultiplier - this.admissionMultiplier) < 0.05
    ) {
      return;
    }

    logger.info(
      `Adaptive sampling updated (state=${this.state}, multiplier=${this.admissionMultiplier.toFixed(2)}, effectiveRate=${this.getEffectiveSamplingRate().toFixed(4)}, pressure=${pressure.toFixed(2)}, queueFill=${this.queueFillEwma?.toFixed(2) ?? "n/a"}, eventLoopLagP95Ms=${snapshot.eventLoopLagP95Ms ?? "n/a"}, memoryPressureRatio=${snapshot.memoryPressureRatio ?? "n/a"}, exportCircuitOpen=${snapshot.exportCircuitOpen ? "true" : "false"}).`,
    );
  }
}
