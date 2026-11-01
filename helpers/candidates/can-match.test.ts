import { describe, expect, it } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { candidateCanMatch } from "./can-match";

const ID = "cc000000-0000-4000-8000-000000000001";
const BARE = { id: ID, current_title: null, current_company: "Acme", experience_years: 3, location: "pune", skills: [] };
const RESUME = { sections: [{ type: "experience", items: [{ bullets: [{ text: "Built things" }] }] }] };

describe("candidateCanMatch (CPT-036, CP-REQ-041)", () => {
  it("is true with a title or skills, without reading the resume", async () => {
    const db = createSupabaseMock();
    expect(await candidateCanMatch(db.client, { ...BARE, current_title: "Engineer" })).toBe(true);
    expect(await candidateCanMatch(db.client, { ...BARE, skills: ["Go"] })).toBe(true);
    expect(db.calls).toHaveLength(0);
  });

  it("reads the resume only when there's no title and no skills", async () => {
    const db = createSupabaseMock();
    db.queue("company_candidates", { data: { resume_content: RESUME }, error: null });
    expect(await candidateCanMatch(db.client, BARE)).toBe(true);
    const { chain } = db.callsFor("company_candidates")[0];
    expect(chain).toContainEqual({ method: "select", args: ["resume_content"] });
    expect(chain).toContainEqual({ method: "eq", args: ["id", ID] });

    db.queue("company_candidates", { data: { resume_content: null }, error: null });
    expect(await candidateCanMatch(db.client, BARE)).toBe(false);
    db.queue("company_candidates", { data: { resume_content: { sections: [] } }, error: null });
    expect(await candidateCanMatch(db.client, BARE)).toBe(false);
  });

  it("doesn't claim they can't match when the resume can't be read", async () => {
    const db = createSupabaseMock();
    db.queue("company_candidates", { data: null, error: { message: "boom" } });
    expect(await candidateCanMatch(db.client, BARE)).toBe(true);
  });
});
