import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { APPLICATION_ID } from "@/test/utils/interviews";
import { ADMIN_A, OWNER_A, memberWith, type MemberFixture } from "@/test/utils/team";
import {
  bookInterview,
  findInterviewSlots,
  syncCancelledInterview,
  syncUpdatedInterview,
} from "@/helpers/interviews/scheduling";
import { findInterviewSlotsAction } from "./find-slots";
import { bookInterviewAction } from "./book-interview";
import { updateInterviewAction } from "./update-interview";
import { cancelInterviewAction } from "./cancel-interview";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({ service: true })) }));
vi.mock("@/helpers/calendar/active-provider", () => ({ calendarProvider: vi.fn(() => ({ provider: true })) }));
vi.mock("@/helpers/interviews/scheduling", () => ({
  findInterviewSlots: vi.fn(),
  bookInterview: vi.fn(),
  syncUpdatedInterview: vi.fn(),
  syncCancelledInterview: vi.fn(),
}));

const JOB = "b0000000-0000-4000-8000-0000000000a1";
const INTERVIEW = "1e000000-0000-4000-8000-0000000000aa";
const START = "2026-12-01T10:00:00.000Z";
const OK = { ok: true, application_id: APPLICATION_ID, status: "scheduled" };
const LAYOUT = [`/company/applications/${APPLICATION_ID}`, "layout"];

let rls: SupabaseMock;

async function signIn(member: MemberFixture | null) {
  rls = createSupabaseMock({ user: member?.user });
  if (member) rls.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member?.user ?? null, rls.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("CALENDAR_ENABLED", "true");
  await signIn(ADMIN_A);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const book = { applicationId: APPLICATION_ID, name: "Chat", durationMinutes: 30, panel: [OWNER_A.user.id], startsAt: START };

describe("findInterviewSlotsAction (IVT-042)", () => {
  it("runs the search as the session member with the provider and the service client", async () => {
    vi.mocked(findInterviewSlots).mockResolvedValue({ ok: true, slots: [], members: [] });
    const input = { jobPostId: JOB, panel: [OWNER_A.user.id], durationMinutes: 30 };
    expect(await findInterviewSlotsAction(input)).toEqual({ ok: true, slots: [], members: [] });
    expect(findInterviewSlots).toHaveBeenCalledWith(
      { supabase: rls.client, admin: { service: true }, provider: { provider: true }, userId: ADMIN_A.user.id },
      input,
    );
  });

  it("is off while CALENDAR_ENABLED is", async () => {
    vi.stubEnv("CALENDAR_ENABLED", "");
    const result = await findInterviewSlotsAction({ jobPostId: JOB, panel: [OWNER_A.user.id], durationMinutes: 30 });
    expect(result).toMatchObject({ ok: false, reason: "disabled" });
    expect(findInterviewSlots).not.toHaveBeenCalled();
  });

  it("needs scheduling.manage", async () => {
    await signIn(memberWith(["scheduling.view"]));
    const result = await findInterviewSlotsAction({ jobPostId: JOB, panel: [OWNER_A.user.id], durationMinutes: 30 });
    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
    expect(findInterviewSlots).not.toHaveBeenCalled();
  });
});

describe("bookInterviewAction (IVT-043)", () => {
  it("books and revalidates the application", async () => {
    vi.mocked(bookInterview).mockResolvedValue({
      ok: true,
      id: INTERVIEW,
      applicationId: APPLICATION_ID,
      candidateInvited: true,
      meetingUrl: "https://meet.google.com/abc",
    });
    expect((await bookInterviewAction(book)).ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(...LAYOUT);
  });

  it("doesn't revalidate a refusal", async () => {
    vi.mocked(bookInterview).mockResolvedValue({ ok: false, reason: "not_connected", error: "x" });
    expect(await bookInterviewAction(book)).toMatchObject({ ok: false, reason: "not_connected" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("is off while CALENDAR_ENABLED is, and refuses applicants", async () => {
    vi.stubEnv("CALENDAR_ENABLED", "");
    expect(await bookInterviewAction(book)).toMatchObject({ ok: false, reason: "disabled" });
    vi.stubEnv("CALENDAR_ENABLED", "true");
    await signIn(null);
    expect(await bookInterviewAction(book)).toMatchObject({ ok: false, reason: "forbidden" });
    expect(bookInterview).not.toHaveBeenCalled();
  });
});

describe("calendar follow-up on reschedule and cancel (IVT-044)", () => {
  it("syncs what changed after the reschedule applied, and passes the warning on", async () => {
    rls.queueRpc("update_interview", { data: OK, error: null });
    vi.mocked(syncUpdatedInterview).mockResolvedValue({ calendarWarning: "careful" });
    const result = await updateInterviewAction({ interviewId: INTERVIEW, startsAt: START });
    expect(result).toMatchObject({ ok: true, applicationId: APPLICATION_ID, calendarWarning: "careful" });
    expect(vi.mocked(syncUpdatedInterview).mock.calls[0].slice(1)).toEqual([INTERVIEW, { time: true, panel: false }]);
  });

  it("deletes the event after the cancel applied", async () => {
    rls.queueRpc("cancel_interview", { data: { ...OK, status: "cancelled" }, error: null });
    vi.mocked(syncCancelledInterview).mockResolvedValue({});
    expect((await cancelInterviewAction({ interviewId: INTERVIEW })).ok).toBe(true);
    expect(vi.mocked(syncCancelledInterview).mock.calls[0][1]).toBe(INTERVIEW);
  });

  it("leaves Google alone when the change was refused or the calendar is off", async () => {
    rls.queueRpc("cancel_interview", { data: { ok: false, reason: "invalid_status" }, error: null });
    expect((await cancelInterviewAction({ interviewId: INTERVIEW })).ok).toBe(false);

    vi.stubEnv("CALENDAR_ENABLED", "");
    await signIn(ADMIN_A);
    rls.queueRpc("update_interview", { data: OK, error: null });
    expect((await updateInterviewAction({ interviewId: INTERVIEW, panel: [OWNER_A.user.id] })).ok).toBe(true);
    expect(syncCancelledInterview).not.toHaveBeenCalled();
    expect(syncUpdatedInterview).not.toHaveBeenCalled();
  });
});
