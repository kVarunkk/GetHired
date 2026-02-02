import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { getVertexClient } from "@/lib/serverUtils";
import "pdf-parse/worker";
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

const ResumeSchema = z.object({
  sections: z.array(
    z.object({
      type: z
        .enum([
          "experience",
          "projects",
          "skills",
          "education",
          "summary",
          "achievements",
          "other",
        ])
        .describe(
          "The category of this section. Use 'other' for certifications, languages, or custom headers."
        ),
      items: z.array(
        z.object({
          heading: z
            .string()
            .optional()
            .describe("The name of the company, school, or project."),
          subheading: z
            .string()
            .optional()
            .describe("The role title, degree, or date range."),
          bullets: z.array(
            z.object({
              id: z
                .string()
                .describe(
                  "A unique UUID-style string for this specific bullet. MUST be unique across the entire document."
                ),
              text: z
                .string()
                .describe(
                  "The full text of the bullet, even if it spans multiple lines in the source."
                ),
              lineIndices: z
                .array(z.number())
                .describe(
                  "The original indices from the input lines that form this text."
                ),
            })
          ),
        })
      ),
    })
  ),
});
type ParsedProfile = z.infer<typeof ResumeSchema>;

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

async function generateStructuredProfile(
  lines: string[]
): Promise<ParsedProfile> {
  try {
    const vertex = await getVertexClient();
    const model = vertex("gemini-2.5-flash-lite");

    const { output: parsedResume } = await generateText({
      model: model,
      system: `You are a precision Document Reconstruction Engine. 
      
      CORE MISSION: Reconstruct complete, grammatical bullet points from fragmented PDF lines. 

      STRICT RULES:
      1. MERGING: Most bullet points in PDFs wrap across 2-3 lines. You MUST stitch these fragments back into a single, cohesive string.
      2. SENTENCE INTEGRITY: If a line does not end in a period or a complete thought, it almost certainly continues on the next line. Do NOT create separate objects for fragments like "reduced errors in".
      3. LINE MAPPING: In the 'lineIndices' array, list every index involved in that specific reconstructed bullet point.
      4. ID UNIQUENESS: Generate a random UUID for the 'id'. Never reuse IDs across bullets.`,
      prompt: `
        The following lines are extracted from a PDF. Reconstruct them into a structured "Digital Twin" JSON.
        
        INPUT DATA:
        ${lines.map((l, i) => `[${i}] ${l}`).join("\n")}
      `,
      output: Output.object({
        schema: ResumeSchema,
      }),
    });

    return parsedResume as ParsedProfile;
  } catch (err) {
    console.error("[RESUME_STRUCTURE_ERROR]:", err);
    throw new Error("AI engine failed to generate a valid document structure.");
  }
}

export async function POST(req: Request) {
  const { userId, resumeId } = await req.json();

  if (!userId || !resumeId) {
    return NextResponse.json(
      { error: "Missing user ID or resume path." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.id !== userId) {
    return NextResponse.json(
      { error: "Unauthorized access or user mismatch." },
      { status: 401 }
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
      { status: 404 }
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
        { status: 500 }
      );
    }

    const lines = await extractTextFromPdf(signedUrlData?.signedUrl);

    if (!lines || lines.length === 0) {
      return NextResponse.json(
        { error: "Resume file contained no readable text." },
        { status: 422 }
      );
    }

    const parsedProfile = await generateStructuredProfile(lines);

    const { error: dbError } = await supabase
      .from("resumes")
      .update({
        content: parsedProfile,
      })
      .eq("id", resumeId);

    if (dbError) throw dbError;

    return NextResponse.json({
      success: true,
    });
  } catch (e) {
    console.error("Resume parsing process failed:", e);
    return NextResponse.json(
      { error: "Internal server processing failure during file extraction." },
      { status: 500 }
    );
  }
}
