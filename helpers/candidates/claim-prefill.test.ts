import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { fillEmptyFromClaim } from "./claim-prefill-form";
import { resumeFromUpload } from "@/helpers/resumes/resume-from-upload";
import { hasPrefill, importClaimResume, loadClaimPrefill } from "./claim-prefill";
import { hashClaimToken } from "./claim-token";
import { RESUME_BUCKET } from "./resume-files";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/locations/aliases", () => ({ canonicalizeLocations: vi.fn() }));
vi.mock("@/helpers/resumes/resume-from-upload", () => ({ resumeFromUpload: vi.fn() }));

const TOKEN = "t".repeat(43);
const USER_ID = "00000000-0000-4000-8000-000000000001";
const USER = { id: USER_ID };
let admin: SupabaseMock;
let supabase: SupabaseMock;
let download: ReturnType<typeof vi.fn>;
let buckets: string[];

const candidate = (over: Record<string, unknown> = {}) => ({
  full_name: " Ada Lovelace ",
  current_title: "Backend Engineer",
  location: "bangalore",
  experience_years: 4,
  skills: ["Go", " "],
  links: { linkedin: "https://linkedin.com/in/ada", github: "https://github.com/ada", portfolio: "https://ada.dev" },
  resume_path: "company/cand/file.pdf",
  claimed_user_id: USER_ID,
  ...over,
});

const claim = (over: Record<string, unknown> = {}) => ({
  data: { used_by: USER_ID, company_info: { name: "Acme" }, company_candidates: candidate(), ...over },
  error: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(canonicalizeLocations).mockImplementation(async (names) => names.map((n) => (n === "bangalore" ? "Bengaluru" : n)));
  admin = createSupabaseMock();
  supabase = createSupabaseMock();
  buckets = [];
  download = vi.fn().mockResolvedValue({ data: new Blob([new Uint8Array(100)]), error: null });
  vi.mocked(resumeFromUpload).mockResolvedValue({ ok: true, resumeId: "r1" });
  Object.assign(admin.client, { storage: { from: (b: string) => (buckets.push(b), { download }) } });
  Object.assign(supabase.client, { storage: { from: (b: string) => (buckets.push(b), {}) } });
});

describe("loadClaimPrefill (BIT-105)", () => {
  it("maps the claimed candidate to onboarding fields, canonicalising the location", async () => {
    admin.queue("company_candidate_claims", claim());

    expect(await loadClaimPrefill(admin.client, TOKEN, USER_ID)).toEqual({
      companyName: "Acme",
      fields: {
        full_name: "Ada Lovelace",
        desired_roles: ["Backend Engineer"],
        preferred_locations: ["Bengaluru"],
        experience_years: 4,
        top_skills: ["Go"],
        linkedin_url: "https://linkedin.com/in/ada",
        github_url: "https://github.com/ada",
      },
      resume: { name: "Resume from Acme" },
    });
    const chain = admin.callsFor("company_candidate_claims")[0].chain;
    expect(chain).toContainEqual({ method: "eq", args: ["token_hash", hashClaimToken(TOKEN)] });
    expect(chain).toContainEqual({ method: "eq", args: ["used_by", USER_ID] });
    // Contact details, notes and tags are never read for the profile.
    expect(String(chain[0].args[0])).not.toMatch(/email|phone|notes|tags/);
  });

  it("refuses a link this user didn't use", async () => {
    admin.queue("company_candidate_claims", { data: null, error: null });
    expect(await loadClaimPrefill(admin.client, TOKEN, USER_ID)).toBeNull();
  });

  it("refuses a candidate claimed by someone else", async () => {
    admin.queue("company_candidate_claims", claim({ company_candidates: candidate({ claimed_user_id: "someone-else" }) }));
    expect(await loadClaimPrefill(admin.client, TOKEN, USER_ID)).toBeNull();
  });

  it("refuses a malformed token without a query", async () => {
    expect(await loadClaimPrefill(admin.client, "x", USER_ID)).toBeNull();
    expect(admin.callsFor("company_candidate_claims")).toHaveLength(0);
  });

  it("offers a Word file too (RE-REQ-023)", async () => {
    admin.queue("company_candidate_claims", claim({ company_candidates: candidate({ resume_path: "c/x.docx" }) }));
    expect((await loadClaimPrefill(admin.client, TOKEN, USER_ID))?.resume).toEqual({ name: "Resume from Acme" });
  });

  it("offers no resume when the candidate has no file", async () => {
    admin.queue("company_candidate_claims", claim({ company_candidates: candidate({ resume_path: null }) }));
    expect((await loadClaimPrefill(admin.client, TOKEN, USER_ID))?.resume).toBeNull();
  });
});

describe("hasPrefill", () => {
  const empty = {
    companyName: "Acme",
    resume: null,
    fields: {
      full_name: "Ada",
      desired_roles: [],
      preferred_locations: [],
      experience_years: null,
      top_skills: [],
      linkedin_url: null,
      github_url: null,
    },
  };
  it("needs a resume or something beyond the name", () => {
    expect(hasPrefill(null)).toBe(false);
    expect(hasPrefill(empty)).toBe(false);
    expect(hasPrefill({ ...empty, resume: { name: "r.pdf" } })).toBe(true);
    expect(hasPrefill({ ...empty, fields: { ...empty.fields, top_skills: ["Go"] } })).toBe(true);
  });
});

describe("importClaimResume (RE-REQ-023)", () => {
  it.each(["company/cand/file.pdf", "company/cand/file.docx"])("reads %s into the user's own resumes, not as primary", async (resume_path) => {
    admin.queue("company_candidate_claims", claim({ company_candidates: candidate({ resume_path }) }));

    expect(await importClaimResume(supabase.client, admin.client, USER, TOKEN)).toEqual({ ok: true, resumeId: "r1" });

    expect(download).toHaveBeenCalledWith(resume_path);
    const [client, user, file, options] = vi.mocked(resumeFromUpload).mock.calls[0];
    expect(client).toBe(supabase.client);
    expect(user).toBe(USER);
    expect(file.name).toBe(resume_path.split("/").pop());
    expect(file.size).toBe(100);
    expect(options).toEqual({ name: "Resume from Acme" });
  });

  it("only reads the company's file, and uploads nothing", async () => {
    admin.queue("company_candidate_claims", claim());

    await importClaimResume(supabase.client, admin.client, USER, TOKEN);

    expect(buckets).toEqual([RESUME_BUCKET]);
    expect(admin.callsFor("resumes")).toHaveLength(0);
    expect(admin.callsFor("company_candidates")).toHaveLength(0);
  });

  it("imports nothing for another person's or company's candidate", async () => {
    admin.queue("company_candidate_claims", claim({ company_candidates: candidate({ claimed_user_id: "someone-else" }) }));

    expect(await importClaimResume(supabase.client, admin.client, USER, TOKEN)).toMatchObject({ ok: false });
    expect(download).not.toHaveBeenCalled();
    expect(resumeFromUpload).not.toHaveBeenCalled();
  });

  it("imports nothing when the candidate has no file", async () => {
    admin.queue("company_candidate_claims", claim({ company_candidates: candidate({ resume_path: null }) }));

    expect(await importClaimResume(supabase.client, admin.client, USER, TOKEN)).toEqual({
      ok: false,
      error: "That resume is no longer available. Upload your own.",
    });
  });

  it("refuses a file over the applicant limit", async () => {
    admin.queue("company_candidate_claims", claim());
    download.mockResolvedValue({ data: new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]), error: null });

    expect(await importClaimResume(supabase.client, admin.client, USER, TOKEN)).toEqual({
      ok: false,
      error: "That resume is larger than 2 MB. Upload your own.",
    });
    expect(resumeFromUpload).not.toHaveBeenCalled();
  });

  it("passes on a failed parse", async () => {
    admin.queue("company_candidate_claims", claim());
    vi.mocked(resumeFromUpload).mockResolvedValue({ ok: false, error: "We couldn't read this file." });

    expect(await importClaimResume(supabase.client, admin.client, USER, TOKEN)).toEqual({
      ok: false,
      error: "We couldn't read this file.",
    });
  });
});

describe("fillEmptyFromClaim (BIT-105)", () => {
  const form = {
    full_name: "",
    desired_roles: [] as string[],
    preferred_locations: [] as string[],
    experience_years: "" as number | "",
    top_skills: [] as string[],
    linkedin_url: "",
    github_url: "",
    min_salary: 5,
  };
  const fields = {
    full_name: "Ada",
    desired_roles: ["Backend Engineer"],
    preferred_locations: ["Bengaluru"],
    experience_years: 4,
    top_skills: ["Go"],
    linkedin_url: "https://linkedin.com/in/ada",
    github_url: null,
  };

  it("fills only what's empty and leaves the rest alone", () => {
    expect(fillEmptyFromClaim(form, fields)).toEqual({
      ...form,
      full_name: "Ada",
      desired_roles: ["Backend Engineer"],
      preferred_locations: ["Bengaluru"],
      experience_years: 4,
      top_skills: ["Go"],
      linkedin_url: "https://linkedin.com/in/ada",
      github_url: "",
    });
  });

  it("never replaces what the person already has", () => {
    const mine = { ...form, full_name: "Ada L.", top_skills: ["Rust"], experience_years: 0 as number | "" };
    expect(fillEmptyFromClaim(mine, fields)).toMatchObject({ full_name: "Ada L.", top_skills: ["Rust"], experience_years: 0 });
  });
});
