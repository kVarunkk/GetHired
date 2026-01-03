import { NextResponse } from "next/server";
import { embed } from "ai";
import { getVertexClient } from "@/lib/serverUtils";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

export async function POST(request: Request) {
  const headersList = await headers();

  // --- 1. Security Check (CRITICAL) ---
  const cronSecret = headersList.get("X-Internal-Secret");
  if (cronSecret !== INTERNAL_API_SECRET) {
    return NextResponse.json(
      { message: "Unauthorized access to job embedding route" },
      { status: 401 }
    );
  }

  try {
    const jobData = await request.json();

    // 1. Validation
    if (!jobData || !jobData.id) {
      return NextResponse.json(
        { error: "User data or user_id is missing." },
        { status: 400 }
      );
    }

    // 2. Construct the text to embed
    // This replicates the logic from your Python backend to ensure the embedding represents the full profile
    const textToEmbed = `
    ROLE: ${jobData.job_name || "N/A"}

    LOCATION: ${Array.isArray(jobData.locations) ? jobData.locations.join(", ") : jobData.locations || ""}

    DETAILED DESCRIPTION: ${jobData.description || "N/A"}

    TYPE: ${jobData.job_type || "N/A"}
    
    COMPENSATION: ${jobData.salary_range || "N/A"}
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
    const supabase = createServiceRoleClient();
    const { error: updateError } = await supabase
      .from(jobData.table ?? "all_jobs")
      .update({
        embedding_new: embedding,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobData.id);

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
