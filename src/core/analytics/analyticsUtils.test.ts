import test from "ava";
import { sendVersionMismatchAlert, sendUnpatchedDependencyAlert } from "./analyticsUtils";
import { TuskDriftCore, TuskDriftMode } from "../TuskDrift";

type MockCore = {
  getMode: () => TuskDriftMode;
  getProtobufCommunicator: () => unknown;
};

/**
 * Temporarily replace TuskDriftCore.getInstance with a stub.
 * Restores the original in a finally block.
 */
function withMockedInstance(mock: MockCore, fn: () => void): void {
  const originalGetInstance = (TuskDriftCore as any).getInstance;
  (TuskDriftCore as any).getInstance = () => mock;
  try {
    fn();
  } finally {
    (TuskDriftCore as any).getInstance = originalGetInstance;
  }
}

// ---- sendVersionMismatchAlert ----

test.serial("sendVersionMismatchAlert: does not send when mode is RECORD", (t) => {
  let sendCalled = false;
  withMockedInstance(
    {
      getMode: () => TuskDriftMode.RECORD,
      getProtobufCommunicator: () => ({
        sendInstrumentationVersionMismatchAlert: () => {
          sendCalled = true;
        },
      }),
    },
    () => {
      sendVersionMismatchAlert({
        moduleName: "my-module",
        foundVersion: "1.0.0",
        supportedVersions: ["1.0.0"],
      });
    },
  );
  t.false(sendCalled);
});

test.serial("sendVersionMismatchAlert: does not send when mode is DISABLED", (t) => {
  let sendCalled = false;
  withMockedInstance(
    {
      getMode: () => TuskDriftMode.DISABLED,
      getProtobufCommunicator: () => ({
        sendInstrumentationVersionMismatchAlert: () => {
          sendCalled = true;
        },
      }),
    },
    () => {
      sendVersionMismatchAlert({
        moduleName: "my-module",
        foundVersion: "1.0.0",
        supportedVersions: ["1.0.0"],
      });
    },
  );
  t.false(sendCalled);
});

test.serial("sendVersionMismatchAlert: does not send when protobufComm is null in REPLAY mode", (t) => {
  let sendCalled = false;
  withMockedInstance(
    {
      getMode: () => TuskDriftMode.REPLAY,
      getProtobufCommunicator: () => null,
    },
    () => {
      sendVersionMismatchAlert({
        moduleName: "my-module",
        foundVersion: "1.0.0",
        supportedVersions: ["1.0.0"],
      });
    },
  );
  t.false(sendCalled);
});

test.serial("sendVersionMismatchAlert: sends alert in REPLAY mode with protobufComm", (t) => {
  t.plan(3);
  withMockedInstance(
    {
      getMode: () => TuskDriftMode.REPLAY,
      getProtobufCommunicator: () => ({
        sendInstrumentationVersionMismatchAlert: (data: {
          moduleName: string;
          requestedVersion: string | undefined;
          supportedVersions: string[];
        }) => {
          t.is(data.moduleName, "express");
          t.is(data.requestedVersion, "4.18.0");
          t.deepEqual(data.supportedVersions, ["4.17.0", "4.18.0"]);
        },
      }),
    },
    () => {
      sendVersionMismatchAlert({
        moduleName: "express",
        foundVersion: "4.18.0",
        supportedVersions: ["4.17.0", "4.18.0"],
      });
    },
  );
});

test.serial("sendVersionMismatchAlert: passes undefined foundVersion as requestedVersion", (t) => {
  t.plan(1);
  withMockedInstance(
    {
      getMode: () => TuskDriftMode.REPLAY,
      getProtobufCommunicator: () => ({
        sendInstrumentationVersionMismatchAlert: (data: { requestedVersion: string | undefined }) => {
          t.is(data.requestedVersion, undefined);
        },
      }),
    },
    () => {
      sendVersionMismatchAlert({
        moduleName: "my-module",
        foundVersion: undefined,
        supportedVersions: ["1.0.0"],
      });
    },
  );
});

test.serial("sendVersionMismatchAlert: handles exception without throwing", (t) => {
  withMockedInstance(
    {
      getMode: () => {
        throw new Error("simulated error");
      },
      getProtobufCommunicator: () => null,
    },
    () => {
      t.notThrows(() => {
        sendVersionMismatchAlert({
          moduleName: "my-module",
          foundVersion: "1.0.0",
          supportedVersions: [],
        });
      });
    },
  );
});

// ---- sendUnpatchedDependencyAlert ----

test.serial("sendUnpatchedDependencyAlert: does nothing when protobufComm is null", (t) => {
  let sendCalled = false;
  withMockedInstance(
    {
      getMode: () => TuskDriftMode.RECORD,
      getProtobufCommunicator: () => null,
    },
    () => {
      sendUnpatchedDependencyAlert({
        traceTestServerSpanId: "span-123",
        stackTrace: "Error: some error",
      });
    },
  );
  t.false(sendCalled);
});

test.serial("sendUnpatchedDependencyAlert: does nothing when stackTrace is undefined", (t) => {
  let sendCalled = false;
  withMockedInstance(
    {
      getMode: () => TuskDriftMode.RECORD,
      getProtobufCommunicator: () => ({
        sendUnpatchedDependencyAlert: () => {
          sendCalled = true;
        },
      }),
    },
    () => {
      sendUnpatchedDependencyAlert({
        traceTestServerSpanId: "span-123",
        // stackTrace intentionally omitted
      });
    },
  );
  t.false(sendCalled);
});

test.serial("sendUnpatchedDependencyAlert: sends alert when protobufComm and stackTrace are present", (t) => {
  t.plan(2);
  withMockedInstance(
    {
      getMode: () => TuskDriftMode.RECORD,
      getProtobufCommunicator: () => ({
        sendUnpatchedDependencyAlert: (data: {
          traceTestServerSpanId: string;
          stackTrace: string;
        }) => {
          t.is(data.traceTestServerSpanId, "span-789");
          t.is(data.stackTrace, "Error: test\n  at foo.ts:1:1");
        },
      }),
    },
    () => {
      sendUnpatchedDependencyAlert({
        traceTestServerSpanId: "span-789",
        stackTrace: "Error: test\n  at foo.ts:1:1",
      });
    },
  );
});

test.serial("sendUnpatchedDependencyAlert: handles exception without throwing", (t) => {
  withMockedInstance(
    {
      getMode: () => TuskDriftMode.RECORD,
      getProtobufCommunicator: () => {
        throw new Error("simulated error");
      },
    },
    () => {
      t.notThrows(() => {
        sendUnpatchedDependencyAlert({
          traceTestServerSpanId: "span-123",
          stackTrace: "Error: test",
        });
      });
    },
  );
});
