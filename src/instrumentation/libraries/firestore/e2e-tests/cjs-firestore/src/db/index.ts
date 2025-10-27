import { Firestore } from "@google-cloud/firestore";

let db: Firestore | null = null;

export function getDb(): Firestore {
  if (!db) {
    // Parse service account from environment variable
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (!projectId) {
      throw new Error("FIREBASE_PROJECT_ID environment variable is not set");
    }

    if (!serviceAccountJson) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT environment variable is not set");
    }

    let serviceAccount: any;
    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch (error) {
      console.error("Full JSON:", serviceAccountJson);
      throw new Error("Failed to parse FIREBASE_SERVICE_ACCOUNT JSON: " + error);
    }

    // Initialize Firestore with service account credentials
    db = new Firestore({
      projectId: projectId,
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      },
    });

    console.log(`Firestore initialized for project: ${projectId}`);
  }

  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.terminate();
    db = null;
  }
}
