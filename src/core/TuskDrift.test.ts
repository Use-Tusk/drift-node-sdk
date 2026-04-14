import test from "ava";
import type { ExecutionContext } from "ava";

import { TuskDriftCore } from "./TuskDrift";
import { OriginalGlobalUtils } from "./utils";

type EnvVars = Record<string, string | undefined>;
type SamplingConfigResult = {
  baseRate: number;
  minRate: number;
  logTransitions: boolean;
  mode: "fixed" | "adaptive";
};
type TestableTuskDrift = {
  config: unknown;
  determineSamplingConfig(initParams: { samplingRate?: number }): SamplingConfigResult;
};
type OriginalGlobalUtilsOverride = {
  getOriginalProcessEnvVar(key: string): string | undefined;
};

function createTestDrift(t: ExecutionContext, envVars: EnvVars): TestableTuskDrift {
  const patchedGlobalUtils = OriginalGlobalUtils as unknown as OriginalGlobalUtilsOverride;
  const originalGetEnvVar = patchedGlobalUtils.getOriginalProcessEnvVar;
  t.teardown(() => {
    patchedGlobalUtils.getOriginalProcessEnvVar = originalGetEnvVar;
  });

  patchedGlobalUtils.getOriginalProcessEnvVar = (key: string) => envVars[key];

  const drift = new TuskDriftCore() as unknown as TestableTuskDrift;
  drift.config = {};
  return drift;
}

test("prefers TUSK_RECORDING_SAMPLING_RATE over the legacy alias", (t) => {
  const drift = createTestDrift(t, {
    TUSK_DRIFT_MODE: "DISABLED",
    TUSK_RECORDING_SAMPLING_RATE: "0.25",
    TUSK_SAMPLING_RATE: "0.1",
  });

  const samplingConfig = drift.determineSamplingConfig({});

  t.is(samplingConfig.baseRate, 0.25);
});

test("falls back to TUSK_SAMPLING_RATE when the canonical env var is unset", (t) => {
  const drift = createTestDrift(t, {
    TUSK_DRIFT_MODE: "DISABLED",
    TUSK_SAMPLING_RATE: "0.2",
  });

  const samplingConfig = drift.determineSamplingConfig({});

  t.is(samplingConfig.baseRate, 0.2);
});

test("falls back to the legacy alias when TUSK_RECORDING_SAMPLING_RATE is invalid", (t) => {
  const drift = createTestDrift(t, {
    TUSK_DRIFT_MODE: "DISABLED",
    TUSK_RECORDING_SAMPLING_RATE: "invalid",
    TUSK_SAMPLING_RATE: "0.4",
  });

  const samplingConfig = drift.determineSamplingConfig({});

  t.is(samplingConfig.baseRate, 0.4);
});

test("uses recording.sampling.log_transitions from config when env var is unset", (t) => {
  const drift = createTestDrift(t, {
    TUSK_DRIFT_MODE: "DISABLED",
  });
  drift.config = {
    recording: {
      sampling: {
        log_transitions: false,
      },
    },
  };

  const samplingConfig = drift.determineSamplingConfig({});

  t.false(samplingConfig.logTransitions);
});

test("prefers TUSK_RECORDING_SAMPLING_LOG_TRANSITIONS over config", (t) => {
  const drift = createTestDrift(t, {
    TUSK_DRIFT_MODE: "DISABLED",
    TUSK_RECORDING_SAMPLING_LOG_TRANSITIONS: "false",
  });
  drift.config = {
    recording: {
      sampling: {
        log_transitions: true,
      },
    },
  };

  const samplingConfig = drift.determineSamplingConfig({});

  t.false(samplingConfig.logTransitions);
});

test("falls back to config when TUSK_RECORDING_SAMPLING_LOG_TRANSITIONS is invalid", (t) => {
  const drift = createTestDrift(t, {
    TUSK_DRIFT_MODE: "DISABLED",
    TUSK_RECORDING_SAMPLING_LOG_TRANSITIONS: "invalid",
  });
  drift.config = {
    recording: {
      sampling: {
        log_transitions: false,
      },
    },
  };

  const samplingConfig = drift.determineSamplingConfig({});

  t.false(samplingConfig.logTransitions);
});
