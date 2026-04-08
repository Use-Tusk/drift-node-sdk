import test from "ava";
import { ProtobufCommunicator } from "./ProtobufCommunicator";
import {
  SDKMessage,
  MessageType,
  FileCoverageData,
  BranchInfo,
} from "@use-tusk/drift-schemas/core/communication";
import net from "net";

// --- handleCoverageSnapshotRequest tests ---

// Helper to create a test ProtobufCommunicator instance
function createTestCommunicator(): {
  communicator: ProtobufCommunicator;
  sentMessages: SDKMessage[];
  mockSocket: net.Socket;
} {
  const sentMessages: SDKMessage[] = [];
  const mockSocket = new net.Socket();

  const communicator = new ProtobufCommunicator();

  // Access private method via prototype manipulation for testing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (communicator as any).sendProtobufMessage = async (message: SDKMessage) => {
    sentMessages.push(message);
  };

  // Set up a mock client connection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (communicator as any).client = mockSocket;

  return { communicator, sentMessages, mockSocket };
}

test("handleCoverageSnapshotRequest: returns error when NODE_V8_COVERAGE not set", async (t) => {
  const { communicator, sentMessages } = createTestCommunicator();

  // Ensure NODE_V8_COVERAGE is not set
  const originalEnv = process.env.NODE_V8_COVERAGE;
  delete process.env.NODE_V8_COVERAGE;

  try {
    // Invoke the private method via message handling
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (communicator as any).handleCoverageSnapshotRequest("test-req-1", false);

    // Check that error response was sent
    t.is(sentMessages.length, 1);
    t.is(sentMessages[0].type, MessageType.COVERAGE_SNAPSHOT);
    t.is(sentMessages[0].payload.oneofKind, "coverageSnapshotResponse");
    if (sentMessages[0].payload.oneofKind === "coverageSnapshotResponse") {
      t.false(sentMessages[0].payload.coverageSnapshotResponse.success);
      t.is(sentMessages[0].payload.coverageSnapshotResponse.error, "NODE_V8_COVERAGE not set");
    }
  } finally {
    if (originalEnv !== undefined) {
      process.env.NODE_V8_COVERAGE = originalEnv;
    }
  }
});

test("handleCoverageSnapshotRequest: handles errors during processing", async (t) => {
  const originalEnv = process.env.NODE_V8_COVERAGE;
  // Set to a non-existent directory to trigger error
  process.env.NODE_V8_COVERAGE = "/nonexistent/coverage/dir";

  try {
    const { communicator, sentMessages } = createTestCommunicator();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (communicator as any).handleCoverageSnapshotRequest("test-req-4", false);

    // Should send error response
    t.is(sentMessages.length, 1);
    if (sentMessages[0].payload.oneofKind === "coverageSnapshotResponse") {
      const response = sentMessages[0].payload.coverageSnapshotResponse;
      t.false(response.success);
      t.truthy(response.error);
      t.true(response.error.length > 0);
    }
  } finally {
    if (originalEnv !== undefined) {
      process.env.NODE_V8_COVERAGE = originalEnv;
    } else {
      delete process.env.NODE_V8_COVERAGE;
    }
  }
});

// --- sendCoverageResponse tests ---

test("sendCoverageResponse: creates correct message structure", async (t) => {
  const { communicator, sentMessages } = createTestCommunicator();

  const mockCoverage: Record<string, FileCoverageData> = {
    "/path/to/file.js": FileCoverageData.create({
      lines: { "1": 1, "2": 2 },
      totalBranches: 4,
      coveredBranches: 2,
      branches: {
        "3": BranchInfo.create({ total: 2, covered: 1 }),
        "5": BranchInfo.create({ total: 2, covered: 1 }),
      },
    }),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (communicator as any).sendCoverageResponse("req-123", true, "", mockCoverage);

  t.is(sentMessages.length, 1);
  const msg = sentMessages[0];

  t.is(msg.type, MessageType.COVERAGE_SNAPSHOT);
  t.is(msg.requestId, "req-123");
  t.is(msg.payload.oneofKind, "coverageSnapshotResponse");

  if (msg.payload.oneofKind === "coverageSnapshotResponse") {
    const response = msg.payload.coverageSnapshotResponse;
    t.true(response.success);
    t.is(response.error, "");
    t.deepEqual(response.coverage, mockCoverage);
  }
});

test("sendCoverageResponse: handles error responses", async (t) => {
  const { communicator, sentMessages } = createTestCommunicator();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (communicator as any).sendCoverageResponse("req-456", false, "Test error message", {});

  t.is(sentMessages.length, 1);
  const msg = sentMessages[0];

  if (msg.payload.oneofKind === "coverageSnapshotResponse") {
    const response = msg.payload.coverageSnapshotResponse;
    t.false(response.success);
    t.is(response.error, "Test error message");
    t.deepEqual(response.coverage, {});
  }
});

