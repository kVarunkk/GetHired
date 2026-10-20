import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicClient } from "@/lib/supabase/public";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { getCareersJobs, getCareersPage, getMyCareersPreview, toCareersPage } from "./get-careers-page";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: vi.fn() }));

const RAW = {
  id: COMPANY_A.id,
  slug: "acme",
  published: true,
  name: "Acme",
  tag_line: "We build things",
  description: "About Acme",
  logo_url: "https://cdn.acme.test/logo.png",
  website: "https://acme.dev",
  headquarters: "Bengaluru",
  company_size: "11-50",
  industry: "Software",
  accent_color: "#4f46e5",
  cover_url: "javascript:alert(1)",
  sections: [{ id: "5c000000-0000-4000-8000-000000000001", kind: "about", hidden: false }, { kind: "bogus" }],
  links: { linkedin: "https://linkedin.com/company/acme" },
};

let db: SupabaseMock;
beforeEach(() => {
  db = createSupabaseMock();
  vi.mocked(createPublicClient).mockReturnValue(db.client);
});

describe("getCareersPage (CP-SEC-001)", () => {
  it("maps the RPC's public columns, dropping unsafe values", async () => {
    db.queueRpc("get_careers_page", { data: RAW, error: null });

    const result = await getCareersPage("Acme");

    expect(db.callsFor("get_careers_page")[0].chain[0].args).toEqual(["get_careers_page", { p_slug: "acme" }]);
    expect(result).toEqual({
      page: {
        id: COMPANY_A.id,
        slug: "acme",
        published: true,
        name: "Acme",
        tagLine: "We build things",
        description: "About Acme",
        logoUrl: "https://cdn.acme.test/logo.png",
        website: "https://acme.dev",
        headquarters: "Bengaluru",
        companySize: "11-50",
        industry: "Software",
        accentColor: "#4f46e5",
        coverUrl: null,
        sections: [RAW.sections[0]],
        links: { linkedin: "https://linkedin.com/company/acme" },
      },
    });
  });

  it("returns a redirect for a retired slug, and null for nothing", async () => {
    db.queueRpc("get_careers_page", { data: { redirect: "acme-careers" }, error: null });
    expect(await getCareersPage("acme")).toEqual({ redirect: "acme-careers" });
    db.queueRpc("get_careers_page", { data: null, error: null });
    expect(await getCareersPage("nope")).toBeNull();
  });

  it("rejects an accent that isn't #rrggbb", () => {
    expect(toCareersPage({ ...RAW, accent_color: "red;}" })?.accentColor).toBeNull();
  });
});

describe("getCareersJobs", () => {
  it("maps the jobs and drops malformed rows", async () => {
    db.queueRpc("get_careers_jobs", {
      data: [
        { id: "b1", all_jobs_id: "d1", title: "Backend", location: ["bengaluru"], workplace_type: "remote", department: "Eng", created_at: "2026-10-01" },
        { id: "b2", title: "No public id" },
      ],
      error: null,
    });

    const jobs = await getCareersJobs({ id: COMPANY_A.id, slug: "acme" });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: "b1", allJobsId: "d1", title: "Backend", workplaceType: "remote", department: "Eng" });
  });
});

describe("getMyCareersPreview (CP-REQ-008)", () => {
  it("reads the member's own page and jobs with their client", async () => {
    const user = createSupabaseMock();
    user.queueRpc("get_my_careers_page", { data: { ...RAW, published: false }, error: null });
    user.queueRpc("get_careers_jobs", { data: [], error: null });

    const preview = await getMyCareersPreview(user.client);

    expect(preview?.page.published).toBe(false);
    expect(user.callsFor("get_careers_jobs")[0].chain[0].args[1]).toEqual({ p_slug: "", p_preview: true });
  });
});
