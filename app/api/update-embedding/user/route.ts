import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const FASTAPI_URL = process.env.FASTAPI_USER_EMBEDDING_URL;
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY;

if (!FASTAPI_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing environment variables for API call.");
}

export async function POST(request: Request) {
  try {
    const userData = await request.json();

    // Check for a user_id in the payload
    if (!userData || !userData.user_id) {
      return NextResponse.json(
        { error: "User data or user_id is missing." },
        { status: 400 }
      );
    }

    const response = await fetch(FASTAPI_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(userData),
    });

    if (!response.ok) {
      console.log(response);
      // const errorData = await response.json();
      // console.error("FastAPI embedding error:", errorData);
      return NextResponse.json(
        { error: "Failed to create embedding." },
        { status: response.status }
      );
    }

    const result = await response.json();
    const newEmbedding = result.embedding; // Get the embedding from the FastAPI response

    // Now, update the user_info table with the new embedding
    const supabase = await createClient();
    const { error: updateError } = await supabase
      .from("user_info")
      .update({ embedding: newEmbedding })
      .eq("user_id", userData.user_id);

    if (updateError) {
      // console.error("Supabase update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update user embedding in Supabase." },
        { status: 500 }
      );
    }

    // console.log(
    //   "Successfully created and updated embedding for user:",
    //   userData.user_id
    // );
    return NextResponse.json({
      message: "Embedding successfully created and updated.",
      data: result,
    });
  } catch {
    // console.error("Error in route handler:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
