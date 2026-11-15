import { notFound, unstable_rethrow } from "next/navigation";
import type { Metadata } from "next";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import MyCalendarSettings, { type CalendarConnectionView } from "@/components/calendar/MyCalendarSettings";
import { calendarEnabled } from "@/helpers/calendar/connect";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "My calendar",
};

type Props = { searchParams: Promise<{ calendar?: string; calendar_error?: string }> };

/**
 * Settings → My calendar (IVT-037): every member's own Google Calendar
 * connection and working hours. Reads only the member's own rows (RLS). Hidden
 * while CALENDAR_ENABLED is off.
 */
export default async function MyCalendarPage({ searchParams }: Props) {
  if (!calendarEnabled()) notFound();
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();

    const [{ data: connection, error }, { data: availability }, { data: info }, params] = await Promise.all([
      supabase
        .from("calendar_connections")
        .select("account_email, status, connected_at")
        .eq("user_id", user.id)
        .eq("provider", "google")
        .maybeSingle(),
      supabase
        .from("member_availability")
        .select("time_zone, working_hours")
        .eq("user_id", user.id)
        .eq("company_id", company.id)
        .maybeSingle(),
      supabase.from("company_info").select("time_zone").eq("id", company.id).maybeSingle(),
      searchParams,
    ]);
    if (error) throw error;

    const view: CalendarConnectionView | null = connection
      ? {
          accountEmail: connection.account_email,
          status: connection.status === "error" ? "error" : "active",
          connectedAt: connection.connected_at,
        }
      : null;

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title="My calendar"
          description="Connect your Google Calendar so interviews can be booked when you're free, with a Meet link."
        />
        <MyCalendarSettings
          connection={view}
          availability={availability}
          companyZone={info?.time_zone ?? null}
          notice={{ connected: params.calendar === "connected", error: params.calendar_error ?? null }}
        />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
