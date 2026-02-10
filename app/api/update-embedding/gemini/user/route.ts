import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { embed } from "ai";
import { getVertexClient } from "@/lib/serverUtils";
// import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function POST(request: Request) {
  try {
    const userData = await request.json();

    // 1. Validation
    if (!userData || !userData.user_id) {
      return NextResponse.json(
        { error: "User data or user_id is missing." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { data: resumeData, error: resumeError } = await supabase
      .from("resumes")
      .select("content")
      .eq("user_id", userData.user_id)
      .eq("is_primary", true)
      .maybeSingle();

    if (resumeError) {
      console.error("Error fetching primary resume:", resumeError);
    }

    // Helper to extract text from the Digital Twin JSON structure
    const extractSectionText = (type: string) => {
      const content = resumeData?.content;
      if (!content || !content.sections) return "N/A";

      return content.sections
        .filter(
          (s: {
            type?: string;
            items?: {
              bullets?: {
                id?: string;
                text?: string;
                lineIndices?: string[];
              }[];
              heading?: string;
              subheading?: string;
            }[];
          }) => s.type === type
        )
        .flatMap(
          (s: {
            type?: string;
            items?: {
              bullets?: {
                id?: string;
                text?: string;
                lineIndices?: string[];
              }[];
              heading?: string;
              subheading?: string;
            }[];
          }) => s.items
        )
        .flatMap(
          (i: {
            bullets?: {
              id?: string;
              text?: string;
              lineIndices?: string[];
            }[];
            heading?: string;
            subheading?: string;
          }) => i?.bullets?.map((b) => b.text)
        )
        .join(". ");
    };

    // Extract dynamic content from the parsed resume
    const resumeExperience = extractSectionText("experience");
    const resumeProjects = extractSectionText("projects");
    const resumeSkills = extractSectionText("skills");

    // 3. Prepare the Profile Data
    const topSkillsStr = Array.isArray(userData.top_skills)
      ? userData.top_skills.join(", ")
      : "";

    // Combine profile skills with extracted resume skills
    const combinedSkills = [topSkillsStr, resumeSkills]
      .filter(Boolean)
      .join(", ");

    // 2. Construct the text to embed
    // This replicates the logic from your Python backend to ensure the embedding represents the full profile
    const textToEmbed = `
      PREFERRED ROLES: ${Array.isArray(userData.desired_roles) ? userData.desired_roles.join(", ") : userData.desired_roles || ""}

      PREFERRED LOCATIONS: ${Array.isArray(userData.preferred_locations) ? userData.preferred_locations.join(", ") : userData.preferred_locations || ""}
      
      PREFERRED SALARY: ${userData.min_salary || "N/A"} - ${userData.max_salary || "N/A"}
      
      EXPERIENCE YEARS: ${userData.experience_years || "N/A"} years
      
      SKILLS: ${combinedSkills}
      
      EXPERIENCE: ${resumeExperience || "N/A"}
      
      PROJECTS: ${resumeProjects || "N/A"}
      
      WORK STYLE: ${Array.isArray(userData.work_style_preferences) ? userData.work_style_preferences.join(", ") : ""}
      
      VISA SPONSORSHIP REQUIRED: ${userData.visa_sponsorship_required}
      
      CAREER GOALS LONG TERM: ${userData.career_goals_long_term}
      
      CAREER GOALS SHORT TERM: ${userData.career_goals_short_term}
      
      DESIRED JOB TYPE: ${Array.isArray(userData.job_type) ? userData.job_type.join(", ") : userData.job_type || ""}
      
      PREFERRED INDUSTRY:${Array.isArray(userData.industry_preferences) ? userData.industry_preferences.join(", ") : userData.industry_preferences || ""}
    `.trim();

    const vertex = await getVertexClient();
    // 3. Generate Embedding using Vertex AI
    const { embedding } = await embed({
      model: vertex.embeddingModel("gemini-embedding-001"),
      value: textToEmbed,
      providerOptions: {
        google: {
          outputDimensionality: 768,
        },
      },
    });

    // 4. Update Supabase
    const { error: updateError } = await supabase
      .from("user_info")
      .update({
        embedding_new: embedding,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userData.user_id);

    if (updateError) {
      console.error("Supabase update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update user embedding in Supabase." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "Embedding successfully created and updated via Vertex AI.",
      // data: { embedding } // Optional: return if needed
    });
  } catch (error) {
    console.error("Error in embedding route:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
