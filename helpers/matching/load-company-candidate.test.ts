import { describe, expect, it } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { candidateOf } from "@/test/utils/candidates";
import { COMPANY_A } from "@/test/utils/recruiter";
import { APPLICATION, INJECTION_LINE, JOB_POST, RESUME_CONTENT } from "@/test/utils/matching";
import { buildScreeningInput } from "./build-input";
import { loadCompanyCandidate } from "./load-company-candidate";

const CANDIDATE = candidateOf(COMPANY_A, {
  full_name: "Meera Iyer",
  email: "meera@mail.test",
  phone: "+91 98765 43210",
  current_title: "Backend Engineer",
  current_company: "Initech",
  location: "bengaluru",
  experience_years: 4,
  skills: ["Go", "Postgres"],
  tags: ["referral-from-ceo"],
  notes: "Met at the meetup, seemed young",
  resume_content: RESUME_CONTENT as unknown as CandidateRow["resume_content"],
});
type CandidateRow = ReturnType<typeof candidateOf>;

describe("loadCompanyCandidate (BI-REQ-031, BI-SEC-004/005)", () => {
  it("reads only prompt-safe columns: no tags, notes or contact details", async () => {
    const admin = createSupabaseMock();
    admin.queue("company_candidates", { data: CANDIDATE, error: null });

    const loaded = await loadCompanyCandidate(admin.client, CANDIDATE.id);

    const [call] = admin.callsFor("company_candidates");
    const columns = String(call.chain.find((m) => m.method === "select")!.args[0]);
    expect(columns).not.toMatch(/tags|notes|email|phone|links/);
    expect(call.chain).toContainEqual({ method: "eq", args: ["id", CANDIDATE.id] });
    expect(loaded?.profile).toEqual({
      full_name: "Meera Iyer",
      current_title: "Backend Engineer",
      current_company: "Initech",
      location: "bengaluru",
      experience_years: 4,
      top_skills: ["Go", "Postgres"],
    });
    expect(loaded?.resume).toBe(CANDIDATE.resume_content);
    expect(loaded?.screenable).toBe(true);
  });

  it("is null for a missing candidate and not screenable for a name and email", async () => {
    const admin = createSupabaseMock();
    admin.queue("company_candidates", { data: null, error: null });
    expect(await loadCompanyCandidate(admin.client, CANDIDATE.id)).toBeNull();

    admin.queue("company_candidates", { data: candidateOf(COMPANY_A), error: null });
    expect((await loadCompanyCandidate(admin.client, CANDIDATE.id))?.screenable).toBe(false);
  });

  it("puts the candidate in the prompt sandboxed, without tags, notes or their name", async () => {
    const admin = createSupabaseMock();
    admin.queue("company_candidates", {
      data: { ...CANDIDATE, current_title: `Engineer ${INJECTION_LINE}` },
      error: null,
    });
    const loaded = (await loadCompanyCandidate(admin.client, CANDIDATE.id))!;

    const input = buildScreeningInput(JOB_POST, { ...APPLICATION, answers: [] }, loaded.profile, loaded.resume);

    const profile = input.match(/<candidate_profile>\n([\s\S]*?)\n<\/candidate_profile>/)![1];
    expect(profile).toContain("Initech");
    expect(profile).toContain(INJECTION_LINE);
    // Only ever inside a sandbox.
    expect(input.replace(/<([a-z_0-9]+)>\n[\s\S]*?\n<\/\1>/g, "")).not.toContain(INJECTION_LINE);
    expect(input).not.toMatch(/referral-from-ceo|meetup|young/);
    expect(input).not.toContain("Meera");
  });
});
