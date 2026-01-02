import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { embed } from "ai";
import { getVertexClient } from "@/lib/serverUtils";

export async function POST(request: Request) {
  try {
    const companyData = await request.json();

    // 1. Validation
    if (!companyData || !companyData.id) {
      return NextResponse.json(
        { error: "User data or user_id is missing." },
        { status: 400 }
      );
    }

    // 2. Construct the text to embed
    // This replicates the logic from your Python backend to ensure the embedding represents the full profile
    const textToEmbed = `
     DESCRIPTION: ${companyData.description || "N/A"}

     HEADQUARTERS: ${companyData.headquarters || "N/A"}
     
     SIZE: ${companyData.size || "N/A"}
     
     INDUSTRY TYPE: ${companyData.industry || "N/A"}
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
    const supabase = await createClient();
    const { error: updateError } = await supabase
      .from("company_info")
      .update({
        embedding_new: embedding,
        updated_at: new Date().toISOString(),
      })
      .eq("id", companyData.id);

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
