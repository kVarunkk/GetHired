import { NextResponse } from "next/server";
import { SupabaseClient, User } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { Database } from "@/utils/types/database.types";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";

/** Reports an unexpected error and returns a generic 500 (SEC-006). */
export async function internalError(error: unknown, userId: string, flow: string) {
  await eventCaptureServerException({
    error,
    distinctId: userId,
    properties: { flow },
  });
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 },
  );
}

/** Reads a JSON body, treating a missing or invalid body as `{}`. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export type ApplicantAuth =
  | { ok: true; user: User; supabase: SupabaseClient<Database> }
  | { ok: false; response: NextResponse };

/**
 * Authenticates an /api/agent/* request: 401 without a user, 403 for anyone
 * who isn't an applicant (SEC-001). Returns the RLS-scoped client (SEC-003).
 */
export async function requireApplicant(): Promise<ApplicantAuth> {
  const user = await getUserFromRequest();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (user.app_metadata?.type !== "applicant") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "The agent is only available to job seekers." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, user, supabase: await createClient() };
}
