import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { storeBoardResume } from "@/helpers/distribution/ingest/store-board-resume";
import { flushAfter } from "@/test/utils/after";
import { talentApplyToken } from "@/helpers/distribution/ingest/board-application";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/distribution/ingest/store-board-resume", () => ({ storeBoardResume: vi.fn() }));

const SECRET = "indeed-secret";
const JOB = "b0000000-0000-4000-8000-0000000000b1";
const APPLICATION = {
  id: "indeed-app-1",
  appliedOnMillis: 1763460000000,
  job: { jobId: JOB, jobKey: "k1", jobTitle: "Backend Engineer" },
  applicant: {
    fullName: "Ada Lovelace",
    email: "Ada@Example.com",
    phoneNumber: "+91 98765 43210",
    coverletter: "Hello",
    resume: { file: { fileName: "ada.pdf", contentType: "application/pdf", data: "JVBERi0=" } },
  },
  analytics: { sponsored: false },
};

let service: SupabaseMock;

const sign = (raw: string, secret = SECRET) => createHmac("sha1", secret).update(raw).digest("base64");

function post(body: unknown = APPLICATION, { platform = "indeed", signature }: { platform?: string; signature?: string | null } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sig = signature === undefined ? sign(raw) : signature;
  if (sig !== null) headers["x-indeed-signature"] = sig;
  const request = new NextRequest(new URL(`/api/webhooks/jobboards/${platform}`, "http://localhost:3000"), {
    method: "POST",
    headers,
    body: raw,
  });
  return POST(request, { params: Promise.resolve({ platform }) });
}

const ADDED = {
  ok: true,
  application_id: "app-1",
  candidate_id: "cand-1",
  company_id: "co-1",
  job_post_id: "jp-1",
  has_resume: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("INDEED_APPLY_SECRET", SECRET);
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/jobboards/[platform] (MPT-030)", () => {
  it("404 for a board with no adapter, or with no secret configured", async () => {
    expect((await post(APPLICATION, { platform: "jooble" })).status).toBe(404);
    expect((await post(APPLICATION, { platform: "toString" })).status).toBe(404);
    vi.stubEnv("INDEED_APPLY_SECRET", "");
    expect((await post()).status).toBe(404);
    expect(service.calls).toHaveLength(0);
  });

  it.each([
    ["missing", null],
    ["wrong", sign("{}", "other")],
    ["signed with another secret", sign(JSON.stringify(APPLICATION), "other")],
  ])("401 with a %s signature", async (_, signature) => {
    expect((await post(APPLICATION, { signature })).status).toBe(401);
    expect(service.calls).toHaveLength(0);
  });

  it("400 for a signed body that isn't an application", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({ id: "x", job: { jobId: "not-a-uuid" }, applicant: { email: "a@b.co" } })).status).toBe(400);
    expect((await post({ ...APPLICATION, applicant: { email: "a@b.co" } })).status).toBe(400);
    expect(service.calls).toHaveLength(0);
  });

  it("records the application with the board's id and the applicant, and reads the resume after replying", async () => {
    service.queueRpc("ingest_board_application", { data: ADDED, error: null });
    const res = await post();
    expect(res.status).toBe(200);

    const call = service.callsFor("ingest_board_application")[0];
    const params = call.chain[0].args[1] as Record<string, unknown>;
    expect(params).toMatchObject({
      p_channel: "indeed",
      p_job_ref: JOB,
      p_external_id: "indeed-app-1",
      p_applicant: { full_name: "Ada Lovelace", email: "ada@example.com", phone: "+91 98765 43210" },
    });
    // The audit summary never carries contact details, the cover letter or the file.
    const summary = JSON.stringify(params.p_payload);
    expect(summary).not.toMatch(/ada@example|98765|Hello|JVBERi0/i);

    expect(storeBoardResume).not.toHaveBeenCalled();
    await flushAfter();
    expect(storeBoardResume).toHaveBeenCalledWith(service.client, {
      companyId: "co-1",
      candidateId: "cand-1",
      base64: "JVBERi0=",
    });
  });

  it("keeps a resume the candidate already has", async () => {
    service.queueRpc("ingest_board_application", { data: { ...ADDED, has_resume: true }, error: null });
    expect((await post()).status).toBe(200);
    await flushAfter();
    expect(storeBoardResume).not.toHaveBeenCalled();
  });

  it.each([
    ["duplicate", 409],
    ["already_in_job", 409],
    ["closed", 410],
    ["unknown_job", 404],
    ["invalid", 400],
  ])("answers %s with %i and stores no resume", async (reason, status) => {
    service.queueRpc("ingest_board_application", { data: { ok: false, reason }, error: null });
    expect((await post()).status).toBe(status);
    await flushAfter();
    expect(storeBoardResume).not.toHaveBeenCalled();
  });

  it("500 when the database fails, so the board retries", async () => {
    service.queueRpc("ingest_board_application", { data: null, error: { message: "boom" } });
    expect((await post()).status).toBe(500);
  });

  it("builds the name from first and last when there's no full name", async () => {
    service.queueRpc("ingest_board_application", { data: ADDED, error: null });
    const rest: Record<string, unknown> = { ...APPLICATION.applicant };
    delete rest.fullName;
    await post({ ...APPLICATION, applicant: { ...rest, firstName: "Ada", lastName: "King" } });
    const params = service.callsFor("ingest_board_application")[0].chain[0].args[1] as { p_applicant: { full_name: string } };
    expect(params.p_applicant.full_name).toBe("Ada King");
  });
});

describe("POST /api/webhooks/jobboards/talent (Talent Apply)", () => {
  const TALENT_SECRET = "talent-secret";
  const TALENT_APPLICATION = {
    id: "talent-app-1",
    job: { jobId: JOB, jobTitle: "Backend Engineer" },
    applicant: {
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phoneNumber: "+91 98765 43210",
      resume: { file: { fileName: "ada.pdf", contentType: "application/pdf", data: "JVBERi0=" } },
    },
    analytics: { ip: "1.2.3.4", useragent: "x", device: "desktop" },
  };

  function postTalent(body: unknown, token: string | null) {
    const url = new URL("/api/webhooks/jobboards/talent", "http://localhost:3000");
    if (token !== null) url.searchParams.set("token", token);
    const request = new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return POST(request, { params: Promise.resolve({ platform: "talent" }) });
  }

  it("is a 404 until TALENT_APPLY_SECRET is set", async () => {
    const res = await postTalent(TALENT_APPLICATION, talentApplyToken(JOB, TALENT_SECRET));
    expect(res.status).toBe(404);
  });

  it("accepts the job's token and records the application", async () => {
    vi.stubEnv("TALENT_APPLY_SECRET", TALENT_SECRET);
    service.queueRpc("ingest_board_application", { data: ADDED, error: null });
    const res = await postTalent(TALENT_APPLICATION, talentApplyToken(JOB, TALENT_SECRET));
    expect(res.status).toBe(200);
    expect(service.callsFor("ingest_board_application")[0].chain[0].args[1]).toMatchObject({
      p_channel: "talent",
      p_job_ref: JOB,
      p_external_id: "talent-app-1",
      p_applicant: { full_name: "Ada Lovelace", email: "ada@example.com", phone: "+91 98765 43210" },
    });
  });

  it("refuses a missing token or another job's token", async () => {
    vi.stubEnv("TALENT_APPLY_SECRET", TALENT_SECRET);
    expect((await postTalent(TALENT_APPLICATION, null)).status).toBe(401);
    const other = talentApplyToken("b0000000-0000-4000-8000-0000000000b2", TALENT_SECRET);
    expect((await postTalent(TALENT_APPLICATION, other)).status).toBe(401);
    expect(service.callsFor("ingest_board_application")).toHaveLength(0);
  });
});
