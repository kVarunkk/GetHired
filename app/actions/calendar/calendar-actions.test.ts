import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { memberWith, type MemberFixture } from "@/test/utils/team";
import { disconnectCalendar } from "@/helpers/calendar/disconnect";
import { DEFAULT_WORKING_HOURS } from "@/helpers/calendar/config";
import { saveMyAvailabilityAction } from "./save-availability";
import { disconnectCalendarAction } from "./disconnect";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({ service: true })) }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/calendar/disconnect", () => ({ disconnectCalendar: vi.fn() }));

// A member with no permissions: both actions are about their own calendar.
const member = memberWith([]);
let rls: SupabaseMock;

async function signIn(m: MemberFixture | null) {
  rls = createSupabaseMock({ user: m?.user });
  if (m) rls.queueRpc("my_company_access", { data: m.membership, error: null });
  await setRequestUser(m?.user ?? null, rls.client);
}

beforeEach(async () => {
  await signIn(member);
});

describe("saveMyAvailabilityAction (IVT-037)", () => {
  it("upserts the member's own row for their company", async () => {
    const result = await saveMyAvailabilityAction({ timeZone: "Europe/London", workingHours: DEFAULT_WORKING_HOURS });
    expect(result).toEqual({ ok: true });
    const [call] = rls.callsFor("member_availability");
    const upsert = call.chain.find((s) => s.method === "upsert")!;
    expect(upsert.args[0]).toMatchObject({
      user_id: member.user.id,
      company_id: COMPANY_A.id,
      time_zone: "Europe/London",
      working_hours: DEFAULT_WORKING_HOURS,
    });
    expect(upsert.args[1]).toEqual({ onConflict: "user_id,company_id" });
    expect(revalidatePath).toHaveBeenCalledWith("/company/settings/my-calendar");
  });

  it("refuses bad input before touching the database", async () => {
    const result = await saveMyAvailabilityAction({ timeZone: "UTC", workingHours: { mon: { start: "18:00", end: "09:00" } } });
    expect(result).toEqual({ ok: false, error: "End after the start." });
    expect(rls.callsFor("member_availability")).toEqual([]);
  });

  it("refuses signed-out callers", async () => {
    await signIn(null);
    expect((await saveMyAvailabilityAction({ timeZone: "UTC", workingHours: DEFAULT_WORKING_HOURS })).ok).toBe(false);
  });
});

describe("disconnectCalendarAction (IVT-036)", () => {
  it("disconnects the session member with the service role", async () => {
    vi.mocked(disconnectCalendar).mockResolvedValue({ ok: true, revoked: true });
    expect(await disconnectCalendarAction()).toEqual({ ok: true });
    expect(disconnectCalendar).toHaveBeenCalledWith({ service: true }, member.user.id);
  });

  it("says so when it fails", async () => {
    vi.mocked(disconnectCalendar).mockRejectedValue(new Error("db"));
    expect(await disconnectCalendarAction()).toEqual({ ok: false, error: "Couldn't disconnect your calendar. Please try again." });
  });

  it("refuses signed-out callers", async () => {
    await signIn(null);
    expect((await disconnectCalendarAction()).ok).toBe(false);
    expect(disconnectCalendar).not.toHaveBeenCalled();
  });
});
