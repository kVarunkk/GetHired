import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  parseJobSearchParams,
  searchJobs,
  SearchJobsTrace,
} from "@/helpers/jobs/search-jobs";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";

export async function GET(request: NextRequest) {
  const internalSecret = request.headers.get("X-Internal-Secret");
  const isInternalCall = internalSecret === process.env.INTERNAL_API_SECRET;

  const params = parseJobSearchParams(request.nextUrl.searchParams, {
    isInternalCall,
  });

  const trace: SearchJobsTrace = {
    stage: "initialize",
    distinctId: params.applicantUserId || "unknown",
  };

  try {
    const supabase = isInternalCall
      ? createServiceRoleClient()
      : await createClient();

    const result = await searchJobs(supabase, params, trace);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({
      data: result.data,
      totalCount: result.totalCount,
      nextCursor: result.nextCursor,
    });
  } catch (err: unknown) {
    const errorRecord =
      typeof err === "object" && err !== null
        ? (err as Record<string, unknown>)
        : null;
    const errorMessage =
      err instanceof Error
        ? err.message
        : typeof errorRecord?.message === "string"
          ? errorRecord.message
          : String(err) || "An unexpected error occurred";
    const errorForPostHog =
      err instanceof Error ? err : new Error(errorMessage);

    console.error(`[JOBS API] Failed during ${trace.stage}:`, err);
    await eventCaptureServerException({
      error: errorForPostHog,
      distinctId: trace.distinctId,
      properties: {
        flow: "jobs_api",
        failure_stage: trace.stage,
        error_message: errorMessage,
        error_name:
          err instanceof Error
            ? err.name
            : typeof errorRecord?.name === "string"
              ? errorRecord.name
              : undefined,
        error_code: errorRecord?.code,
        error_details: errorRecord?.details,
        error_hint: errorRecord?.hint,
        request_path: request.nextUrl.pathname,
        sort_by: params.sortBy,
        created_after_days: params.createdAfterDays,
        internal_call: isInternalCall,
      },
    });
    return NextResponse.json(
      {
        error: errorMessage,
      },
      { status: 500 },
    );
  }
}
