import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-api-key") !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabaseAdmin = createServiceRoleClient();
  const body = await req.json();

  const { jobs } = body;

  if (!Array.isArray(jobs)) {
    return NextResponse.json(
      { error: "jobs must be an array" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("all_jobs")
    .upsert(jobs, {
      onConflict: "id",
    })
    .select();

  if (error) {
    console.error("Error upserting jobs:", error);
    return NextResponse.json(
      { error },
      {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, x-api-key",
          "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
        },
      },
    );
  }

  return NextResponse.json(data, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    },
  });
}

// export async function OPTIONS() {
//   return new NextResponse(null, {
//     status: 200,
//     headers: {
//       "Access-Control-Allow-Origin": "*",
//       "Access-Control-Allow-Headers": "Content-Type, x-api-key",
//       "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
//     },
//   });
// }
