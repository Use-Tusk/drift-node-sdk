import { FirestoreDocumentResult, FirestoreDocumentData } from "../types";

/**
 * Mock Firestore DocumentSnapshot for replay mode
 * Mimics the Firestore DocumentSnapshot API
 */
export class TdFirestoreDocumentMock {
  private documentData: FirestoreDocumentResult;

  constructor(documentData: FirestoreDocumentResult) {
    this.documentData = documentData;
  }

  /**
   * The document's identifier within its collection
   */
  get id(): string {
    return this.documentData.id;
  }

  /**
   * Whether the document exists
   */
  get exists(): boolean {
    return this.documentData.exists;
  }

  /**
   * A DocumentReference to the document location
   */
  get ref(): any {
    // Return a minimal mock reference
    return {
      id: this.documentData.id,
      path: this.documentData.path,
    };
  }

  /**
   * The time the document was created (if available)
   */
  get createTime(): any {
    return this.documentData.createTime
      ? {
          seconds: this.documentData.createTime.seconds,
          nanoseconds: this.documentData.createTime.nanoseconds,
          toDate: () =>
            new Date(
              this.documentData.createTime!.seconds * 1000 +
                this.documentData.createTime!.nanoseconds / 1000000,
            ),
        }
      : null;
  }

  /**
   * The time the document was last updated (if available)
   */
  get updateTime(): any {
    return this.documentData.updateTime
      ? {
          seconds: this.documentData.updateTime.seconds,
          nanoseconds: this.documentData.updateTime.nanoseconds,
          toDate: () =>
            new Date(
              this.documentData.updateTime!.seconds * 1000 +
                this.documentData.updateTime!.nanoseconds / 1000000,
            ),
        }
      : null;
  }

  /**
   * The time the document was read (if available)
   */
  get readTime(): any {
    return this.documentData.readTime
      ? {
          seconds: this.documentData.readTime.seconds,
          nanoseconds: this.documentData.readTime.nanoseconds,
          toDate: () =>
            new Date(
              this.documentData.readTime!.seconds * 1000 +
                this.documentData.readTime!.nanoseconds / 1000000,
            ),
        }
      : null;
  }

  /**
   * Retrieves all fields in the document as an object
   */
  data(): FirestoreDocumentData | undefined {
    return this.documentData.data;
  }

  /**
   * Retrieves the field specified by fieldPath
   */
  get(fieldPath: string): any {
    if (!this.documentData.data) {
      return undefined;
    }

    // Simple field path resolution (doesn't handle nested paths with dots)
    return this.documentData.data[fieldPath];
  }

  /**
   * Returns true if the document's data and path are equal to the provided value
   */
  isEqual(other: TdFirestoreDocumentMock): boolean {
    return this.documentData.path === other.documentData.path;
  }
}
