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
 */
export class TdFakeTopology extends EventEmitter {
  s: { options: Record<string, unknown> };

  constructor() {
    super();
    this.s = { options: {} };
  }

  lastHello(): Record<string, unknown> {
    return {};
  }

  lastIsMaster(): Record<string, unknown> {
    return {};
  }
}
