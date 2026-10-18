import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendCompanyMessage } from "@/helpers/email/send-company-message";
import { KNOCKOUT_ACTOR_NAME } from "@/helpers/applications/knockout-reject";
import { firstName } from "@/helpers/outreach/linkify";
import { renderTemplate } from "@/helpers/pipeline/templates";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

/** Due emails handled per run. */
const KNOCKOUT_WORKER_BATCH = 25;

type Outcome = "sent" | "cancelled" | "failed";

/**
 * AF-DEC-002: sends the rejection email for applications a knockout rule
 * moved to Rejected, once their 24-hour delay is up. Called by the scheduler
 * with X-Internal-Secret. An application moved out of Rejected in the
 * meantime, or a company without a rejection template, gets no email.
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceRoleClient();
  const now = new Date().toISOString();
  const { data: due, error } = await service
    .from("application_knockouts")
    .select("application_id, company_id")
    .lte("reject_email_due_at", now)
    .is("reject_email_sent_at", null)
    .order("reject_email_due_at", { ascending: true })
    .limit(KNOCKOUT_WORKER_BATCH);
  if (error) {
    console.error("[knockouts] couldn't read due emails", error.message);
    return NextResponse.json({ message: "Couldn't read due emails." }, { status: 500 });
  }

  const cancel = (applicationId: string) =>
    service.from("application_knockouts").update({ reject_email_due_at: null }).eq("application_id", applicationId);

  const counts: Record<Outcome, number> = { sent: 0, cancelled: 0, failed: 0 };
  for (const row of due ?? []) {
    const outcome = await (async (): Promise<Outcome> => {
      const { data: application } = await service
        .from("applications")
        .select("id, applicant_user_id, pipeline_stages(kind), user_info(email, full_name), job_postings(title)")
        .eq("id", row.application_id)
        .maybeSingle();
      const email = application?.user_info?.email;
      if (!application || application.pipeline_stages?.kind !== "rejected" || !email) {
        await cancel(row.application_id);
        return "cancelled";
      }

      const [{ data: template }, { data: company }] = await Promise.all([
        service
          .from("company_email_templates")
          .select("id, subject, body_md")
          .eq("company_id", row.company_id)
          .eq("purpose", "rejection")
          .order("is_default", { ascending: false })
          .limit(1)
          .maybeSingle(),
        service.from("company_info").select("name, email, logo_url, scheduling_url").eq("id", row.company_id).maybeSingle(),
      ]);
      if (!template || !company) {
        await cancel(row.application_id);
        return "cancelled";
      }

      const rendered = renderTemplate(template, {
        candidate_first_name: firstName(application.user_info?.full_name ?? null),
        job_title: application.job_postings?.title ?? null,
        company_name: company.name ?? "the company",
        scheduling_link: company.scheduling_url,
        sender_name: company.name ?? null,
      });
      if (!rendered.ok || rendered.unknownVariables.length > 0 || rendered.missingVariables.length > 0) {
        await cancel(row.application_id);
        return "cancelled";
      }

      const result = await sendCompanyMessage({
        toEmail: email,
        subject: rendered.subject,
        bodyMd: rendered.body,
        companyName: company.name ?? "the company",
        companyEmail: company.email,
        logoUrl: company.logo_url,
      });
      if (!result.ok) return "failed"; // retried on the next run

      await service
        .from("application_knockouts")
        .update({ reject_email_sent_at: new Date().toISOString() })
        .eq("application_id", row.application_id);
      await service.from("application_events").insert({
        company_id: row.company_id,
        application_id: row.application_id,
        candidate_user_id: application.applicant_user_id,
        actor_user_id: null,
        actor_name: KNOCKOUT_ACTOR_NAME,
        type: "email_sent",
        payload: { template_id: template.id, subject: rendered.subject },
      });
      return "sent";
    })().catch((err) => {
      console.error("[knockouts] failed for", row.application_id, err);
      return "failed" as const;
    });
    counts[outcome] += 1;
  }

  return NextResponse.json(counts);
}
