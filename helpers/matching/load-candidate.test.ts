import { describe, expect, it } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { loadCandidate } from "./load-candidate";

const SENT = {
  name: "Backend",
  template: "classic",
  content: {
    version: 2,
    sections: [{ id: "s1", type: "skills", items: [{ id: "i1", bullets: [{ id: "b1", text: "Sent text" }] }] }],
  },
};

const LIVE = { sections: [{ type: "skills", items: [{ bullets: [{ id: "b1", text: "Edited later" }] }] }] };

describe("loadCandidate with an application's resume (RE-REQ-062)", () => {
  it("uses the snapshot and never reads the live resume", async () => {
    const db = createSupabaseMock();
    db.queue("user_info", { data: { user_id: "u1" }, error: null });

    const candidate = await loadCandidate(db.client, "u1", { resumeId: "r1", resumeSnapshot: SENT });

    expect(JSON.stringify(candidate?.resume)).toContain("Sent text");
    expect(db.callsFor("resumes")).toHaveLength(0);
  });

  it("falls back to the resume for an older application", async () => {
    const db = createSupabaseMock();
    db.queue("user_info", { data: { user_id: "u1" }, error: null });
    db.queue("resumes", { data: { content: LIVE }, error: null });

    const candidate = await loadCandidate(db.client, "u1", { resumeId: "r1", resumeSnapshot: null });

    expect(JSON.stringify(candidate?.resume)).toContain("Edited later");
    expect(db.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["id", "r1"] });
  });

  it("only ever selects a resume's content", async () => {
    const db = createSupabaseMock();
    db.queue("user_info", { data: { user_id: "u1" }, error: null });

    await loadCandidate(db.client, "u1", { resumeId: "r1" });

    expect(db.callsFor("resumes")[0].chain[0]).toEqual({ method: "select", args: ["content"] });
  });
});
