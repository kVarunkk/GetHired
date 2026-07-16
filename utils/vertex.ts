// import { createVertex } from "@ai-sdk/google-vertex";
// import fs from "fs/promises";
// import path from "path";

// export async function getVertexClient() {
//   // const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;

//   // if (!credentialsJson) {
//   //   throw new Error("GOOGLE_CREDENTIALS_JSON environment variable is not set.");
//   // }

//   // const tempFilePath = path.join("/tmp", "credentials.json");

//   // try {
//   //   await fs.writeFile(tempFilePath, JSON.parse(`"${credentialsJson}"`));
//   // } catch {
//   //   throw new Error("Failed to set up credentials for Vertex AI.");
//   // }

//   // process.env.GOOGLE_APPLICATION_CREDENTIALS = tempFilePath;

//   return createVertex({
//     project: "gethired-477210",
//     // location: "us-central1",
//     apiKey: process.env.GOOGLE_API_KEY,
//   });
// }

import { createVertex } from "@ai-sdk/google-vertex";
import fs from "fs/promises";
import path from "path";

const PROJECT_ID = "mern-twitter-368919";
const LOCATION = "us-central1";
const CREDENTIALS_FILE_PATH = path.join("/tmp", "google-credentials.json");

type VertexClient = ReturnType<typeof createVertex>;

let vertexClientPromise: Promise<VertexClient> | null = null;

function normalizeGoogleCredentials(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    try {
      return JSON.parse(`"${raw}"`);
    } catch {
      return raw;
    }
  }
}

async function initializeVertexClient(): Promise<VertexClient> {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;

  if (!credentialsJson) {
    throw new Error("GOOGLE_CREDENTIALS_JSON environment variable is not set.");
  }

  const normalized = normalizeGoogleCredentials(credentialsJson);

  await fs.mkdir(path.dirname(CREDENTIALS_FILE_PATH), { recursive: true });
  await fs.writeFile(CREDENTIALS_FILE_PATH, normalized, "utf8");

  process.env.GOOGLE_APPLICATION_CREDENTIALS = CREDENTIALS_FILE_PATH;

  return createVertex({
    project: PROJECT_ID,
    location: LOCATION,
  });
}

export async function getVertexClient() {
  if (!vertexClientPromise) {
    vertexClientPromise = initializeVertexClient();
  }

  return await vertexClientPromise;
}
