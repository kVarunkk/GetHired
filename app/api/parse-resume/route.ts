import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { getVertexClient } from "@/utils/serverUtils";
import "pdf-parse/worker";
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { wrapInSandbox } from "@/helpers/ai/security";
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

export async function POST(req: Request) {
  const { resumeId } = await req.json();

  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json(
      { error: "Unauthorized access or user mismatch." },
      { status: 401 },
    );
  }
  const userId = user.id;

  if (!userId || !resumeId) {
    return NextResponse.json(
      { error: "Missing user ID or resume path." },
      { status: 400 },
    );
  }

  const { data: resumeData, error: resumeError } = await supabase
    .from("resumes")
    .select("resume_path, name")
    .eq("id", resumeId)
    .eq("user_id", userId)
    .single();

  if (resumeError || !resumeData) {
    return NextResponse.json(
      { error: "Resume not found for the given user." },
      { status: 404 },
    );
  }

  try {
    const { data: signedUrlData, error: signedUrlError } =
      await supabase.storage
        .from("resumes")
        .createSignedUrl(resumeData.resume_path, 120);
    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error("Storage signed URL generation failed:", signedUrlError);
      return NextResponse.json(
        { error: "Failed to generate signed URL for resume file." },
        { status: 500 },
      );
    }

    const lines = await extractTextFromPdf(signedUrlData?.signedUrl);

    if (!lines || lines.length === 0) {
      return NextResponse.json(
        { error: "Resume file contained no readable text." },
        { status: 422 },
      );
    }

    const parsedProfile = await generateStructuredProfile(lines);

    const { error: dbError } = await supabase
      .from("resumes")
      .update({
        content: parsedProfile,
        parsing_failed: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", resumeId);

    if (dbError) throw dbError;

    return NextResponse.json({
      success: true,
    });
  } catch (e) {
    console.error("Resume parsing process failed:", e);
    await supabase
      .from("resumes")
      .update({
        parsing_failed: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", resumeId);
    return NextResponse.json(
      { error: "Internal server processing failure during file extraction." },
      { status: 500 },
    );
  }
}
