import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { memberWith, type MemberFixture } from "@/test/utils/team";
import { GET } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

import { createServiceRoleClient } from "@/lib/supabase/service-role";

const INTERVIEW = "1e000000-0000-4000-8000-0000000000aa";
const storage = { createSignedUrl: vi.fn() };
const from = vi.fn(() => storage);

let rls: SupabaseMock;
let admin: SupabaseMock;

async function signIn(member: MemberFixture | null, user = member?.user) {
  rls = createSupabaseMock({ user });
  if (member) rls.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(user ?? null, rls.client);
}

const call = (id = INTERVIEW) =>
  GET(buildRequest(`/api/interviews/${id}/resume`), { params: Promise.resolve({ interview_id: id }) });

beforeEach(async () => {
  vi.clearAllMocks();
  admin = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue({ ...admin.client, storage: { from } } as never);
  storage.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://storage.test/signed" }, error: null });
  // A panel member with no permissions: kit access is the RPC's call.
  await signIn(memberWith([]));
});

describe("GET /api/interviews/[id]/resume (IVT-019)", () => {
  it("redirects a panel member to a 5-minute signed URL for the file", async () => {
    rls.queueRpc("can_open_interview_kit", { data: true, error: null });
    admin.queueRpc("interview_resume_source", { data: { linked_resume_path: "u1/cv.pdf" }, error: null });

    const res = await call();

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://storage.test/signed");
    expect(from).toHaveBeenCalledWith("resumes");
    expect(storage.createSignedUrl).toHaveBeenCalledWith("u1/cv.pdf", 300);
  });

  it("signs an imported candidate's file from the candidate bucket", async () => {
    rls.queueRpc("can_open_interview_kit", { data: true, error: null });
    admin.queueRpc("interview_resume_source", { data: { candidate_resume_path: "co/c1.pdf" }, error: null });
    expect((await call()).status).toBe(303);
    expect(from).toHaveBeenCalledWith("company-candidate-files");
  });

  it("is 403 when the kit is closed to the caller, without reading the source", async () => {
    rls.queueRpc("can_open_interview_kit", { data: false, error: null });
    expect((await call()).status).toBe(403);
    expect(admin.callsFor("interview_resume_source")).toHaveLength(0);
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it("is 403 when there's no file (a snapshot resume shows in the kit itself)", async () => {
    rls.queueRpc("can_open_interview_kit", { data: true, error: null });
    admin.queueRpc("interview_resume_source", { data: { resume_snapshot: { content: {} } }, error: null });
    expect((await call()).status).toBe(403);
  });

  it("is 403 for an applicant and 404 for a bad id", async () => {
    expect((await call("nope")).status).toBe(404);
    await signIn(null, mockUser({ type: "applicant" }));
    expect((await call()).status).toBe(403);
  });
});
