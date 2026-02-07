import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ICompanyInfo, TAICredits } from "@/lib/types";
import { getVertexClient } from "@/lib/serverUtils";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { userId, companies } = await request.json();

    if (!userId || !companies) {
      return NextResponse.json(
        {
          error: "user_id and companies are required in the request body.",
        },
        { status: 400 },
      );
    }

    // Step 1: Fetch user preferences from the database
    const { data } = await supabase
      .from("user_info")
      .select(
        "desired_roles, experience_years, preferred_locations, min_salary, max_salary, top_skills, company_size_preference, career_goals_short_term, career_goals_long_term, visa_sponsorship_required, work_style_preferences, ai_credits, job_type, resumes(content, is_primary)",
      )
      .eq("user_id", userId)
      .eq("resumes.is_primary", true)
      .single();
    const userPreferences = data;

    if (!userPreferences) {
      return NextResponse.json(
        {
          error: "User not found.",
        },
        { status: 404 },
      );
    }

    if (userPreferences.ai_credits < TAICredits.AI_SEARCH_OR_ASK_AI) {
      return NextResponse.json(
        { error: "Insufficient AI credits. Please top up to continue." },
        { status: 402 },
      );
    }

    const { experience, skills, projects } = userPreferences.resumes?.[0]
      ?.content || {
      experience: "",
      skills: "",
      projects: "",
    };

    // Step 2: Construct the userQuery based on fetched preferences
    const userQuery = `
      User is a candidate with the following preferences:
      - Desired Roles: ${userPreferences.desired_roles?.join(", ")}
      - Work Experience: ${experience}
      - Skills: ${skills + userPreferences.top_skills?.join(", ")}
      - Projects: ${projects}
      - Years of Experience: ${userPreferences.experience_years} 
      - Preferred Locations: ${userPreferences.preferred_locations?.join(", ")}
      - Salary Range: $${userPreferences.min_salary} - $${
        userPreferences.max_salary
      }
      - Work Style: ${userPreferences.work_style_preferences?.join(", ")}
      - Job Type: ${userPreferences.job_type?.join(", ")}
      - Company Size: ${userPreferences.company_size_preference}
      - Career Goals: ${userPreferences.career_goals_short_term} and ${
        userPreferences.career_goals_long_term
      }
      - Visa Sponsorship: ${
        userPreferences.visa_sponsorship_required ? "Yes" : "No"
      }
      
      Please re-rank the companies to find the best possible match for this candidate.
    `;

    // Step 3: Call the AI with the augmented prompt
    const vertex = await getVertexClient();
    const model = vertex("gemini-2.5-flash-lite");

    const rerankPrompt = `
      You are an expert search re-ranker. Your task is to evaluate a set of companies
      against a user's query and re-rank them based on relevance, skills required,
      and experience level. You must only use the information provided for the companies.
      
      **User Query:**
      ${userQuery}

      **Companies to Evaluate:**
      ${companies
        .map(
          (company: ICompanyInfo) => `
        ---
        ID: ${company.id}
        Title: ${company.name}
        Description: ${company.description}
        Location: ${company.headquarters}
        Company Size: ${company.company_size}
        Industry: ${company.industry}
        ---
      `,
        )
        .join("\n")}
      
      **Instructions:**
      1.  Read the user's query carefully.
      2.  Analyze each company listing to determine its relevance to the query.
      3.  Re-rank the company IDs from most relevant to least relevant.
      4.  Filter out any companies that are completely irrelevant or do not match the user's core intent.
      5.  Output a JSON array of the re-ranked company IDs. Do not include any other text.
    `;

    const { output } = await generateText({
      model: model,
      prompt: rerankPrompt,
      output: Output.object({
        schema: z.object({
          reranked_company_ids: z
            .array(z.string())
            .describe(
              "The list of re-ranked company IDs from most to least relevant.",
            ),
          filtered_out_company_ids: z
            .array(z.string())
            .describe(
              "The list of company IDs that were filtered out as irrelevant.",
            ),
        }),
      }),
    });

    await supabase.rpc("deduct_user_credits", {
      p_user_id: userId,
      p_amount: TAICredits.AI_SEARCH_OR_ASK_AI,
    });

    return NextResponse.json({
      rerankedcompanies: output.reranked_company_ids,
      filteredOutcompanies: output.filtered_out_company_ids,
    });
  } catch {
    // console.error(e);
    return NextResponse.json(
      {
        error: "An error occurred",
      },
      { status: 500 },
    );
  }
}
