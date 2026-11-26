"use server";

import { listJobAlerts } from "@/helpers/job-alerts/writes";
import { requireAlertSession } from "@/helpers/job-alerts/session";

/** SERVER ACTION: the session applicant's alerts, fresh from the database. Null when they can't be read. */
export async function listJobAlertsAction() {
  const session = await requireAlertSession();
  if (!session.ok) return null;
  return listJobAlerts({ userId: session.ctx.userId, supabase: session.ctx.supabase }).catch(() => null);
}
