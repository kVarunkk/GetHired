import { getVertexClient } from "@/utils/vertex";
import { z } from "zod";
import { wrapInSandbox } from "../ai/security";
import { generateText, Output } from "ai";
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendResumeParsingStatusEmail } from "@/app/actions/send-resume-status-email";
import { deductUserCreditsHelper } from "../ai/deduct-user-credits";
import { TAICredits } from "@/utils/types";
import { v4 as uuidv4 } from "uuid";

const ResumeSchema = z.object({
  sections: z.array(
    z.object({
      type: z.enum([
        "experience",
        "projects",
        "skills",
        "education",
        "summary",
        "achievements",
        "other",
      ]),
      items: z.array(
        z.object({
          heading: z.string().optional(),
          subheading: z.string().optional(),
          bullets: z.array(
            z.object({
              text: z.string().min(1),
              lineIndices: z
                .array(z.number())
                .describe("Original indices used for this text."),
            }),
          ),
        }),
      ),
    }),
  ),
});

async function extractTextFromPdf(url: string): Promise<string[]> {
  try {
    const parser = new PDFParse({ url: url, CanvasFactory });
    const result = await parser.getText();
    const rawText = result.text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return rawText;
  } catch {
    throw new Error("Some error occured while ");
  }
}

async function generateStructuredProfile(lines: string[]) {
  try {
    const vertex = await getVertexClient();
    // using flash here instead of flash-lite
    const model = vertex("gemini-2.5-flash");

    const systemPrompt = `
      You are a precision Document Reconstruction Engine. 
      Your mission: Map fragmented PDF lines into a structured "Digital Twin" JSON.

      STRICT RULES:
      1. MERGING: PDFs often split sentences across lines. Stitch these fragments into single cohesive strings.
      2. INDEX MAPPING: You MUST provide the [index] for every line used in 'lineIndices'. Do not guess.
      3. INTEGRITY: Do not summarize. Preserve the original phrasing exactly.
      4. EXCLUSION: Ignore page numbers, headers/footers, and contact info if they don't fit the schema.
      5. FORMAT: Output ONLY the JSON object.
    `.trim();

    const inputData = wrapInSandbox(
      "source_lines",
      lines.map((l, i) => `[${i}] ${l}`).join("\n"),
    );

    const { output: rawProfile } = await generateText({
      model: model,
      system: systemPrompt,
      prompt: `Reconstruct this document:\n${inputData}`,
      output: Output.object({
        schema: ResumeSchema,
      }),
    });

    const processedSections = rawProfile.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        bullets: item.bullets.map((bullet) => ({
          ...bullet,
          id: uuidv4(),
        })),
      })),
    }));

    return { sections: processedSections };
  } catch (err) {
    console.error("[RESUME_STRUCTURE_ERROR]:", err);
    throw new Error("AI engine failed to generate a valid document structure.");
  }
}

export async function parseResume(userId: string, resumeId: string) {
  const before = process.memoryUsage().rss / 1024 / 1024;
  const supabase = createServiceRoleClient();

  // Keep track of metadata locally in case fetching fails early
  let userEmail: string | null = null;
  let resumeName = "Resume";

  try {
    if (!userId || !resumeId) {
      throw new Error("User id or resume id not found.");
    }

    // 1. Fetch initial details
    const { data: resumeData, error: resumeError } = await supabase
      .from("resumes")
      .select("resume_path, name, user_info(email)")
      .eq("id", resumeId)
      .eq("user_id", userId)
      .single();

    if (resumeError || !resumeData) {
      throw new Error(
        resumeError?.message || "Error occurred while fetching resume data.",
      );
    }

    // Cache metadata safely for the failure catch blocks
    resumeName = resumeData.name || "Resume";
    userEmail = resumeData.user_info?.email ?? null;

    if (!resumeData.resume_path) {
      throw new Error("Resume record does not contain a file path.");
    }

    // 2. Storage Operations
    const { data: signedUrlData, error: signedUrlError } =
      await supabase.storage
        .from("resumes")
        .createSignedUrl(resumeData.resume_path, 120);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error("Storage signed URL generation failed:", signedUrlError);
      throw new Error(
        signedUrlError?.message ||
          "Failed to generate signed URL for resume file.",
      );
    }

    // 3. Processing Operations
    const lines = await extractTextFromPdf(signedUrlData.signedUrl);
    if (!lines || lines.length === 0) {
      throw new Error("Resume file contained no readable text.");
    }

    const parsedProfile = await generateStructuredProfile(lines);
    if (!parsedProfile || parsedProfile?.sections?.length === 0) {
      throw new Error(
        "Resume content could not be converted to a structured profile.",
      );
    }

    const after = process.memoryUsage().rss / 1024 / 1024;
    if (after - before > 2) {
      console.log(
        `[mem-delta] PARSE RESUME : ${before.toFixed(0)}MB -> ${after.toFixed(0)}MB (+${(after - before).toFixed(0)}MB)`,
      );
    }

    // 4. Update Database with Success Data
    const { error: dbError } = await supabase
      .from("resumes")
      .update({
        content: parsedProfile,
        parsing_failed: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", resumeId);

    if (dbError) throw new Error(`Database save failed: ${dbError.message}`);

    // 5. Post-processing Infrastructure (Isolated from core logic failures)
    try {
      await sendResumeParsingStatusEmail(
        userEmail,
        "success",
        resumeName,
        resumeId,
      );
      await deductUserCreditsHelper(
        supabase,
        userId,
        TAICredits.AI_SEARCH_ASK_AI_RESUME,
      );
    } catch (postError) {
      // Log notification/billing errors but DO NOT mark the resume processing as failed
      console.error(
        "[POST_PROCESSING_WARNING]: Email or credit deduction failed:",
        postError,
      );
    }
  } catch (e) {
    const errorMessage =
      e instanceof Error ? e.message : "Unknown error occurred";
    console.error(`[RESUME_PARSING_FAILED] ID: ${resumeId}:`, errorMessage);

    // Update database state safely to inform UI that parsing stopped
    await supabase
      .from("resumes")
      .update({
        content: null,
        parsing_failed: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", resumeId);

    // Fire failure email safely using cached data
    try {
      await sendResumeParsingStatusEmail(
        userEmail,
        "failure",
        resumeName,
        resumeId,
      );
    } catch (emailErr) {
      console.error(
        "[EMAIL_NOTIFICATION_FAILED]: Failed to send failure email:",
        emailErr,
      );
    }
  }
}
