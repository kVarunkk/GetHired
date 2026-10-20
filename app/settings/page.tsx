import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { ArrowRight } from "lucide-react";
import ErrorComponent from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import { AskAgentAboutSettings } from "@/components/agent/AskAgentOnApplicantPages";
import { Button } from "@/components/ui/button";
import PrivacySettings from "@/components/settings/PrivacySettings";
import EmailPreferences from "@/components/settings/EmailPreferences";
import { createClient } from "@/lib/supabase/server";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border p-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * The applicant's settings in one place: profile visibility, outreach and
 * blocked companies, and email subscriptions. The profile itself (roles,
 * skills, resume) is edited at /get-started.
 */
export default async function SettingsPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();

    const [infoResult, blocksResult] = await Promise.all([
      supabase
        .from("user_info")
        .select(
          "is_public, accepts_outreach, is_job_digest_active, is_promotion_active",
        )
        .eq("user_id", user.id)
        .single(),
      supabase
        .from("candidate_company_blocks")
        .select("company_id, company_info(name)")
        .eq("candidate_user_id", user.id)
        .order("created_at", { ascending: false }),
    ]);
    if (infoResult.error) throw infoResult.error;
    const info = infoResult.data;

    // The block list is an extra: a failure hides it, not the page.
    const blockedCompanies = (blocksResult.data ?? []).map((block) => ({
      id: block.company_id,
      name: block.company_info?.name ?? null,
    }));

    return (
      <div className="mb-20 flex w-full flex-col gap-6 p-4">
        <PageHeader
          title="Settings"
          description="Your privacy, email preferences and profile."
        />
        <div className="flex w-full max-w-3xl flex-col gap-6">
          <AskAgentAboutSettings />
          <Section
            title="Privacy"
            description="Who can find your profile and contact you."
          >
            <PrivacySettings
              initialIsPublic={info.is_public}
              initialAcceptsOutreach={info.accepts_outreach}
              initialBlocked={blockedCompanies}
            />
          </Section>

          <Section title="Emails" description="What we send to your inbox.">
            <EmailPreferences
              initialJobDigest={info.is_job_digest_active ?? false}
              initialPromotions={info.is_promotion_active ?? false}
            />
          </Section>

          <Section
            title="Profile"
            description="Your desired roles, skills, salary and resume, used for job matches."
          >
            <Button asChild variant="outline" className="w-fit">
              <Link href="/get-started">
                Edit profile
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </Section>
        </div>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
