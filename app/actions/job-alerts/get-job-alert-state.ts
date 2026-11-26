"use server";

import { z } from "zod";
import { loadJobAlertFeedState } from "@/helpers/job-alerts/page-state";
import { requireAlertSession } from "@/helpers/job-alerts/session";

const inputSchema = z.object({ search: z.string().max(2048) }).strict();

/** SERVER ACTION: the session applicant's alert state for a search, fresh from the database. Null when there is nothing to show. */
export async function getJobAlertStateAction(input: z.input<typeof inputSchema>) {
  const session = await requireAlertSession();
  if (!session.ok) return null;
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return null;

  const { ctx } = session;
  const searchParams = Object.fromEntries(new URLSearchParams(parsed.data.search));
  const state = await loadJobAlertFeedState({
    supabase: ctx.supabase,
    userId: ctx.userId,
    isCompany: false,
    searchParams,
  });
  return { alert: state.alert, activeCount: state.activeCount };
}
