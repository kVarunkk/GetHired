import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AllJobWithRelations } from "@/utils/types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { JobRerankType, rerankJobsForUser } from "@/helpers/jobs/rerank-jobs";

export async function POST(request: NextRequest) {
  try {
    const internalSecret = request.headers.get("X-Internal-Secret");
    const isInternalCall = internalSecret === process.env.INTERNAL_API_SECRET;
    const supabase = isInternalCall
      ? createServiceRoleClient()
      : await createClient();

    const {
      userId,
      jobs,
      type,
    }: {
      userId: string;
      jobs: AllJobWithRelations[];
      type: JobRerankType;
    } = await request.json();

    if (!userId || !jobs) {
      return NextResponse.json(
        {
          message: "user_id and jobs are required in the request body.",
        },
        { status: 400 },
      );
    }

    const result = await rerankJobsForUser(supabase, { userId, jobs, type });

    if (!result) {
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({
      message: "An error occurred",
    });
  }
}
