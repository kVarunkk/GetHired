import "server-only";
import { render } from "react-email";
import type { ReactElement } from "react";
import { sendEmail } from "@/utils/email";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import UsageThresholdEmail, { type UsageThresholdEmailProps } from "@/emails/UsageThresholdEmail";
import PaymentFailedEmail, { type PaymentFailedEmailProps } from "@/emails/PaymentFailedEmail";
import PlanChangedEmail, { type PlanChangedEmailProps } from "@/emails/PlanChangedEmail";
import CreditsExpiringEmail, { type CreditsExpiringEmailProps } from "@/emails/CreditsExpiringEmail";

export type BillingContacts = { companyName: string; emails: string[] };

/**
 * Who gets billing emails (BL-REQ-022): the company's contact address and its
 * owner. The teams spec adds admins.
 */
export async function billingContactsFor(companyId: string): Promise<BillingContacts> {
  const supabase = createServiceRoleClient();
  const { data: company, error } = await supabase
    .from("company_info")
    .select("name, email, user_id")
    .eq("id", companyId)
    .maybeSingle();
  if (error || !company) throw new Error(`No company ${companyId}`);

  const emails = new Set<string>();
  if (company.email) emails.add(company.email.toLowerCase());
  if (company.user_id) {
    const { data } = await supabase.auth.admin.getUserById(company.user_id);
    if (data?.user?.email) emails.add(data.user.email.toLowerCase());
  }
  return { companyName: company.name ?? "there", emails: [...emails] };
}

async function sendTo(emails: string[], subject: string, element: ReactElement) {
  const htmlContent = await render(element);
  const textContent = await render(element, { plainText: true });
  for (const toEmail of emails) {
    await sendEmail({ toEmail, subject, htmlContent, textContent });
  }
}

export async function sendUsageThresholdEmail(emails: string[], props: UsageThresholdEmailProps) {
  await sendTo(
    emails,
    props.threshold >= 100
      ? `You've used all your ${props.label} this month`
      : `You've used ${props.threshold}% of your ${props.label}`,
    <UsageThresholdEmail {...props} />,
  );
}

export async function sendPaymentFailedEmail(emails: string[], props: PaymentFailedEmailProps) {
  await sendTo(emails, `Action needed: payment failed for your ${props.planName} plan`, <PaymentFailedEmail {...props} />);
}

export async function sendPlanChangedEmail(emails: string[], props: PlanChangedEmailProps) {
  await sendTo(
    emails,
    props.scheduled ? `Your plan changes to ${props.toPlan}` : `You're now on ${props.toPlan}`,
    <PlanChangedEmail {...props} />,
  );
}

export async function sendCreditsExpiringEmail(emails: string[], props: CreditsExpiringEmailProps) {
  await sendTo(emails, `${props.credits} credits expire soon`, <CreditsExpiringEmail {...props} />);
}
