"use server";

import { z } from "zod";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { WEEKLY_GOAL_MAX, WEEKLY_GOAL_MIN } from "@/helpers/dashboard/weekly-goal";

const inputSchema = z
  .object({ goal: z.number().int().min(WEEKLY_GOAL_MIN).max(WEEKLY_GOAL_MAX).nullable() })
  .strict();

export type SetWeeklyApplicationGoalResult = { ok: true } | { ok: false; error: string };

/** SERVER ACTION: sets (or, with null, clears) the session user's weekly application goal. */
export async function setWeeklyApplicationGoalAction(
  input: z.input<typeof inputSchema>,
): Promise<SetWeeklyApplicationGoalResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Pick a number from ${WEEKLY_GOAL_MIN} to ${WEEKLY_GOAL_MAX}.` };

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_info")
    .update({ weekly_application_goal: parsed.data.goal })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Couldn't save your goal. Please try again." };

  return { ok: true };
}
