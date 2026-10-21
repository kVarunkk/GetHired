import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import NotificationSettings from "@/components/pipeline/NotificationSettings";
import SettingsCard from "@/components/pipeline/SettingsCard";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notification Settings",
};

/**
 * Settings → Notifications (PL-TASK-040): the new-applicant and weekly-match
 * emails, linked from both. Read-only without settings.notifications
 * (RP-REQ-016); the action checks again.
 */
export default async function NotificationsSettingsPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();

    const { data, error } = await supabase
      .from("company_info")
      .select("notify_new_applicants, notify_weekly_matches")
      .eq("id", company.id)
      .single();
    if (error) throw error;

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader title="Notifications" description="Emails about new applicants and new matched candidates." />
        <SettingsCard company={company} permission="settings.notifications">
          <NotificationSettings
            initial={{
              notifyNewApplicants: data.notify_new_applicants as "off" | "instant" | "daily",
              notifyWeeklyMatches: data.notify_weekly_matches,
            }}
          />
        </SettingsCard>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
