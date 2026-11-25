import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath, revalidateTag } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assertLimit } from "@/helpers/billing/entitlements";
import { EntitlementError, type EntitlementPayload } from "@/helpers/billing/errors";
import { careersCompanyTag } from "@/helpers/careers/cache-tags";
import { enqueueFeedRebuild } from "@/helpers/distribution/feed-queue";
import { enqueueIndexPing } from "@/helpers/distribution/index-queue";
import { queueJobPostingRelevance } from "@/helpers/profiles/queue-job-relevance";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ROLES_A, myCompanyOf } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { makeJobPost } from "@/test/utils/job-states";
import { afterCallbacks, flushAfter } from "@/test/utils/after";
import { sendApprovalEmails } from "./job-approval-emails";
import { JOB_STATE_REFUSALS } from "./job-state-copy";
import type { JobPostState } from "./job-states";
import { setJobPostState, type SetJobPostStateInput } from "./set-job-post-state";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ assertLimit: vi.fn() }));
vi.mock("@/helpers/distribution/index-queue", () => ({ enqueueIndexPing: vi.fn() }));
vi.mock("@/helpers/distribution/feed-queue", () => ({ enqueueFeedRebuild: vi.fn() }));
vi.mock("@/helpers/profiles/queue-job-relevance", () => ({ queueJobPostingRelevance: vi.fn() }));
vi.mock("./job-approval-emails", () => ({ sendApprovalEmails: vi.fn() }));

const company = myCompanyOf(COMPANY_A);
const NEW_ROW = "d0000000-0000-4000-8000-0000000000aa";

let db: SupabaseMock;
let service: SupabaseMock;

const AT_LIMIT: EntitlementPayload = {
  key: "active_job_posts",
  kind: "limit",
  qty: 1,
  used: 2,
  amount: 2,
  overageCredits: null,
  creditBalance: 0,
  creditsNeeded: 0,
  reason: "limit_reached",
  suggestedTier: { slug: "startup", name: "Startup" },
};

function given(state: JobPostState, overrides: Omit<Parameters<typeof makeJobPost>[1], "state"> = {}) {
  const post = makeJobPost(COMPANY_A, { state, ...overrides });
  db.queue("job_postings", { data: post, error: null });
  return post;
}

function rpcReturns(result: Record<string, unknown>) {
  db.queueRpc("set_job_post_state", { data: result, error: null });
}

const run = (post: { id: string }, input: Partial<SetJobPostStateInput> & { to: JobPostState }) =>
  setJobPostState({ supabase: db.client, company, user: COMPANY_A.user }, { jobPostId: post.id, ...input });

const rpcArgs = () => db.callsFor("set_job_post_state")[0]?.chain[0].args[1];

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: COMPANY_A.user });
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
});

describe("setJobPostState: the write (JL-REQ-005)", () => {
  it("moves the job through one set_job_post_state call, never writing the rows itself", async () => {
    const post = given("open");
    rpcReturns({ ok: true, changed: true, job_id: post.job_id, from: "open", to: "paused" });

    expect(await run(post, { to: "paused", note: "  Budget review  " })).toEqual({
      ok: true,
      changed: true,
      from: "open",
      state: "paused",
      jobId: post.job_id,
    });
    expect(rpcArgs()).toEqual({ p_job_post_id: post.id, p_to: "paused", p_note: "Budget review", p_actor_kind: "user" });
    const writes = [...db.calls, ...service.calls].filter((c) => c.chain.some((m) => ["update", "insert"].includes(m.method)));
    expect(writes).toHaveLength(0);
  });

  it("sends the close reason only for closed, and records the agent as the actor kind", async () => {
    const post = given("open");
    rpcReturns({ ok: true, changed: true, job_id: post.job_id, from: "open", to: "closed" });

    await setJobPostState(
      { supabase: db.client, company, actorKind: "agent" },
      { jobPostId: post.id, to: "closed", reason: "cancelled" },
    );
    expect(rpcArgs()).toMatchObject({ p_to: "closed", p_reason: "cancelled", p_actor_kind: "agent" });
  });

  it("refuses a move from a state outside `from`, before the RPC", async () => {
    const post = given("draft");
    expect(await run(post, { to: "open", from: ["pending_approval"] })).toEqual({
      ok: false,
      error: JOB_STATE_REFUSALS.invalid_transition,
    });
    expect(db.callsFor("set_job_post_state")).toHaveLength(0);
  });

  it("makes a move from a state inside `from`", async () => {
    const post = given("pending_approval");
    rpcReturns({ ok: true, changed: true, job_id: post.job_id, from: "pending_approval", to: "draft" });
    expect(await run(post, { to: "draft", note: "Fix the salary", from: ["pending_approval"] })).toMatchObject({ ok: true });
  });

  it.each([
    [{ to: "closed" }, JOB_STATE_REFUSALS.reason_required],
    [{ to: "closed", reason: "deadline" }, JOB_STATE_REFUSALS.reason_required],
    [{ to: "paused", note: "x".repeat(501) }, JOB_STATE_REFUSALS.note_too_long],
    [{ to: "nonsense" }, JOB_STATE_REFUSALS.invalid_transition],
  ])("refuses %o before any query", async (input, error) => {
    const post = makeJobPost(COMPANY_A, { state: "open" });
    expect(await run(post, input as never)).toEqual({ ok: false, error });
    expect(db.calls).toHaveLength(0);
  });

  it("refuses without jobs.publish or jobs.approve, before any query", async () => {
    const viewer = myCompanyOf(COMPANY_A, { isOwner: false, role: ROLES_A.member });
    const post = makeJobPost(COMPANY_A, { state: "open" });
    expect(
      await setJobPostState({ supabase: db.client, company: viewer }, { jobPostId: post.id, to: "paused" }),
    ).toEqual({ ok: false, error: JOB_STATE_REFUSALS.forbidden });
    expect(db.calls).toHaveLength(0);
  });

  it("looks the posting up in the session's company", async () => {
    const post = given("open");
    rpcReturns({ ok: true, changed: true, job_id: post.job_id, from: "open", to: "paused" });
    await run(post, { to: "paused" });
    expect(db.callsFor("job_postings")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it("treats a missing posting as not found", async () => {
    db.queue("job_postings", { data: null, error: null });
    expect(await run(makeJobPost(COMPANY_A, { state: "open" }), { to: "paused" })).toEqual({
      ok: false,
      error: JOB_STATE_REFUSALS.not_found,
    });
    expect(db.callsFor("set_job_post_state")).toHaveLength(0);
  });

  it.each(Object.entries(JOB_STATE_REFUSALS))("maps the RPC's %s to its copy and runs no side effect", async (reason, copy) => {
    const post = given("paused");
    rpcReturns({ ok: false, reason });

    expect(await run(post, { to: "open" })).toEqual({ ok: false, error: copy });
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(enqueueIndexPing).not.toHaveBeenCalled();
    expect(enqueueFeedRebuild).not.toHaveBeenCalled();
  });

  it("names permissions in its copy, never a role", () => {
    for (const copy of Object.values(JOB_STATE_REFUSALS)) expect(copy).not.toMatch(/\b(admin|owner|member)s?\b/i);
  });
});

describe("setJobPostState: the limit and the public row (§3, JL-REQ-006)", () => {
  it("checks the plan's limit when opening, and stops with the upgrade copy", async () => {
    const post = given("paused");
    vi.mocked(assertLimit).mockRejectedValue(new EntitlementError(AT_LIMIT));

    expect(await run(post, { to: "open" })).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "entitlement", key: "active_job_posts" }),
    });
    expect(assertLimit).toHaveBeenCalledWith(COMPANY_A.id, "active_job_posts");
    expect(db.callsFor("set_job_post_state")).toHaveLength(0);
  });

  it("doesn't check the limit for any other move", async () => {
    const post = given("open");
    rpcReturns({ ok: true, changed: true, job_id: post.job_id, from: "open", to: "closed" });
    await run(post, { to: "closed", reason: "other" });
    expect(assertLimit).not.toHaveBeenCalled();
  });

  it("creates the public row before the first opening, then opens through the RPC", async () => {
    const post = given("draft");
    service.queue("all_jobs", { data: { id: NEW_ROW }, error: null });
    service.queue("job_postings", { data: [{ job_id: NEW_ROW }], error: null });
    rpcReturns({ ok: true, changed: true, job_id: NEW_ROW, from: "draft", to: "open", first_open: true });

    expect(await run(post, { to: "open" })).toMatchObject({ ok: true, jobId: NEW_ROW });
    const insert = service.callsFor("all_jobs")[0];
    expect(insert.chain[0]).toMatchObject({ method: "insert" });
    expect(insert.chain[0].args[0]).toMatchObject({ status: "inactive" });
  });

  it("refreshes a row left by an earlier attempt instead of inserting another", async () => {
    const post = given("draft", { job_id: "d0000000-0000-4000-8000-000000000077" });
    rpcReturns({ ok: true, changed: true, job_id: post.job_id, from: "draft", to: "open", first_open: true });

    await run(post, { to: "open" });
    const [update] = service.callsFor("all_jobs");
    expect(update.chain.map((c) => c.method)).toEqual(["update", "eq"]);
    expect(update.chain[0].args[0]).not.toHaveProperty("status");
  });

  it("doesn't touch the public row when reopening a job that was open before", async () => {
    const post = given("closed");
    rpcReturns({ ok: true, changed: true, job_id: post.job_id, from: "closed", to: "open" });
    await run(post, { to: "open" });
    expect(service.callsFor("all_jobs")).toHaveLength(0);
  });

  it("reports no_public_row and skips the RPC when the row can't be created", async () => {
    const post = given("draft");
    service.queue("all_jobs", { data: null, error: { message: "boom" } });
    expect(await run(post, { to: "open" })).toEqual({ ok: false, error: JOB_STATE_REFUSALS.no_public_row });
    expect(db.callsFor("set_job_post_state")).toHaveLength(0);
  });
});

describe("setJobPostState: side effects only when it changed (JL-REQ-010)", () => {
  it("on opening: revalidates, pings activated, rebuilds feeds and queues matching the first time", async () => {
    const post = given("draft");
    service.queue("all_jobs", { data: { id: NEW_ROW }, error: null });
    service.queue("job_postings", { data: [{ job_id: NEW_ROW }], error: null });
    rpcReturns({ ok: true, changed: true, job_id: NEW_ROW, from: "draft", to: "open", first_open: true });

    await run(post, { to: "open" });
    expect(revalidateTag).toHaveBeenCalledWith(`job-${NEW_ROW}`);
    expect(revalidateTag).toHaveBeenCalledWith(careersCompanyTag(COMPANY_A.id));
    expect(revalidatePath).toHaveBeenCalledWith(`/jobs/${NEW_ROW}`);
    expect(revalidatePath).toHaveBeenCalledWith("/company/job-posts");
    expect(enqueueIndexPing).toHaveBeenCalledWith({ jobId: NEW_ROW, reason: "activated" });
    expect(enqueueFeedRebuild).toHaveBeenCalled();
    expect(queueJobPostingRelevance).toHaveBeenCalledWith(expect.objectContaining({ company }), post.id);
  });

  it("on closing an open job: pings closed, no matching", async () => {
    const post = given("open");
    rpcReturns({ ok: true, changed: true, job_id: post.job_id, from: "open", to: "closed" });

    await run(post, { to: "closed", reason: "cancelled" });
    expect(enqueueIndexPing).toHaveBeenCalledWith({ jobId: post.job_id, reason: "closed" });
    expect(enqueueFeedRebuild).toHaveBeenCalled();
    expect(queueJobPostingRelevance).not.toHaveBeenCalled();
  });

  it("a move that doesn't change the public status (closed → filled) pings nothing", async () => {
    const post = given("closed");
    rpcReturns({ ok: true, changed: true, job_id: post.job_id, from: "closed", to: "filled" });

    await run(post, { to: "filled" });
    expect(enqueueIndexPing).not.toHaveBeenCalled();
    expect(enqueueFeedRebuild).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/company/job-posts");
  });

  it("a submit for approval touches nothing public", async () => {
    const post = given("draft");
    rpcReturns({ ok: true, changed: true, job_id: null, from: "draft", to: "pending_approval" });

    await run(post, { to: "pending_approval" });
    expect(service.calls).toHaveLength(0);
    expect(enqueueIndexPing).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("does nothing when the RPC reports no change", async () => {
    const post = given("paused");
    rpcReturns({ ok: true, changed: false, job_id: post.job_id, from: "paused", to: "paused" });

    expect(await run(post, { to: "paused" })).toMatchObject({ ok: true, changed: false });
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(enqueueIndexPing).not.toHaveBeenCalled();
    expect(queueJobPostingRelevance).not.toHaveBeenCalled();
  });

  it("emails about a submit in after(), with the actor and the note (JLT-054)", async () => {
    const post = given("draft");
    rpcReturns({ ok: true, changed: true, job_id: post.job_id, from: "draft", to: "pending_approval" });

    await run(post, { to: "pending_approval", note: "Ready for review" });
    expect(sendApprovalEmails).not.toHaveBeenCalled();
    await flushAfter();

    expect(sendApprovalEmails).toHaveBeenCalledWith(service.client, {
      companyId: company.id,
      postId: post.id,
      title: post.title,
      from: "draft",
      to: "pending_approval",
      actorId: COMPANY_A.user.id,
      note: "Ready for review",
    });
  });

  it("emails about a review of a pending job", async () => {
    const post = given("pending_approval");
    rpcReturns({ ok: true, changed: true, job_id: post.job_id, from: "pending_approval", to: "draft" });

    await run(post, { to: "draft", note: "Fix the pay" });
    await flushAfter();

    expect(sendApprovalEmails).toHaveBeenCalledWith(
      service.client,
      expect.objectContaining({ from: "pending_approval", to: "draft", note: "Fix the pay" }),
    );
  });

  it("schedules no email for other moves, or when nothing changed", async () => {
    afterCallbacks.length = 0;
    const open = given("open");
    rpcReturns({ ok: true, changed: true, job_id: open.job_id, from: "open", to: "paused" });
    await run(open, { to: "paused" });
    const pending = given("pending_approval");
    rpcReturns({ ok: true, changed: false, job_id: pending.job_id, from: "pending_approval", to: "pending_approval" });
    await run(pending, { to: "pending_approval" });
    await flushAfter();

    expect(sendApprovalEmails).not.toHaveBeenCalled();
  });

  it("still reports success when queueing fails after the move", async () => {
    const post = given("open");
    rpcReturns({ ok: true, changed: true, job_id: post.job_id, from: "open", to: "paused" });
    vi.mocked(enqueueIndexPing).mockRejectedValue(new Error("queue down"));

    expect(await run(post, { to: "paused" })).toMatchObject({ ok: true, changed: true });
  });
});
