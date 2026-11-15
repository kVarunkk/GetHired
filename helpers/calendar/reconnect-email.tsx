import "server-only";
import { render } from "react-email";
import CalendarReconnectEmail from "@/emails/CalendarReconnectEmail";
import { reportError } from "@/helpers/posthog/report-error";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import { MY_CALENDAR_PATH } from "./config";

/**
 * §4 Failures: tells a member their calendar connection broke. The caller
 * makes sure it's sent once per error (`reconnect_emailed_at`). Failures are
 * reported, never thrown.
 */
export async function sendCalendarReconnectEmail(userId: string): Promise<void> {
  try {
    const { data } = await createServiceRoleClient().auth.admin.getUserById(userId);
    const toEmail = data?.user?.email;
    if (!toEmail) return;
    const message = <CalendarReconnectEmail url={`${deploymentUrl()}${MY_CALENDAR_PATH}`} />;
    const [htmlContent, textContent] = await Promise.all([render(message), render(message, { plainText: true })]);
    await sendEmail({ toEmail, subject: "Reconnect your Google Calendar to GetHired", htmlContent, textContent });
  } catch (err) {
    reportError("[calendar] reconnect email failed", userId, err instanceof Error ? err.name : "error");
  }
}
