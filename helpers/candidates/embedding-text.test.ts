import { describe, expect, it } from "vitest";
import {
  CANDIDATE_EMBEDDING_MAX_CHARS,
  candidateEmbeddingText,
  EMBEDDED_CANDIDATE_COLUMNS,
  type EmbeddedCandidate,
} from "./embedding-text";

const RESUME = {
  sections: [
    { type: "summary", items: [{ bullets: [{ text: "Backend engineer who likes queues." }] }] },
    { type: "experience", items: [{ bullets: [{ text: "Built the billing service" }] }] },
    { type: "projects", items: [{ bullets: [{ text: "A Postgres extension" }] }] },
    { type: "skills", items: [{ bullets: [{ text: "Kafka" }] }] },
  ],
};

const CANDIDATE: EmbeddedCandidate = {
  current_title: "Senior Engineer",
  current_company: "Acme",
  experience_years: 6,
  location: "bengaluru",
  skills: ["Go", "SQL"],
  resume_content: RESUME,
};

// The rest of a row, every field holding a distinctive string.
const PRIVATE = {
  full_name: "Zebulon Quixote",
  email: "zq-secret@example.com",
  phone: "+91 98765 43210",
  links: {
    linkedin: "https://linkedin.com/in/zq-linkedin",
    github: "https://github.com/zq-github",
    portfolio: "https://zq-portfolio.dev",
  },
  resume_url: "https://storage.example.com/zq-resume.pdf",
  resume_path: "company/zq-resume-path.pdf",
  tags: ["tag-veteran", "tag-pregnant"],
  notes: "note-religion-xyz",
};

describe("candidateEmbeddingText (CPT-031, CP-REQ-041)", () => {
  it("includes every embedded field", () => {
    const text = candidateEmbeddingText(CANDIDATE)!;
    expect(text).toContain("TITLE: Senior Engineer at Acme");
    expect(text).toContain("EXPERIENCE YEARS: 6");
    expect(text).toContain("LOCATION: bengaluru");
    expect(text).toContain("SKILLS: Go, SQL");
    expect(text).toContain("SUMMARY: Backend engineer who likes queues.");
    expect(text).toContain("EXPERIENCE: Built the billing service");
    expect(text).toContain("PROJECTS: A Postgres extension");
    expect(text).toContain("Kafka");
  });

  it("never includes the name, contact details, links, tags or notes (CP-SEC-001)", () => {
    const text = candidateEmbeddingText({ ...CANDIDATE, ...PRIVATE } as EmbeddedCandidate)!;
    for (const secret of ["Zebulon", "Quixote", "zq-", "98765", "tag-", "note-"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("lists exactly the columns it reads, none of them private", () => {
    expect([...EMBEDDED_CANDIDATE_COLUMNS].sort()).toEqual(
      ["current_company", "current_title", "experience_years", "location", "resume_content", "skills"].sort(),
    );
    const read = new Set<string>();
    const spy = new Proxy({ ...CANDIDATE, ...PRIVATE }, {
      get(target, key) {
        read.add(String(key));
        return target[key as keyof typeof target];
      },
    });
    candidateEmbeddingText(spy as EmbeddedCandidate);
    expect([...read].every((k) => (EMBEDDED_CANDIDATE_COLUMNS as readonly string[]).includes(k))).toBe(true);
  });

  it("is null with no title, no skills and no resume", () => {
    const bare = { ...CANDIDATE, current_title: null, skills: [], resume_content: null };
    expect(candidateEmbeddingText(bare)).toBeNull();
    expect(candidateEmbeddingText({ ...bare, current_title: "  " })).toBeNull();
    expect(candidateEmbeddingText({ ...bare, current_title: "Designer" })).toBe("TITLE: Designer at Acme\nEXPERIENCE YEARS: 6\nLOCATION: bengaluru");
    expect(candidateEmbeddingText({ ...bare, skills: ["Figma"] })).toContain("SKILLS: Figma");
    expect(candidateEmbeddingText({ ...bare, resume_content: RESUME })).toContain("SUMMARY:");
  });

  it("keeps zero years and leaves out missing fields", () => {
    const text = candidateEmbeddingText({ ...CANDIDATE, current_title: null, experience_years: 0, location: null })!;
    expect(text).toContain("COMPANY: Acme");
    expect(text).toContain("EXPERIENCE YEARS: 0");
    expect(text).not.toContain("LOCATION");
    expect(text).not.toContain("TITLE");
  });

  it("is capped", () => {
    const long = { ...CANDIDATE, skills: Array.from({ length: 3000 }, (_, i) => `skill${i}`) };
    expect(candidateEmbeddingText(long)!.length).toBe(CANDIDATE_EMBEDDING_MAX_CHARS);
  });
});
