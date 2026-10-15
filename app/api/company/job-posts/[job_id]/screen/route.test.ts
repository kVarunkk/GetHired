import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assertAllowance } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { setRequestUser } from "@/test/utils/auth";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { JOB_POST } from "@/test/utils/matching";
import { POST } from "./route";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ assertAllowance: vi.fn() }));
vi.mock("server-only", () => ({}));

const appId = (n: number) => `e1000000-0000-4000-8000-00000000000${n}`;

let rls: SupabaseMock;
let admin: SupabaseMock;

async function signInCompany() {
  rls = createSupabaseMock({ user: COMPANY_A.user });
  rls.queue("company_info", {
    data: { id: COMPANY_A.id, name: COMPANY_A.info.name, email: COMPANY_A.info.email },
    error: null,
  });
  await setRequestUser(COMPANY_A.user, rls.client);
}

/** The company owns the job, which has these applications and screenings. */
function ownsJob(applicationIds: string[], screenings: { application_id: string; status: string }[]) {
  rls.queue("job_postings", { data: { id: JOB_POST.id }, error: null });
  admin.queue("applications", { data: applicationIds.map((id) => ({ id })), error: null });
  admin.queue("application_screenings", { data: screenings, error: null });
}

const post = (jobId = JOB_POST.id) =>
  POST(buildRequest(`/api/company/job-posts/${jobId}/screen`, { method: "POST" }), {
    params: Promise.resolve({ job_id: jobId }),
  });

const has = (call: RecordedCall, method: string) => call.chain.some((m) => m.method === method);
const upserted = () =>
  admin
    .callsFor("application_screenings")
    .filter((c) => has(c, "upsert"))
    .flatMap((c) => c.chain.find((m) => m.method === "upsert")!.args[0] as Record<string, unknown>[]);
const sentIds = () =>
  admin
    .callsFor("send_batch")
    .flatMap((c) =>
      (c.chain[0].args[1] as { messages: { application_id: string }[] }).messages.map((m) => m.application_id),
    );

beforeEach(() => {
  vi.clearAllMocks();
  admin = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(admin.client);
  vi.mocked(assertAllowance).mockResolvedValue(undefined);
});

describe("POST /api/company/job-posts/[job_id]/screen (MTT-072)", () => {
  it("401s without a user", async () => {
    await setRequestUser(null);

    expect((await post()).status).toBe(401);
  });

  it("403s for an applicant", async () => {
    await setRequestUser(PUBLIC_APPLICANT.user, createSupabaseMock().client);

    expect((await post()).status).toBe(403);
  });

  it("404s for another company's job, scoped by the session company", async () => {
    await signInCompany();
    rls.queue("job_postings", { data: null, error: null });

    const res = await post();

    expect(res.status).toBe(404);
    expect(rls.callsFor("job_postings")[0].chain).toContainEqual({
      method: "eq",
      args: ["company_id", COMPANY_A.id],
    });
    expect(admin.calls).toHaveLength(0);
  });

  it("404s for a job id that isn't a UUID", async () => {
    await signInCompany();

    expect((await post("nope")).status).toBe(404);
  });

  it("queues applications with no screening, a stale, failed or skipped one", async () => {
    await signInCompany();
    ownsJob(
      [appId(1), appId(2), appId(3), appId(4), appId(5), appId(6), appId(7)],
      [
        { application_id: appId(2), status: "stale" },
        { application_id: appId(3), status: "failed" },
        { application_id: appId(4), status: "completed" },
        { application_id: appId(5), status: "queued" },
        { application_id: appId(6), status: "processing" },
        { application_id: appId(7), status: "skipped_quota" },
      ],
    );

    const res = await post();

    expect(await res.json()).toEqual({ queued: 4 });
    const queued = [appId(1), appId(2), appId(3), appId(7)];
    expect(sentIds()).toEqual(queued);
    expect(upserted().map((r) => r.application_id)).toEqual(queued);
    expect(upserted()[0]).toEqual(
      expect.objectContaining({
        job_post_id: JOB_POST.id,
        company_id: COMPANY_A.id,
        status: "queued",
        attempts: 0,
        error_code: null,
      }),
    );
    // Upserted on the application, before the messages go out.
    const upsertCall = admin.callsFor("application_screenings").find((c) => has(c, "upsert"))!;
    expect(upsertCall.chain.find((m) => m.method === "upsert")!.args[1]).toEqual({
      onConflict: "application_id",
    });
    expect(admin.calls.indexOf(upsertCall)).toBeLessThan(admin.calls.indexOf(admin.callsFor("send_batch")[0]));
  });

  it("queues nothing when everything is screened or in progress", async () => {
    await signInCompany();
    ownsJob([appId(1), appId(2)], [
      { application_id: appId(1), status: "completed" },
      { application_id: appId(2), status: "queued" },
    ]);

    const res = await post();

    expect(await res.json()).toEqual({ queued: 0 });
    expect(upserted()).toEqual([]);
    expect(admin.callsFor("send_batch")).toHaveLength(0);
  });

  it("queues nothing the second time in a row", async () => {
    await signInCompany();
    ownsJob([appId(1)], []);
    expect(await (await post()).json()).toEqual({ queued: 1 });

    await signInCompany();
    ownsJob([appId(1)], [{ application_id: appId(1), status: "queued" }]);

    expect(await (await post()).json()).toEqual({ queued: 0 });
  });

  it("marks the rows failed and 502s when the messages can't be sent", async () => {
    await signInCompany();
    ownsJob([appId(1)], []);
    admin.queue("application_screenings", { data: null, error: null }); // the upsert
    admin.queueRpc("send_batch", { data: null, error: { message: "queue down" } }, "pgmq_public");

    const res = await post();

    expect(res.status).toBe(502);
    const update = admin
      .callsFor("application_screenings")
      .find((c) => has(c, "update"))!
      .chain.find((m) => m.method === "update")!.args[0];
    expect(update).toEqual(expect.objectContaining({ status: "failed", error_code: "worker_error" }));
  });

  it("402s with the entitlement payload and queues nothing when no screening can be paid for", async () => {
    await signInCompany();
    ownsJob([appId(1)], []);
    vi.mocked(assertAllowance).mockRejectedValue(
      new EntitlementError({
        key: "screenings",
        kind: "allowance",
        qty: 1,
        used: 100,
        amount: 100,
        overageCredits: null,
        creditBalance: 0,
        creditsNeeded: 0,
        reason: "limit_reached",
        suggestedTier: { slug: "startup", name: "Startup" },
      }),
    );

    const res = await post();

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "entitlement", key: "screenings" });
    expect(assertAllowance).toHaveBeenCalledWith(COMPANY_A.id, "screenings", 1);
    expect(upserted()).toEqual([]);
    expect(admin.callsFor("send_batch")).toHaveLength(0);
  });

  it("skips the allowance check when only stale or failed screenings are re-queued", async () => {
    await signInCompany();
    ownsJob([appId(1), appId(2)], [
      { application_id: appId(1), status: "stale" },
      { application_id: appId(2), status: "failed" },
    ]);

    expect(await (await post()).json()).toEqual({ queued: 2 });
    expect(assertAllowance).not.toHaveBeenCalled();
  });
});
