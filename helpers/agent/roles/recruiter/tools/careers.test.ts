import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCareersTools } from "./careers";
import { createRecruiterTools } from "./index";
import { execTool, recruiterToolContext } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { MEMBER_A } from "@/test/utils/team";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({ eventCaptureServerException: vi.fn() }));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: vi.fn() }));

const ABOUT = "a0000000-0000-4000-8000-0000000000a1";
const CUSTOM = "a0000000-0000-4000-8000-0000000000c1";
const PAGE = {
  id: COMPANY_A.id,
  slug: "acme",
  published: false,
  name: "Acme",
  description: "We build rockets.",
  accent_color: "#4f46e5",
  cover_url: "https://cdn.example.com/cover.png",
  sections: [
    { id: ABOUT, kind: "about", hidden: false },
    { id: CUSTOM, kind: "custom", title: "Culture", body: "Old", hidden: false },
  ],
  links: { linkedin: "https://linkedin.com/company/acme", x: "https://x.com/acme" },
};

let supabase: SupabaseMock;
let tools: ReturnType<typeof createCareersTools>;

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  tools = createCareersTools(recruiterToolContext(supabase.client));
});

const rpcArgs = (fn: string) => supabase.callsFor(fn)[0]?.chain[0].args[1] as Record<string, unknown> | undefined;

describe("getCareersPage tool", () => {
  it("returns the session company's page without section ids", async () => {
    supabase.queueRpc("get_my_careers_page", { data: PAGE, error: null });

    expect(await execTool(tools.getCareersPage, {})).toMatchObject({
      address: "/careers/acme",
      published: false,
      accentColor: "#4f46e5",
      sections: [
        { kind: "about", hidden: false },
        { kind: "custom", title: "Culture", body: "Old", hidden: false },
      ],
      about: "We build rockets.",
    });
  });

  it("explains when there's no page yet", async () => {
    supabase.queueRpc("get_my_careers_page", { data: null, error: null });
    expect(await execTool(tools.getCareersPage, {})).toMatchObject({ error: expect.stringContaining("setCareersAddress") });
  });
});

describe("updateCareersPage tool", () => {
  it("merges the changes onto the current page and keeps section ids", async () => {
    supabase.queueRpc("get_my_careers_page", { data: PAGE, error: null });
    supabase.queueRpc("save_careers_page", { data: { ok: true }, error: null });

    const result = await execTool(tools.updateCareersPage, {
      sections: [
        { kind: "custom", title: "Culture", body: "We ship weekly." },
        { kind: "perks", title: "Perks", items: [{ title: "Remote", text: "Work from anywhere" }] },
        { kind: "about" },
      ],
      links: { x: null, github: "https://github.com/acme" },
    });

    expect(result).toMatchObject({ updated: ["sections", "links"], address: "/careers/acme" });
    const args = rpcArgs("save_careers_page")!;
    expect(args.p_accent_color).toBe("#4f46e5");
    expect(args.p_cover_url).toBe("https://cdn.example.com/cover.png");
    expect(args.p_links).toEqual({ linkedin: "https://linkedin.com/company/acme", github: "https://github.com/acme" });
    const sections = args.p_sections as { id: string; kind: string }[];
    expect(sections.map((s) => s.kind)).toEqual(["custom", "perks", "about"]);
    expect(sections[0]).toMatchObject({ id: CUSTOM, body: "We ship weekly.", hidden: false });
    expect(sections[2].id).toBe(ABOUT);
    expect(sections[1].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects an unreadable accent before saving", async () => {
    supabase.queueRpc("get_my_careers_page", { data: PAGE, error: null });
    expect(await execTool(tools.updateCareersPage, { accentColor: "#ffffff" })).toEqual({
      error: "That colour is too light to read on a white page. Pick a darker one.",
    });
    expect(supabase.callsFor("save_careers_page")).toHaveLength(0);
  });

  it("refuses exclusionary page text", async () => {
    const result = await execTool(tools.updateCareersPage, {
      sections: [{ kind: "custom", title: "Who we hire", body: "Only candidates under 30." }],
    });
    expect(result).toMatchObject({ error: "NOT_JOB_RELATED" });
    expect(supabase.callsFor("get_my_careers_page")).toHaveLength(0);
  });
});

describe("setCareersAddress and setCareersPublished tools", () => {
  it("claims a valid address through the RPC", async () => {
    supabase.queue("company_info", { data: { careers_slug: "acme" }, error: null });
    supabase.queueRpc("claim_careers_slug", { data: { ok: true }, error: null });

    expect(await execTool(tools.setCareersAddress, { slug: "Acme-Rockets" })).toMatchObject({
      address: "/careers/acme-rockets",
    });
    expect(rpcArgs("claim_careers_slug")).toEqual({ p_slug: "acme-rockets" });
  });

  it("refuses a reserved address without calling the RPC", async () => {
    expect(await execTool(tools.setCareersAddress, { slug: "admin" })).toEqual({ error: "That address is reserved." });
    expect(supabase.callsFor("claim_careers_slug")).toHaveLength(0);
  });

  it("publishes the page", async () => {
    supabase.queueRpc("set_careers_published", { data: { ok: true }, error: null });
    supabase.queueRpc("get_my_careers_page", { data: PAGE, error: null });

    expect(await execTool(tools.setCareersPublished, { published: true })).toMatchObject({
      published: true,
      address: "/careers/acme",
    });
    expect(rpcArgs("set_careers_published")).toEqual({ p_published: true });
  });

  it("passes the RPC's refusal on", async () => {
    supabase.queueRpc("set_careers_published", { data: { ok: false, reason: "forbidden" }, error: null });
    expect(await execTool(tools.setCareersPublished, { published: true })).toEqual({
      error: "Your role can't edit the careers page.",
    });
  });
});

describe("careers tools for a member", () => {
  it("can read the page but not change it without careers.edit", () => {
    const memberTools = createRecruiterTools(
      recruiterToolContext(supabase.client, { user: MEMBER_A.user, company: MEMBER_A.myCompany }),
    );
    expect(memberTools).toHaveProperty("getCareersPage");
    for (const name of ["updateCareersPage", "setCareersAddress", "setCareersPublished"]) {
      expect(memberTools, name).not.toHaveProperty(name);
    }
  });
});
