import { NextResponse } from "next/server";
import { SupabaseClient, User } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { Database } from "@/utils/types/database.types";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { getMyCompany, type MyCompany } from "@/helpers/companies/get-my-company";
import type { AgentRoleId } from "./roles/types";

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

export type { AgentRoleId };

export type AgentUserAuth =
  | {
      ok: true;
      user: User;
      supabase: SupabaseClient<Database>;
      role: AgentRoleId;
      /** The company a company user acts for, from the session (RA-SEC-002). */
      company: MyCompany | null;
    }
  | { ok: false; response: NextResponse };

const forbidden = (error: string) =>
  ({ ok: false, response: NextResponse.json({ error }, { status: 403 }) }) as const;

/**
 * Authenticates an /api/agent/* request for either role (RA-SEC-001): 401
 * without a user; 403 for users without a role, and for company users who
 * haven't finished onboarding or have no company yet. The role comes from
 * `app_metadata` on the server, never from the request.
 */
export async function requireAgentUser(): Promise<AgentUserAuth> {
  const user = await getUserFromRequest();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const type = user.app_metadata?.type;
  if (type === "applicant") {
    return { ok: true, user, supabase: await createClient(), role: "applicant", company: null };
  }
  if (type !== "company") return forbidden("The agent isn't available for this account.");

  const supabase = await createClient();
  const company =
    user.app_metadata?.onboarding_complete === true ? await getMyCompany(supabase, user) : null;
  if (!company) return forbidden("Finish setting up your company first.");

  return { ok: true, user, supabase, role: "company", company };
}
