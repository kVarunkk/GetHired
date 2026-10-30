import { beforeEach, describe, expect, it, vi } from "vitest";
import { embed } from "ai";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { updateUserEmbedding } from "./update-user-embedding";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@ai-sdk/google", () => ({ google: { embedding: vi.fn(() => "embedding-model") } }));
vi.mock("ai", () => ({ embed: vi.fn() }));

const USER = "a0000000-0000-4000-8000-000000000001";
const RESUME = {
  sections: [
    { type: "summary", items: [{ bullets: [{ text: "Backend engineer who likes queues." }] }] },
    {
      type: "experience",
      items: [
        { heading: "Acme", bullets: [{ text: "Built the billing service" }, { text: "Ran on-call" }] },
        { heading: "Globex", bullets: [{ text: "Moved jobs to Kafka" }] },
      ],
    },
    { type: "projects", items: [{ bullets: [{ text: "A Postgres extension" }] }] },
    { type: "skills", items: [{ bullets: [{ text: "Go" }, { text: "SQL" }] }] },
  ],
};
const PROFILE = {
  user_id: USER,
  top_skills: ["TypeScript", "Postgres"],
  desired_roles: ["Backend Engineer"],
  preferred_locations: ["bengaluru"],
  min_salary: 10,
  max_salary: 20,
  experience_years: 5,
  work_style_preferences: ["remote"],
  visa_sponsorship_required: false,
  career_goals_short_term: "Ship things",
  career_goals_long_term: "Lead a team",
  job_type: ["full-time"],
  industry_preferences: ["fintech"],
};

let db: SupabaseMock;
const embedded = () => vi.mocked(embed).mock.calls[0][0].value as string;

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  vi.mocked(embed).mockResolvedValue({ embedding: [0.1, 0.2] } as never);
});

// CPT-030: written against the code before the resume-text extraction moved
// to helpers/embeddings/resume-text.ts; the input must stay the same.
describe("updateUserEmbedding's input text (characterisation)", () => {
  it("is the profile and the resume's experience, projects and skills", async () => {
    db.queue("resumes", { data: { content: RESUME }, error: null });
    db.queue("user_info", { data: PROFILE, error: null });

    expect(await updateUserEmbedding(USER)).toEqual({ success: true });
    expect(embedded()).toMatchInlineSnapshot(`
      "PREFERRED ROLES: Backend Engineer
            
                  PREFERRED LOCATIONS: bengaluru
                  
                  PREFERRED SALARY: 10 - 20
                  
                  EXPERIENCE YEARS: 5 years
                  
                  SKILLS: TypeScript, Postgres, Go. SQL
                  
                  EXPERIENCE: Built the billing service. Ran on-call. Moved jobs to Kafka
                  
                  PROJECTS: A Postgres extension
                  
                  WORK STYLE: remote
                  
                  VISA SPONSORSHIP REQUIRED: false
                  
                  CAREER GOALS LONG TERM: Lead a team
                  
                  CAREER GOALS SHORT TERM: Ship things
                  
                  DESIRED JOB TYPE: full-time
                  
                  PREFERRED INDUSTRY:fintech"
    `);
    expect(vi.mocked(embed).mock.calls[0][0].providerOptions).toEqual({ google: { outputDimensionality: 768 } });
  });

  it("says N/A for the resume's sections when there's no resume", async () => {
    db.queue("resumes", { data: null, error: null });
    db.queue("user_info", { data: { ...PROFILE, top_skills: [] }, error: null });

    await updateUserEmbedding(USER);
    expect(embedded()).toContain("SKILLS: N/A");
    expect(embedded()).toContain("EXPERIENCE: N/A");
    expect(embedded()).toContain("PROJECTS: N/A");
  });
});
