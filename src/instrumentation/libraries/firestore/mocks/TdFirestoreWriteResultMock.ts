import { FirestoreWriteResult } from "../types";

/**
 * Mock Firestore WriteResult for replay mode
 * Mimics the Firestore WriteResult API
 */
export class TdFirestoreWriteResultMock {
  private result: FirestoreWriteResult;

  constructor(result: FirestoreWriteResult) {
    this.result = result;
  }

  /**
   * The write time as reported by the server
   */
  get writeTime(): any {
    return this.result.writeTime
      ? {
          seconds: this.result.writeTime.seconds,
          nanoseconds: this.result.writeTime.nanoseconds,
          toDate: () =>
            new Date(
              this.result.writeTime!.seconds * 1000 +
                this.result.writeTime!.nanoseconds / 1000000,
            ),
        }
      : null;
  }

  /**
   * Returns true if this WriteResult is equal to the provided one
   */
  isEqual(other: TdFirestoreWriteResultMock): boolean {
    if (!this.writeTime || !other.writeTime) {
      return this.writeTime === other.writeTime;
    }
    return (
      this.writeTime.seconds === other.writeTime.seconds &&
      this.writeTime.nanoseconds === other.writeTime.nanoseconds
    );
  }
}
