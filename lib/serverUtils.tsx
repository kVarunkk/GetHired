import { createVertex } from "@ai-sdk/google-vertex";
import fs from "fs/promises";
import { Info, MoreHorizontal, Sparkle } from "lucide-react";
import path from "path";

export async function getVertexClient() {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;

  if (!credentialsJson) {
    throw new Error("GOOGLE_CREDENTIALS_JSON environment variable is not set.");
  }

  const tempFilePath = path.join("/tmp", "credentials.json");

  try {
    await fs.writeFile(tempFilePath, JSON.parse(`"${credentialsJson}"`));
  } catch {
    throw new Error("Failed to set up credentials for Vertex AI.");
  }

  process.env.GOOGLE_APPLICATION_CREDENTIALS = tempFilePath;

  return createVertex({
    project: "mern-twitter-368919",
    location: "us-central1",
  });
}

export function getCutOffDate(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

export const featureData = {
  title: "Applying to Jobs Just Got Easier with Ask AI!",
  description:
    "Introducing our new Ask AI feature! Get personalized, ready-to-paste answers for tricky application and interview questions. The AI synthesizes your unique profile (skills, projects) directly with the job requirements.",
  confirmButtonLabel: "Dismiss",
  // featureHighlight:
  //   "Instantly generate custom answers that relate your experience directly to the job description.",
  promoImage: "/Screenshot 2025-12-02 191053.png", // Suggested new path for better context
  // Provide concrete examples of questions the user can now answer effortlessly
  customContent: (
    <div className="flex items-center gap-3 rounded-md bg-secondary p-3 border border-border">
      <Info className="h-4 w-4 shrink-0" />
      <p className="text-sm">
        Use the{" "}
        <span className="font-bold inline-flex  gap-1">
          <Sparkle className="h-4 w-4" /> Ask AI
        </span>{" "}
        feature by clicking
        <MoreHorizontal className="h-4 w-4 inline-block mx-1" /> on any job
        listing to get assistance with your application.
      </p>
    </div>
  ),
  currentDialogId: "AI_PREP_QANDA_V1", // New, unique ID for this feature tour
};

// export const featureData = null;
