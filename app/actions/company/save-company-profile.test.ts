import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { markMyOnboardingComplete } from "@/app/actions/update-user-metadata";
import { embedCompanyProfile } from "@/helpers/companies/embed-company-profile";
import { saveCompanyProfileAction } from "./save-company-profile";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/app/actions/update-user-metadata", () => ({ markMyOnboardingComplete: vi.fn() }));
vi.mock("@/helpers/companies/embed-company-profile", () => ({ embedCompanyProfile: vi.fn() }));
vi.mock("server-only", () => ({}));

const VALUES = {
  name: "Acme",
  description: "We build things. ".repeat(20),
  website: "https://acme.dev",
  industry: "Technology",
  headquarters: "bengaluru",
  company_size: "11-50",
  tag_line: "Hire fast",
};
const BILLING_COLUMNS = ["tier_id", "ai_credits", "job_posts_created", "user_id"];

let db: SupabaseMock;
let service: SupabaseMock;
const upload = vi.fn();
const remove = vi.fn();

async function signInAs(member: MemberFixture) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, db.client);
}

function form(values: unknown = VALUES, extra: Record<string, string | File> = {}) {
  const fd = new FormData();
  fd.append("values", JSON.stringify(values));
  for (const [key, value] of Object.entries(extra)) fd.append(key, value);
  return fd;
}

/** The profile update: the second company_info call on the user's client (the first loads the logo). */
const saveCall = () => db.callsFor("company_info")[1];

beforeEach(async () => {
  vi.clearAllMocks();
  await signInAs(OWNER_A);
  db.queue("company_info", { data: { logo_url: "https://cdn.test/old.png" }, error: null });
  service = createSupabaseMock();
  upload.mockResolvedValue({ error: null });
  remove.mockResolvedValue({ error: null });
  vi.mocked(createServiceRoleClient).mockReturnValue({
    ...service.client,
    from: service.client.from,
    storage: {
      from: () => ({
        upload,
        remove,
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/images/${path}` } }),
      }),
    },
  } as never);
  vi.mocked(embedCompanyProfile).mockResolvedValue([0.1, 0.2]);
  vi.mocked(markMyOnboardingComplete).mockResolvedValue({ error: null });
});

describe("saveCompanyProfileAction (TM-SEC-007)", () => {
  it("updates the session company's row by id with only profile columns", async () => {
    db.queue("company_info", { data: [{ id: COMPANY_A.id }], error: null });

    expect(await saveCompanyProfileAction(form())).toEqual({ ok: true, logoUrl: "https://cdn.test/old.png" });

    const methods = saveCall().chain.map((c) => c.method);
    expect(methods).toContain("update");
    expect(methods).not.toContain("upsert");
    expect(methods).not.toContain("insert");
    expect(saveCall().chain).toContainEqual({ method: "eq", args: ["id", COMPANY_A.id] });
    const payload = saveCall().chain.find((c) => c.method === "update")!.args[0] as Record<string, unknown>;
    for (const column of BILLING_COLUMNS) expect(payload).not.toHaveProperty(column);
    expect(payload).toMatchObject({ name: "Acme", filled: true });
    expect(markMyOnboardingComplete).toHaveBeenCalledWith("company");
  });

  it("drops columns the client adds to the values", async () => {
    db.queue("company_info", { data: [{ id: COMPANY_A.id }], error: null });

    await saveCompanyProfileAction(form({ ...VALUES, tier_id: "enterprise", ai_credits: 9999 }));

    const payload = saveCall().chain.find((c) => c.method === "update")!.args[0] as Record<string, unknown>;
    for (const column of BILLING_COLUMNS) expect(payload).not.toHaveProperty(column);
  });

  it("writes the embedding with the service role, scoped to the session company", async () => {
    db.queue("company_info", { data: [{ id: COMPANY_A.id }], error: null });

    await saveCompanyProfileAction(form());

    const [embedCall] = service.callsFor("company_info");
    expect(embedCall.chain).toContainEqual({ method: "eq", args: ["id", COMPANY_A.id] });
    expect(embedCall.chain.find((c) => c.method === "update")!.args[0]).toMatchObject({ embedding_new: [0.1, 0.2] });
  });

  it("uploads a new logo under the session company's folder", async () => {
    db.queue("company_info", { data: [{ id: COMPANY_A.id }], error: null });

    const result = await saveCompanyProfileAction(form(VALUES, { logo: new File(["x"], "l.png", { type: "image/png" }) }));

    expect(upload.mock.calls[0][0]).toBe(`company_logos/${COMPANY_A.id}/logo`);
    expect(result).toMatchObject({ ok: true, logoUrl: expect.stringMatching(`company_logos/${COMPANY_A.id}/logo\\?v=`) });
  });

  it("removes the logo when asked", async () => {
    db.queue("company_info", { data: [{ id: COMPANY_A.id }], error: null });

    expect(await saveCompanyProfileAction(form(VALUES, { removeLogo: "true" }))).toEqual({ ok: true, logoUrl: null });
    expect(remove).toHaveBeenCalledWith([`company_logos/${COMPANY_A.id}/logo`]);
  });

  it.each([
    ["an SVG", new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }), "Use a PNG, JPEG or WebP logo."],
    ["a 1 MB logo", new File([new Uint8Array(1024 * 1024)], "x.png", { type: "image/png" }), "The logo can be at most 900 KB."],
  ])("refuses %s before writing", async (_, file, error) => {
    expect(await saveCompanyProfileAction(form(VALUES, { logo: file }))).toEqual({ ok: false, error });
    expect(upload).not.toHaveBeenCalled();
    expect(saveCall()).toBeUndefined();
  });

  it("refuses invalid values", async () => {
    const result = await saveCompanyProfileAction(form({ ...VALUES, description: "short" }));
    expect(result).toMatchObject({ ok: false });
    expect(embedCompanyProfile).not.toHaveBeenCalled();
  });

  it("treats an update that matched no row as an error and doesn't complete onboarding", async () => {
    db.queue("company_info", { data: [], error: null });

    expect(await saveCompanyProfileAction(form())).toMatchObject({ ok: false });
    expect(markMyOnboardingComplete).not.toHaveBeenCalled();
  });

  it("refuses a member without company.profile", async () => {
    await signInAs(MEMBER_A);

    expect(await saveCompanyProfileAction(form())).toMatchObject({ ok: false });
    expect(embedCompanyProfile).not.toHaveBeenCalled();
    expect(db.callsFor("company_info")).toHaveLength(0);
  });
});
