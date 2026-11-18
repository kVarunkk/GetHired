import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { JOB_A1, MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { enqueueFeedRebuild } from "@/helpers/distribution/feed-queue";
import { setChannelEnabledAction, setJobChannelOptOutAction } from "./channel-actions";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/distribution/feed-queue", () => ({ enqueueFeedRebuild: vi.fn() }));
vi.mock("server-only", () => ({}));

let db: SupabaseMock;
let service: SupabaseMock;

async function signInAs(member: MemberFixture) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, db.client);
}

const FEED = { key: "jooble", kind: "feed", enabled: true, requires_approval: true };

beforeEach(async () => {
  vi.clearAllMocks();
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
});

describe("setChannelEnabledAction", () => {
  it("refuses a member without distribution.manage", async () => {
    await signInAs(MEMBER_A);
    const result = await setChannelEnabledAction({ channelKey: "jooble", enabled: true });
    expect(result.ok).toBe(false);
    expect(service.callsFor("company_channel_settings")).toHaveLength(0);
    expect(enqueueFeedRebuild).not.toHaveBeenCalled();
  });

  it("opts in as live even before the board approves GetHired, then queues a rebuild", async () => {
    await signInAs(OWNER_A);
    db.queue("distribution_channels", { data: FEED, error: null });
    service.queue("company_channel_settings", { data: null, error: null });
    const result = await setChannelEnabledAction({ channelKey: "jooble", enabled: true });
    expect(result).toEqual({ ok: true });
    const calls = service.callsFor("company_channel_settings");
    expect(calls).toHaveLength(1);
    const upsert = calls[0].chain.find((c) => c.method === "upsert");
    expect(upsert?.args[0]).toMatchObject({ channel_key: "jooble", enabled: true, status: "live" });
    expect(enqueueFeedRebuild).toHaveBeenCalledWith({ reason: "settings_changed" });
  });

  it("refuses an index channel", async () => {
    await signInAs(OWNER_A);
    db.queue("distribution_channels", { data: { ...FEED, key: "google", kind: "index" }, error: null });
    const result = await setChannelEnabledAction({ channelKey: "google", enabled: false });
    expect(result.ok).toBe(false);
    expect(service.callsFor("company_channel_settings")).toHaveLength(0);
  });
});

describe("setJobChannelOptOutAction", () => {
  it("rejects a malformed job id", async () => {
    await signInAs(OWNER_A);
    expect((await setJobChannelOptOutAction({ jobId: "nope", channelKey: "jooble", optedOut: true })).ok).toBe(false);
  });

  it("opts a job out and queues a rebuild", async () => {
    await signInAs(OWNER_A);
    db.queue("distribution_channels", { data: FEED, error: null });
    db.queue("job_postings", { data: { id: JOB_A1 }, error: null });
    service.queue("job_channel_postings", { data: null, error: null });
    const result = await setJobChannelOptOutAction({ jobId: JOB_A1, channelKey: "jooble", optedOut: true });
    expect(result).toEqual({ ok: true });
    const upsert = service.callsFor("job_channel_postings")[0].chain.find((c) => c.method === "upsert");
    expect(upsert?.args[0]).toMatchObject({ job_id: JOB_A1, channel_key: "jooble", status: "opted_out" });
    expect(enqueueFeedRebuild).toHaveBeenCalled();
  });

  it("404s a job outside the company", async () => {
    await signInAs(OWNER_A);
    db.queue("distribution_channels", { data: FEED, error: null });
    db.queue("job_postings", { data: null, error: null });
    const result = await setJobChannelOptOutAction({ jobId: JOB_A1, channelKey: "jooble", optedOut: true });
    expect(result).toEqual({ ok: false, error: "Job posting not found." });
    expect(service.callsFor("job_channel_postings")).toHaveLength(0);
  });
});
