"use server";

import { z } from "zod";
import { pauseAlertFromEmail } from "@/helpers/job-alerts/pause";

const inputSchema = z.object({ token: z.string().min(1).max(200) }).strict();

export type PauseJobAlertFromEmailResult = { ok: true } | { ok: false; error: string };

/** SERVER ACTION (JA-REQ-036), public: the pause page's button. The signed token is the only authority. */
export async function pauseJobAlertFromEmailAction(
  input: z.input<typeof inputSchema>,
): Promise<PauseJobAlertFromEmailResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This link isn't valid." };
  const result = await pauseAlertFromEmail(parsed.data.token, "page");
  return result.ok ? { ok: true } : { ok: false, error: "This link isn't valid." };
}
