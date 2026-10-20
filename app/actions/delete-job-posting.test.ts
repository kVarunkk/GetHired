import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidateTag } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { MEMBER_A, OWNER_A } from "@/test/utils/team";
import { COMPANY_A, jobPostingOf } from "@/test/utils/recruiter";
import { deleteJobPostingAction } from "./delete-job-posting";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

const OWN = jobPostingOf(COMPANY_A);

let rls: SupabaseMock;
let service: SupabaseMock;

const deletes = (table: string) =>
  [...rls.callsFor(table), ...service.callsFor(table)].filter((c) =>
    c.chain.some((m) => m.method === "delete"),
  );

async function signIn(user = COMPANY_A.user) {
  rls = createSupabaseMock({ user });
  rls.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  await setRequestUser(user, rls.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  await signIn();
});

describe("deleteJobPostingAction", () => {
  it("refuses a member (TM-REQ-004) without deleting", async () => {
    rls = createSupabaseMock({ user: MEMBER_A.user });
    rls.queueRpc("my_company_access", { data: MEMBER_A.membership, error: null });
    await setRequestUser(MEMBER_A.user, rls.client);

    expect(await deleteJobPostingAction({ jobPostingId: OWN.id })).toEqual({
      ok: false,
      error: "Your role can't delete job posts.",
    });
    expect(service.calls).toHaveLength(0);
  });

  it("refuses an unauthenticated caller", async () => {
    await setRequestUser(null, rls.client);

    expect(await deleteJobPostingAction({ jobPostingId: OWN.id })).toMatchObject({ ok: false });
    expect(service.calls).toHaveLength(0);
  });

  it("refuses an applicant", async () => {
    await signIn(mockUser({ type: "applicant" }));

    expect(await deleteJobPostingAction({ jobPostingId: OWN.id })).toMatchObject({ ok: false });
    expect(service.calls).toHaveLength(0);
  });

  it("treats another company's posting as not found and deletes nothing", async () => {
    rls.queue("job_postings", { data: null, error: null });

    expect(await deleteJobPostingAction({ jobPostingId: OWN.id })).toEqual({
      ok: false,
      error: "Job posting not found.",
    });
    expect(deletes("job_postings")).toHaveLength(0);
    expect(deletes("all_jobs")).toHaveLength(0);
  });

  it("looks the posting up within the session company", async () => {
    rls.queue("job_postings", { data: { id: OWN.id, job_id: OWN.job_id }, error: null });

    await deleteJobPostingAction({ jobPostingId: OWN.id });

    const [load] = rls.callsFor("job_postings");
    expect(load.chain).toContainEqual({ method: "eq", args: ["id", OWN.id] });
    expect(load.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it("deletes the public all_jobs row first, then the posting, and revalidates", async () => {
    rls.queue("job_postings", { data: { id: OWN.id, job_id: OWN.job_id }, error: null });

    expect(await deleteJobPostingAction({ jobPostingId: OWN.id })).toEqual({ ok: true });

    const order = service.calls.map((c) => c.target);
    expect(order).toEqual(["all_jobs", "job_postings"]);
    expect(deletes("all_jobs")[0].chain).toContainEqual({ method: "eq", args: ["id", OWN.job_id] });
    expect(deletes("job_postings")[0].chain).toContainEqual({ method: "eq", args: ["id", OWN.id] });
    expect(revalidateTag).toHaveBeenCalledWith(`job-${OWN.job_id}`);
  });

  it("deletes only the posting when it was never published", async () => {
    rls.queue("job_postings", { data: { id: OWN.id, job_id: null }, error: null });

    expect(await deleteJobPostingAction({ jobPostingId: OWN.id })).toEqual({ ok: true });

    expect(deletes("all_jobs")).toHaveLength(0);
    expect(deletes("job_postings")).toHaveLength(1);
  });

  it("keeps the posting when the all_jobs delete fails, so it can be retried", async () => {
    rls.queue("job_postings", { data: { id: OWN.id, job_id: OWN.job_id }, error: null });
    service.queue("all_jobs", { data: null, error: { message: "denied" } });

    expect(await deleteJobPostingAction({ jobPostingId: OWN.id })).toMatchObject({ ok: false });
    expect(deletes("job_postings")).toHaveLength(0);
  });

  it("rejects a non-UUID id before any query", async () => {
    expect(await deleteJobPostingAction({ jobPostingId: "nope" })).toMatchObject({ ok: false });
    expect(rls.callsFor("job_postings")).toHaveLength(0);
  });
});
