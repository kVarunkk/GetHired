import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getVertexClient } from "@/lib/serverUtils";
import { createClient } from "@/lib/supabase/server";
import { TAICredits } from "@/lib/types";

export async function POST(req: Request) {
  const { userQuery } = await req.json();

  if (!userQuery) {
    return NextResponse.json({ error: "Missing userQuery" }, { status: 400 });
  }

  if (userQuery.length > 100) {
    return NextResponse.json({
      error: "Prompt should be shorter than 100 characters",
    });
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userInfo } = await supabase
    .from("user_info")
    .select("ai_credits")
    .eq("user_id", user.id)
    .single();

  if (!userInfo) {
    return NextResponse.json(
      {
        message: "User not found.",
      },
      { status: 404 }
    );
  }

  if (userInfo.ai_credits < TAICredits.AI_SEARCH_OR_ASK_AI) {
    return NextResponse.json(
      { message: "Insufficient AI credits. Please top up to continue." },
      { status: 402 }
    );
  }

  // Initialize the client and model (as per your structure)
  const vertex = await getVertexClient();
  const model = vertex("gemini-2.0-flash-lite-001");

  const systemPrompt = `You are a sophisticated search filter parser. Your task is to extract job filtering criteria from the user's natural language query and convert them into a strict JSON object that adheres to the provided Zod schema. Output should only contain the defined keys.`;

  // --- CALL USING YOUR STRUCTURE ---
  try {
    const { object: filters } = await generateObject({
      model: model, // Pass the initialized model client
      prompt: userQuery,
      // Replicate the JSON Schema using Zod syntax for the generateObject utility
      schema: z.object({
        jobType: z
          .array(z.string())
          .describe(
            "List of job types (allowed values: 'Fulltime', 'Contract', 'Intern')."
          ),
        location: z
          .array(z.string())
          .describe(
            "List of general locations (e.g., 'Bangalore', 'Gurgaon', 'Remote')."
          ),
        visaRequirement: z
          .array(z.string())
          .describe("List of visa requirement terms."),
        platform: z.array(z.string()).describe("List of job source platforms."),
        companyName: z
          .array(z.string())
          .describe("List of company names to filter by."),
        applicationStatus: z
          .array(z.string())
          .describe("List of application status terms."),
        jobTitleKeywords: z
          .array(z.string())
          .describe("The main functional keywords for job titles."),
        minSalary: z
          .string()
          .describe(
            "Minimum salary converted to the simplest integer form (e.g., '100000')."
          ),
        minExperience: z
          .string()
          .describe("Minimum years of experience required."),
        sortBy: z
          .string()
          .describe("allowed values: created_at, company_name and salary_min."),
        sortOrder: z
          .string()
          .describe("Sorting direction, either 'asc' or 'desc'."),
        tab: z.string().describe("allowed values: saved, applied"),
      }),
      system: systemPrompt,
    });

    const { error } = await supabase
      .from("user_info")
      .update({
        ai_credits: userInfo.ai_credits - TAICredits.AI_SEARCH_OR_ASK_AI,
      })
      .eq("user_id", user.id);

    if (error) {
      throw error;
    }

    return NextResponse.json({ filters });
  } catch (error) {
    // console.error("Query parsing failed:", error);
    return NextResponse.json(
      {
        error: (error as Error).message || "Server error during AI processing",
      },
      { status: 500 }
    );
  }
}
