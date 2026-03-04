/**
 * Fake MongoDB cursors for replay mode.
 *
 * These implement the key cursor interface methods so that application code
 * interacting with a cursor works correctly during replay without hitting
 * a real database. Supports builder-pattern chaining (sort, limit, skip, etc.)
 * and all terminal iteration methods (toArray, next, forEach, async iterator).
 *
 * Lazy mock loading: The constructor accepts an optional `mockDataLoader`
 * function. When provided, mock data is not loaded until the first terminal
 * method is called. This preserves the synchronous return signature of
 * find()/aggregate() while deferring the async mock lookup.
 */
export class TdFakeFindCursor {
  protected documents: any[];
  private index: number = 0;
  private _mockDataLoader: (() => Promise<any[]>) | null;
  private _mockLoadPromise: Promise<any[]> | null = null;
  private _mockLoaded: boolean;

  constructor(documents: any[] = [], mockDataLoader?: () => Promise<any[]>) {
    this.documents = documents;
    this._mockDataLoader = mockDataLoader || null;
    this._mockLoaded = !mockDataLoader;
  }

  /**
   * Lazily load mock data on first terminal method call.
   * Subsequent calls return the same cached promise.
   */
  private async _ensureMockLoaded(): Promise<void> {
    if (this._mockLoaded) return;
    if (!this._mockLoadPromise && this._mockDataLoader) {
      this._mockLoadPromise = this._mockDataLoader().then((docs) => {
        this.documents = docs;
        this._mockLoaded = true;
        return docs;
      });
    }
    if (this._mockLoadPromise) {
      await this._mockLoadPromise;
    }
  }

  // --- Terminal methods (must await mock loading) ---

  async toArray(): Promise<any[]> {
    await this._ensureMockLoaded();
    return [...this.documents];
  }

  async next(): Promise<any | null> {
    await this._ensureMockLoaded();
    return this.documents[this.index++] ?? null;
  }

  async tryNext(): Promise<any | null> {
    await this._ensureMockLoaded();
    return this.documents[this.index++] ?? null;
  }

  async hasNext(): Promise<boolean> {
    await this._ensureMockLoaded();
    return this.index < this.documents.length;
  }

  async forEach(fn: (doc: any) => void): Promise<void> {
    await this._ensureMockLoaded();
    this.documents.forEach(fn);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<any> {
    await this._ensureMockLoaded();
    for (const doc of this.documents) {
      yield doc;
    }
  }

  // --- Builder methods (return this for chaining) ---

  filter(): this {
    return this;
  }
  sort(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  skip(): this {
    return this;
  }
  project(): this {
    return this;
  }
  hint(): this {
    return this;
  }
  batchSize(): this {
    return this;
  }
  maxTimeMS(): this {
    return this;
  }
  collation(): this {
    return this;
  }
  comment(): this {
    return this;
  }
  min(): this {
    return this;
  }
  max(): this {
    return this;
  }
  returnKey(): this {
    return this;
  }
  showRecordId(): this {
    return this;
  }
  addQueryModifier(): this {
    return this;
  }
  maxAwaitTimeMS(): this {
    return this;
  }
  allowDiskUse(): this {
    return this;
  }
  addCursorFlag(): this {
    return this;
  }
  withReadPreference(): this {
    return this;
  }
  withReadConcern(): this {
    return this;
  }

  map(transform: (doc: any) => any): this {
    if (this._mockLoaded) {
      this.documents = this.documents.map(transform);
    } else {
      // Chain the transform for application after mock data loads
      const originalLoader = this._mockDataLoader;
      if (originalLoader) {
        this._mockDataLoader = async () => {
          const docs = await originalLoader();
          return docs.map(transform);
        };
        // Reset cached promise since loader changed
        this._mockLoadPromise = null;
      }
    }
    return this;
  }

  // --- Lifecycle methods ---

  async close(): Promise<void> {}

  rewind(): void {
    this.index = 0;
  }

  clone(): TdFakeFindCursor {
    if (this._mockLoaded) {
      return new TdFakeFindCursor([...this.documents]);
    }
    return new TdFakeFindCursor([], this._mockDataLoader || undefined);
  }

  // Stream support — returns a minimal async iterable
  stream(): AsyncIterable<any> {
    return this[Symbol.asyncIterator]() as any;
  }
}

/**
 * Fake MongoDB AggregationCursor for replay mode.
 *
 * Extends TdFakeFindCursor with pipeline builder methods that are no-ops
 * during replay (the recorded result set is already computed).
 */
export class TdFakeAggregationCursor extends TdFakeFindCursor {
  constructor(documents: any[] = [], mockDataLoader?: () => Promise<any[]>) {
    super(documents, mockDataLoader);
  }

  // Pipeline builder methods (return this for chaining)
  addStage(): this {
    return this;
  }
  match(): this {
    return this;
  }
  group(): this {
    return this;
  }
  lookup(): this {
    return this;
  }
  unwind(): this {
    return this;
  }
  addFields(): this {
    return this;
  }
  out(): this {
    return this;
  }
  merge(): this {
    return this;
  }
  redact(): this {
    return this;
  }
  geoNear(): this {
    return this;
  }
}

/**
 * Fake MongoDB ChangeStream for replay mode.
 *
 * ChangeStreams are long-lived event-based streams. In replay mode, no real
 * server connection exists so we return this minimal stub that:
 * - Is EventEmitter-compatible (on/once/off/removeListener)
 * - close() is a no-op
 * - The async iterator yields nothing
 * - hasNext() returns false, next() returns null
 *
 * This prevents crashes when application code creates a ChangeStream
 * during replay, without attempting to replay individual change events.
 */
export class TdFakeChangeStream {
  private _closed: boolean = false;
  private _listeners: Map<string, Function[]> = new Map();

  on(event: string, listener: Function): this {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event)!.push(listener);
    return this;
  }

  once(event: string, listener: Function): this {
    const wrappedListener = (...args: any[]) => {
      this.off(event, wrappedListener);
      listener(...args);
    };
    return this.on(event, wrappedListener);
  }

  off(event: string, listener: Function): this {
    const eventListeners = this._listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(listener);
      if (index !== -1) {
        eventListeners.splice(index, 1);
      }
    }
    return this;
  }

  removeListener(event: string, listener: Function): this {
    return this.off(event, listener);
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
    return this;
  }

  async close(): Promise<void> {
    this._closed = true;
  }

  get closed(): boolean {
    return this._closed;
  }

  async hasNext(): Promise<boolean> {
    return false;
  }

  async next(): Promise<null> {
    return null;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<any> {
    // No events to yield in replay mode
  }

  stream(): AsyncIterable<any> {
    return this[Symbol.asyncIterator]() as any;
  }
}
