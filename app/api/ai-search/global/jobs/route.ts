import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PostHogEvent } from "@/utils/types";
import { validateAndSanitizeSearchQuery } from "@/helpers/ai/security";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { parseJobQuery } from "@/helpers/jobs/parse-job-query";

export async function POST(req: Request) {
  const { userQuery: rawQuery } = await req.json();

  const validation = validateAndSanitizeSearchQuery(rawQuery, 300);

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error },
      { status: validation.status || 400 },
    );
  }

  const userQuery = validation.data!;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await parseJobQuery(supabase, user.id, userQuery);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    after(async () => {
      try {
        await eventCaptureServer({
          event: PostHogEvent.AiGlobalSearchUsed,
          distinctId: user.id,
          properties: {
            query: userQuery,
          },
        });
      } catch {}
    });

    return NextResponse.json({ filters: result.filters });
  } catch (error) {
    return NextResponse.json(
      {
        error: (error as Error).message || "Server error during AI processing",
      },
      { status: 500 },
    );
  }
}
