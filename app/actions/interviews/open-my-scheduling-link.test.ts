import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { openMySchedulingLink } from "@/helpers/interviews/my-scheduled-interviews";
import { openMySchedulingLinkAction } from "./open-my-scheduling-link";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/interviews/my-scheduled-interviews", () => ({ openMySchedulingLink: vi.fn() }));

const ID = "f1000000-0000-4000-8000-000000000001";

beforeEach(() => vi.clearAllMocks());

describe("openMySchedulingLinkAction (IVT-064)", () => {
  it("opens the session applicant's link", async () => {
    const db = createSupabaseMock();
    await setRequestUser(mockUser({ type: "applicant" }), db.client);
    vi.mocked(openMySchedulingLink).mockResolvedValue({ ok: true, path: "/schedule/abc" });
    expect(await openMySchedulingLinkAction({ interviewId: ID })).toEqual({ ok: true, path: "/schedule/abc" });
    expect(openMySchedulingLink).toHaveBeenCalledWith(db.client, ID);
  });

  it("refuses company accounts, signed-out visitors and bad ids", async () => {
    const db = createSupabaseMock();
    await setRequestUser(mockUser({ type: "company" }), db.client);
    expect((await openMySchedulingLinkAction({ interviewId: ID })).ok).toBe(false);
    await setRequestUser(null, db.client);
    expect((await openMySchedulingLinkAction({ interviewId: ID })).ok).toBe(false);
    await setRequestUser(mockUser({ type: "applicant" }), db.client);
    expect((await openMySchedulingLinkAction({ interviewId: "nope" })).ok).toBe(false);
    expect(openMySchedulingLink).not.toHaveBeenCalled();
  });
});
