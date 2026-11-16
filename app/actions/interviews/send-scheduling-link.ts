"use server";

import { revalidatePath } from "next/cache";
import { applicationPath } from "@/helpers/applications/application-page";
import { calendarEnabled } from "@/helpers/calendar/connect";
import { schedulingMessage } from "@/helpers/calendar/copy";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  renewSchedulingLink,
  sendSchedulingLink,
  type RenewLinkResult,
  type SendLinkResult,
} from "@/helpers/interviews/scheduling-links";
import type { RenewLinkInput, SendLinkInput } from "@/helpers/interviews/scheduling-schema";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * SERVER ACTION (IVT-062, IV-REQ-020 "Send a link"): emails the candidate a
 * self-scheduling link for a new interview. `create_scheduling_link` checks
 * scheduling.manage for the job, the member's and the panel's connections,
 * and that the candidate can be emailed (D20).
 */
export async function sendSchedulingLinkAction(input: SendLinkInput): Promise<SendLinkResult> {
  if (!calendarEnabled()) return { ok: false, reason: "disabled", error: schedulingMessage("disabled") };
  const auth = await requireCompanyForAction({ permission: "scheduling.manage" });
  if (!auth.ok) return { ok: false, reason: "forbidden", error: auth.error };

  const result = await sendSchedulingLink(
    { supabase: auth.supabase, admin: createServiceRoleClient(), user: auth.user, company: auth.company },
    input,
  );
  if (result.ok) revalidatePath(applicationPath(result.applicationId), "layout");
  return result;
}

/**
 * SERVER ACTION (IVT-065): "Resend" (with `email`) or "Copy link" (without)
 * for an interview sent as a link. The new link replaces the old one.
 */
export async function renewSchedulingLinkAction(input: RenewLinkInput): Promise<RenewLinkResult> {
  if (!calendarEnabled()) return { ok: false, reason: "disabled", error: schedulingMessage("disabled") };
  const auth = await requireCompanyForAction({ permission: "scheduling.manage" });
  if (!auth.ok) return { ok: false, reason: "forbidden", error: auth.error };

  const result = await renewSchedulingLink(
    { supabase: auth.supabase, admin: createServiceRoleClient(), user: auth.user, company: auth.company },
    input,
  );
  if (result.ok) revalidatePath(applicationPath(result.applicationId), "layout");
  return result;
}
