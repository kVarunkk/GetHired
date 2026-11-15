import type { Metadata } from "next";
import SelfSchedule from "@/components/interviews/self-schedule/SelfSchedule";
import { calendarProvider } from "@/helpers/calendar/active-provider";
import { calendarEnabled } from "@/helpers/calendar/connect";
import { linkSlots, resolveLink } from "@/helpers/interviews/self-scheduling";
import { selfSchedulingMessage } from "@/helpers/interviews/self-scheduling-copy";
import { createPublicClient } from "@/lib/supabase/public";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata: Metadata = {
  title: "Pick your interview time",
  robots: { index: false, follow: false },
};

// Every view reads the link and its slots fresh (the slots have their own 2-minute cache).
export const dynamic = "force-dynamic";

/**
 * IVT-063 (IV-REQ-021/022, IV-SEC-003), public: a candidate's
 * self-scheduling link. The page's view of the interview comes from the anon
 * RPC resolve_scheduling_token; the slots are computed on the server with
 * the service role. No interviewer addresses, other candidates or company
 * internals reach the page.
 */
export default async function SchedulePage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const link = calendarEnabled() ? await resolveLink(createPublicClient(), token) : null;

  if (!link) {
    return (
      <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col justify-center gap-4 px-4 py-16">
        <h1 className="text-2xl font-semibold">This link isn&apos;t open</h1>
        <p className="text-sm text-muted-foreground">{selfSchedulingMessage("not_found")}</p>
      </main>
    );
  }

  const wantsSlots = link.status === "awaiting_candidate" || link.can_change;
  const slots = wantsSlots
    ? ((await linkSlots({ admin: createServiceRoleClient(), provider: calendarProvider() }, token)) ?? [])
    : [];

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <SelfSchedule token={token} link={link} slots={slots} />
    </main>
  );
}
