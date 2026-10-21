import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import ErrorComponent from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import { AskAgentAboutOpportunities } from "@/components/agent/AskAgentOnApplicantPages";
import OutreachStatusBadge from "@/components/outreach/OutreachStatusBadge";
import { Badge } from "@/components/ui/badge";
import { isOpen, listMyOpportunities } from "@/helpers/outreach/list";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { simpleTimeAgo } from "@/utils/date";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Opportunities",
  description:
    "Companies that found your public profile and want to talk.",
  robots: { index: false, follow: false },
};

/** The candidate's outreach from companies (OR-REQ-003): open first, then answered. */
export default async function OpportunitiesPage() {
  try {
    const user = await getUserFromRequest();
    if (!user) notFound();
    const supabase = await createClient();
    const items = await listMyOpportunities(supabase, user.id);
    const now = Date.now();

    return (
      <div className="flex w-full flex-col gap-6 p-4 mb-20">
        <PageHeader
          title="Opportunities"
          description="Companies that found your public profile and want to talk. Your contact details stay hidden until you answer Interested."
        />
        <AskAgentAboutOpportunities />

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No messages yet. Keep your profile public and up to date so companies can find you.{" "}
            <Link href="/get-started" className="font-medium text-foreground underline underline-offset-4 hover:text-brand">
              Update your profile
            </Link>
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {items.map((o) => {
              const open = isOpen(o, now);
              return (
                <li key={o.id}>
                  <Link
                    href={`/opportunities/${o.id}`}
                    className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">{o.companyName ?? "A company"}</span>
                      <span className="truncate text-sm text-muted-foreground">
                        {o.jobTitle ? `${o.jobTitle} · ` : ""}
                        {o.subject}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
                      {open ? (
                        <Badge variant="brand">Waiting for you</Badge>
                      ) : (
                        <OutreachStatusBadge status={o.status === "sent" ? "expired" : o.status} />
                      )}
                      <span>{simpleTimeAgo("variant1", o.sentAt)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
