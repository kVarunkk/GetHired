import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getVertexClient } from "@/lib/serverUtils";
import { PDFParse } from "pdf-parse";

const ParsedProfileSchema = z.object({
  projects: z
    .string()
    .describe(
      "A summary of the user's key projects, skills used, and outcomes."
    ),
  experience: z
    .string()
    .describe(
      "A chronological summary of the user's work history and career level (e.g., total years, focus areas)."
    ),
  skills: z
    .string()
    .describe(
      "A comma-separated string of the user's core technical and soft skills (e.g., 'React, TypeScript, Python, Kafka')."
    ),
});
type ParsedProfile = z.infer<typeof ParsedProfileSchema>;

async function extractTextFromPdf(url: string): Promise<string> {
  const parser = new PDFParse({ url: url });
  const result = await parser.getText();
  const rawText = result.text.replace(/(\s{2,}|\n+)/g, " ").trim();
  return rawText;
}

async function generateStructuredProfile(
  rawText: string
): Promise<ParsedProfile> {
  const prompt = `You are a strict data extraction engine. Analyze the following raw text from a resume. Clean the data and fill the required JSON schema fields accurately.

    Resume Text:
    ---
    ${rawText}
    ---
    `;

  const vertex = await getVertexClient();
  const model = vertex("gemini-2.0-flash-lite-001");

  const { object: parsedProfile } = await generateObject({
    model: model,
    prompt: prompt,
    schema: ParsedProfileSchema,
  });

  return parsedProfile as ParsedProfile;
}

export async function POST(req: Request) {
  const { userId, resumePath } = await req.json();

  if (!userId || !resumePath) {
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

  try {
    const { data: signedUrlData, error: signedUrlError } =
      await supabase.storage.from("resumes").createSignedUrl(resumePath, 120);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error("Storage signed URL generation failed:", signedUrlError);
      return NextResponse.json(
        { error: "Failed to generate signed URL for resume file." },
        { status: 500 }
      );
    }

    const rawText = await extractTextFromPdf(signedUrlData?.signedUrl);

    if (!rawText.trim()) {
      return NextResponse.json(
        { error: "Resume file contained no readable text." },
        { status: 422 }
      );
    }

    const parsedProfile = await generateStructuredProfile(rawText);

    const { error: updateError } = await supabase
      .from("user_info")
      .update({
        projects_resume: parsedProfile.projects,
        experience_resume: parsedProfile.experience,
        skills_resume: parsedProfile.skills,
      })
      .eq("user_id", userId);

    if (updateError) {
      console.error("DB update failed:", updateError);
      return NextResponse.json(
        { error: "Failed to save parsed profile to database." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Profile successfully extracted and updated.",
    });
  } catch (e) {
    console.error("Resume parsing process failed:", e);
    return NextResponse.json(
      { error: "Internal server processing failure during file extraction." },
      { status: 500 }
    );
  }
}
