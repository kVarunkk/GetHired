import { NextResponse } from "next/server";
import { generateText, Output } from "ai";
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
        error: "User not found.",
      },
      { status: 404 },
    );
  }

  if (userInfo.ai_credits < TAICredits.AI_SEARCH_OR_ASK_AI) {
    return NextResponse.json(
      { error: "Insufficient AI credits. Please top up to continue." },
      { status: 402 },
    );
  }

  const vertex = await getVertexClient();
  const model = vertex("gemini-2.5-flash-lite");

  const systemPrompt = `You are a sophisticated search filter parser. Your task is to extract job filtering criteria from the user's natural language query and convert them into a strict JSON object that adheres to the provided Zod schema. Output should only contain the defined keys.`;

  try {
    const { output: filters } = await generateText({
      model: model,
      prompt: userQuery,
      output: Output.object({
        schema: z.object({
          jobType: z
            .array(z.string())
            .describe(
              "List of job types (allowed values: 'Fulltime', 'Contract', 'Intern').",
            ),
          location: z
            .array(z.string())
            .describe(
              "List of general locations (e.g., 'Bangalore', 'Gurgaon', 'Remote').",
            ),
          visaRequirement: z
            .array(z.string())
            .describe(
              "List of visa requirement terms (allowed values: 'US Citizenship/Visa Not Required', 'US Citizen/Visa Only', 'Will Sponsor').",
            ),
          platform: z
            .array(z.string())
            .describe("List of job source platforms."),
          companyName: z
            .array(z.string())
            .describe("List of company names to filter by."),
          applicationStatus: z
            .array(z.string())
            .describe("List of application status terms."),
          jobTitleKeywords: z
            .array(z.string())
            .describe(
              "List of keywords for the job title. Provide multiple variations, abbreviations, or synonymous spellings to maximize recall. Examples: for 'frontend', include ['front end', 'front-end', 'frontend']; for 'backend', include ['back end', 'back-end', 'backend']; for 'SDE', include ['software engineer', 'SDE', 'software developer'].",
            ),
          minSalary: z
            .string()
            .describe(
              "Minimum salary converted to the simplest integer form (e.g., '100000').",
            ),
          minExperience: z
            .string()
            .describe("Minimum years of experience required."),
          sortBy: z
            .string()
            .describe(
              "allowed values: created_at, company_name and salary_min.",
            ),
          sortOrder: z
            .string()
            .describe("Sorting direction, either 'asc' or 'desc'."),
          tab: z.string().describe("allowed values: saved, applied"),
        }),
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
    return NextResponse.json(
      {
        error: (error as Error).message || "Server error during AI processing",
      },
      { status: 500 },
    );
  }
}
