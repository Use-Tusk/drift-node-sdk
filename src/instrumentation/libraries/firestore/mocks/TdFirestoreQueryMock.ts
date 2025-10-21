import { FirestoreQueryResult } from "../types";
import { TdFirestoreDocumentMock } from "./TdFirestoreDocumentMock";

/**
 * Mock Firestore QuerySnapshot for replay mode
 * Mimics the Firestore QuerySnapshot API
 */
export class TdFirestoreQueryMock {
  private queryResult: FirestoreQueryResult;
  private _docs: TdFirestoreDocumentMock[];

  constructor(queryResult: FirestoreQueryResult) {
    this.queryResult = queryResult;
    this._docs = queryResult.docs.map((doc) => new TdFirestoreDocumentMock(doc));
  }

  /**
   * An array of all the documents in the QuerySnapshot
   */
  get docs(): TdFirestoreDocumentMock[] {
    return this._docs;
  }

  /**
   * The number of documents in the QuerySnapshot
   */
  get size(): number {
    return this.queryResult.size;
  }

  /**
   * True if there are no documents in the QuerySnapshot
   */
  get empty(): boolean {
    return this.queryResult.empty;
  }

  /**
   * The time the query snapshot was read
   */
  get readTime(): any {
    return this.queryResult.readTime
      ? {
          seconds: this.queryResult.readTime.seconds,
          nanoseconds: this.queryResult.readTime.nanoseconds,
          toDate: () =>
            new Date(
              this.queryResult.readTime!.seconds * 1000 +
                this.queryResult.readTime!.nanoseconds / 1000000,
            ),
        }
      : null;
  }

  /**
   * The query on which you called get or onSnapshot
   */
  get query(): any {
    // Return a minimal mock query reference
    return {
      // Mock query object - can be extended if needed
    };
  }

  /**
   * Enumerates all of the documents in the QuerySnapshot
   */
  forEach(callback: (result: TdFirestoreDocumentMock) => void, thisArg?: any): void {
    this._docs.forEach(callback, thisArg);
  }

  /**
   * Returns an array of the documents changes since the last snapshot
   */
  docChanges(): any[] {
    // In replay mode, we don't track changes, so return empty array
    return [];
  }

  /**
   * Returns true if the document data and path are equal to this QuerySnapshot
   */
  isEqual(other: TdFirestoreQueryMock): boolean {
    if (this.size !== other.size) {
      return false;
    }
    // Simple comparison based on size - could be enhanced
    return this.size === other.size && this.empty === other.empty;
  }
}
