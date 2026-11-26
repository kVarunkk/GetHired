import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidateTag } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { MEMBER_A, OWNER_A } from "@/test/utils/team";
import { COMPANY_A, jobPostingOf } from "@/test/utils/recruiter";
import { deleteJobPostingAction, restoreJobPostingAction } from "./delete-job-posting";

vi.mock("@/helpers/distribution/index-queue", () => ({ enqueueIndexPing: vi.fn() }));
vi.mock("@/helpers/distribution/feed-queue", () => ({ enqueueFeedRebuild: vi.fn() }));

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
    rls.queueRpc("remove_job_post", { data: { ok: true, outcome: "deleted", job_id: OWN.job_id }, error: null });

    await deleteJobPostingAction({ jobPostingId: OWN.id });

    const [load] = rls.callsFor("job_postings");
    expect(load.chain).toContainEqual({ method: "eq", args: ["id", OWN.id] });
    expect(load.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it("removes through remove_job_post as the session user, and reports a delete", async () => {
    rls.queue("job_postings", { data: { id: OWN.id }, error: null });
    rls.queueRpc("remove_job_post", {
      data: { ok: true, outcome: "deleted", job_id: OWN.job_id, title: "Engineer", applications: 0, was_active: false },
      error: null,
    });

    expect(await deleteJobPostingAction({ jobPostingId: OWN.id })).toEqual({ ok: true, outcome: "deleted" });

    expect(rls.callsFor("remove_job_post")[0].chain[0]).toEqual({ method: "rpc", args: ["remove_job_post", { p_job_post_id: OWN.id }] });
    // Nothing deletes rows behind the function's back with the service role.
    expect(deletes("job_postings")).toHaveLength(0);
    expect(deletes("all_jobs")).toHaveLength(0);
    expect(revalidateTag).toHaveBeenCalledWith(`job-${OWN.job_id}`);
  });

  it("reports an archive when the job has applications", async () => {
    rls.queue("job_postings", { data: { id: OWN.id }, error: null });
    rls.queueRpc("remove_job_post", {
      data: { ok: true, outcome: "archived", job_id: OWN.job_id, title: "Engineer", applications: 3, was_active: true },
      error: null,
    });

    expect(await deleteJobPostingAction({ jobPostingId: OWN.id })).toEqual({ ok: true, outcome: "archived" });
    expect(revalidateTag).toHaveBeenCalledWith(`job-${OWN.job_id}`);
  });

  it("passes on the function's refusal", async () => {
    rls.queue("job_postings", { data: { id: OWN.id }, error: null });
    rls.queueRpc("remove_job_post", { data: { ok: false, reason: "forbidden" }, error: null });

    expect(await deleteJobPostingAction({ jobPostingId: OWN.id })).toEqual({ ok: false, error: "Your role can't delete job posts." });
  });

  it("fails cleanly when the function errors", async () => {
    rls.queue("job_postings", { data: { id: OWN.id }, error: null });
    rls.queueRpc("remove_job_post", { data: null, error: { message: "boom" } });

    expect(await deleteJobPostingAction({ jobPostingId: OWN.id })).toEqual({ ok: false, error: "Failed to delete the job posting." });
  });

  it("restores an archived posting through restore_job_post", async () => {
    rls.queue("job_postings", { data: { id: OWN.id }, error: null });
    rls.queueRpc("restore_job_post", { data: { ok: true, job_id: OWN.job_id, title: "Engineer" }, error: null });

    expect(await restoreJobPostingAction({ jobPostingId: OWN.id })).toEqual({ ok: true });
    expect(rls.callsFor("restore_job_post")).toHaveLength(1);
  });

  it("refuses a restore for a member", async () => {
    rls = createSupabaseMock({ user: MEMBER_A.user });
    rls.queueRpc("my_company_access", { data: MEMBER_A.membership, error: null });
    await setRequestUser(MEMBER_A.user, rls.client);

    expect(await restoreJobPostingAction({ jobPostingId: OWN.id })).toEqual({ ok: false, error: "Your role can't delete job posts." });
    expect(rls.callsFor("restore_job_post")).toHaveLength(0);
  });

  it("rejects a non-UUID id before any query", async () => {
    expect(await deleteJobPostingAction({ jobPostingId: "nope" })).toMatchObject({ ok: false });
    expect(rls.callsFor("job_postings")).toHaveLength(0);
  });
});
