import { EventEmitter } from "events";

/**
 * Fake MongoDB Topology for replay mode.
 *
 * When BulkOperationBase is constructed, it calls getTopology(collection)
 * which requires a connected topology. In replay mode, no real connection
 * exists, so we inject this fake topology to satisfy the constructor's
 * requirements without hitting a real server.
 *
 * The constructor reads:
 *   - topology.lastHello()       -> returns {} so all size limits use defaults
 *   - topology.lastIsMaster()    -> returns {} (legacy compat)
 *   - topology.s.options         -> returns {} so autoEncryption check is false
 *
 * The topology is also injected onto the shared MongoClient (via
 * _injectFakeTopology) and persists across requests. Other driver code
 * (e.g. ClientSession.loadBalanced getter) accesses
 * topology.description.type, so we provide a minimal description to
 * prevent TypeError when the property is read.
 */
export class TdFakeTopology extends EventEmitter {
  s: { options: Record<string, unknown> };
  description: {
    type: string;
    servers: Map<string, unknown>;
    hasServer: (address: string) => boolean;
  };

  constructor() {
    super();
    this.s = { options: {} };
    this.description = {
      type: "Unknown",
      servers: new Map(),
      hasServer: () => false,
    };
  }

  lastHello(): Record<string, unknown> {
    return {};
  }

  lastIsMaster(): Record<string, unknown> {
    return {};
  }
}
