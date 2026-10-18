import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidateTag } from "next/cache";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { ADMIN_A, MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { claimCareersSlugAction } from "./claim-careers-slug";
import { saveCareersPageAction } from "./save-careers-page";
import { setCareersPublishedAction } from "./set-careers-published";
import { uploadCareersImageAction } from "./upload-careers-image";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("server-only", () => ({}));

let db: SupabaseMock;
async function signInAs(member: MemberFixture) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, db.client);
}
const rpcArgs = (fn: string) => db.callsFor(fn).map((c) => c.chain[0].args[1]);

const PAGE = {
  accentColor: "#4F46E5",
  coverUrl: null,
  sections: [{ id: "5c000000-0000-4000-8000-000000000001", kind: "about" as const, hidden: false }],
  links: {},
};

beforeEach(async () => {
  vi.clearAllMocks();
  await signInAs(OWNER_A);
});

describe("careers actions (CPT-050)", () => {
  it("claims a new slug and revalidates the old and new pages", async () => {
    db.queue("company_info", { data: { careers_slug: "acme" }, error: null });
    db.queueRpc("claim_careers_slug", { data: { ok: true, slug: "acme-careers" }, error: null });

    expect(await claimCareersSlugAction({ slug: " Acme-Careers " })).toEqual({ ok: true, slug: "acme-careers" });
    expect(rpcArgs("claim_careers_slug")).toEqual([{ p_slug: "acme-careers" }]);
    expect(revalidateTag).toHaveBeenCalledWith("careers:acme");
    expect(revalidateTag).toHaveBeenCalledWith("careers:acme-careers");
    expect(revalidateTag).toHaveBeenCalledWith(`careers-company:${COMPANY_A.id}`);
  });

  it.each([
    ["an invalid slug", "a b", "Use lowercase letters, numbers and single dashes."],
    ["a reserved slug", "jobs", "That address is reserved."],
  ])("refuses %s before the RPC", async (_, slug, error) => {
    expect(await claimCareersSlugAction({ slug })).toEqual({ ok: false, error });
    expect(db.callsFor("claim_careers_slug")).toHaveLength(0);
  });

  it("maps a taken slug", async () => {
    db.queue("company_info", { data: { careers_slug: "acme" }, error: null });
    db.queueRpc("claim_careers_slug", { data: { ok: false, reason: "taken" }, error: null });
    expect(await claimCareersSlugAction({ slug: "globex" })).toEqual({ ok: false, error: "That address is taken. Try another." });
  });

  it("saves the page with the parsed values", async () => {
    await signInAs(ADMIN_A);
    db.queueRpc("save_careers_page", { data: { ok: true }, error: null });
    db.queue("company_info", { data: { careers_slug: "acme" }, error: null });

    expect(await saveCareersPageAction(PAGE)).toEqual({ ok: true });
    expect(rpcArgs("save_careers_page")).toEqual([
      { p_accent_color: "#4f46e5", p_cover_url: null, p_sections: PAGE.sections, p_links: {} },
    ]);
    expect(revalidateTag).toHaveBeenCalledWith("careers:acme");
  });

  it("refuses an unreadable accent without calling the RPC (CP-REQ-009)", async () => {
    const result = await saveCareersPageAction({ ...PAGE, accentColor: "#fde047" });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/too light/) });
    expect(db.callsFor("save_careers_page")).toHaveLength(0);
  });

  it("publishes", async () => {
    db.queueRpc("set_careers_published", { data: { ok: true }, error: null });
    db.queue("company_info", { data: { careers_slug: "acme" }, error: null });
    expect(await setCareersPublishedAction({ published: true })).toEqual({ ok: true });
    expect(rpcArgs("set_careers_published")).toEqual([{ p_published: true }]);
  });

  it("needs careers.edit for every write", async () => {
    await signInAs(MEMBER_A);
    db.queueRpc("my_company_access", { data: MEMBER_A.membership, error: null });
    db.queueRpc("my_company_access", { data: MEMBER_A.membership, error: null });
    const denied = { ok: false, error: "Your role can't edit the careers page." };
    expect(await claimCareersSlugAction({ slug: "acme-2" })).toEqual(denied);
    expect(await saveCareersPageAction(PAGE)).toEqual(denied);
    expect(await setCareersPublishedAction({ published: true })).toEqual(denied);
    expect(db.calls.filter((c) => c.kind === "rpc" && c.target !== "my_company_access")).toHaveLength(0);
  });
});

describe("uploadCareersImageAction (CPT-051)", () => {
  const upload = vi.fn();
  beforeEach(() => {
    upload.mockResolvedValue({ error: null });
    vi.mocked(createServiceRoleClient).mockReturnValue({
      storage: {
        from: () => ({ upload, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/careers/${path}` } }) }),
      },
    } as never);
  });
  const form = (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fd;
  };

  it("uploads under the session company's folder and returns the URL", async () => {
    const result = await uploadCareersImageAction(form(new File(["x"], "cover.png", { type: "image/png" })));
    const path = upload.mock.calls[0][0] as string;
    expect(path).toMatch(new RegExp(`^${COMPANY_A.id}/cover-[0-9a-f-]{36}\\.png$`));
    expect(result).toEqual({ ok: true, url: `https://cdn.test/careers/${path}` });
  });

  it.each([
    ["an SVG", new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }), "Use a PNG, JPEG or WebP image."],
    ["a 3 MB image", new File([new Uint8Array(3 * 1024 * 1024)], "x.png", { type: "image/png" }), "Images can be at most 2 MB."],
  ])("refuses %s", async (_, file, error) => {
    expect(await uploadCareersImageAction(form(file))).toEqual({ ok: false, error });
    expect(upload).not.toHaveBeenCalled();
  });
});
