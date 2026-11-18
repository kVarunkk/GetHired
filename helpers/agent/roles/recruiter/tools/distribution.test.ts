import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDistributionTools } from "./distribution";
import { createRecruiterTools } from "./index";
import { execTool, recruiterToolContext, validateInput } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { enqueueFeedRebuild } from "@/helpers/distribution/feed-queue";
import { COMPANY_A } from "@/test/utils/recruiter";
import { myCompanyOf } from "@/test/utils/team";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({ eventCaptureServerException: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/distribution/feed-queue", () => ({ enqueueFeedRebuild: vi.fn() }));

const JOB = "b0000000-0000-4000-8000-0000000000b1";
const FEED = { key: "jooble", kind: "feed", enabled: true, requires_approval: true };

let supabase: SupabaseMock;
let service: SupabaseMock;
let tools: ReturnType<typeof createDistributionTools>;

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  tools = createDistributionTools(recruiterToolContext(supabase.client));
});

describe("getDistribution", () => {
  it("lists the company-wide switch of each channel", async () => {
    supabase.queue("distribution_channels", {
      data: [
        { key: "google", name: "Google", kind: "index", enabled: true, requires_approval: false },
        { ...FEED, name: "Jooble" },
      ],
      error: null,
    });
    supabase.queue("company_channel_settings", { data: [], error: null });
    const result = (await execTool(tools.getDistribution, {})) as { channels: { key: string; state: string; canToggle: boolean }[] };
    expect(result.channels).toEqual([
      expect.objectContaining({ key: "google", state: "always_on", canToggle: false }),
      expect.objectContaining({ key: "jooble", state: "off", canToggle: true }),
    ]);
  });

  it("says when the job isn't the company's", async () => {
    supabase.queue("job_postings", { data: null, error: null });
    expect(await execTool(tools.getDistribution, { jobPostId: JOB })).toEqual({ error: "Job post not found." });
  });
});

describe("setDistribution", () => {
  it("needs exactly one of enabled, or jobPostId with optedOut", async () => {
    expect((await validateInput(tools.setDistribution, { channelKey: "jooble" })).success).toBe(false);
    expect((await validateInput(tools.setDistribution, { channelKey: "jooble", enabled: true, jobPostId: JOB, optedOut: true })).success).toBe(false);
    expect((await validateInput(tools.setDistribution, { channelKey: "jooble", jobPostId: JOB })).success).toBe(false);
    expect((await validateInput(tools.setDistribution, { channelKey: "jooble", jobPostId: JOB, optedOut: true })).success).toBe(true);
  });

  it("turns a channel on as pending when it needs approval, and queues a rebuild", async () => {
    supabase.queue("distribution_channels", { data: FEED, error: null });
    service.queue("company_channel_settings", { data: null, error: null });
    service.queue("company_channel_settings", { data: null, error: null });
    expect(await execTool(tools.setDistribution, { channelKey: "jooble", enabled: true })).toEqual({ channel: "jooble", enabled: true });
    const upsert = service.callsFor("company_channel_settings")[1].chain.find((c) => c.method === "upsert");
    expect(upsert?.args[0]).toMatchObject({ company_id: COMPANY_A.id, channel_key: "jooble", status: "pending" });
    expect(enqueueFeedRebuild).toHaveBeenCalledWith({ reason: "settings_changed" });
  });

  it("refuses an index channel", async () => {
    supabase.queue("distribution_channels", { data: { ...FEED, key: "google", kind: "index" }, error: null });
    expect(await execTool(tools.setDistribution, { channelKey: "google", enabled: false })).toEqual({
      error: "This channel can't be changed.",
    });
    expect(service.callsFor("company_channel_settings")).toHaveLength(0);
  });

  it("leaves a job out of a channel", async () => {
    supabase.queue("distribution_channels", { data: FEED, error: null });
    supabase.queue("job_postings", { data: { id: JOB }, error: null });
    service.queue("job_channel_postings", { data: null, error: null });
    const result = await execTool(tools.setDistribution, { channelKey: "jooble", jobPostId: JOB, optedOut: true });
    expect(result).toMatchObject({ channel: "jooble", optedOut: true });
    const upsert = service.callsFor("job_channel_postings")[0].chain.find((c) => c.method === "upsert");
    expect(upsert?.args[0]).toMatchObject({ job_id: JOB, channel_key: "jooble", status: "opted_out" });
  });
});

describe("permissions", () => {
  it("keeps the tools from a role without the distribution keys", () => {
    const ctx = recruiterToolContext(supabase.client, {
      company: { ...myCompanyOf(COMPANY_A), isOwner: false, grants: new Map([["jobs.view", "all"]]) },
    });
    const allowed = createRecruiterTools(ctx);
    expect(allowed.getDistribution).toBeUndefined();
    expect(allowed.setDistribution).toBeUndefined();
  });

  it("refuses a company-wide switch to a role limited to assigned jobs", async () => {
    const ctx = recruiterToolContext(supabase.client, {
      company: {
        ...myCompanyOf(COMPANY_A),
        isOwner: false,
        grants: new Map([
          ["distribution.view", "assigned"],
          ["distribution.manage", "assigned"],
        ]),
        assignedJobIds: new Set([JOB]),
      },
    });
    const tool = createRecruiterTools(ctx).setDistribution!;
    const result = (await execTool(tool, { channelKey: "jooble", enabled: true })) as { error?: string };
    expect(result.error).toBeTruthy();
    expect(service.callsFor("company_channel_settings")).toHaveLength(0);
  });
});
