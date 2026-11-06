import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseMock, type MockResponse, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { backfillApplicationSnapshots } from "./backfill-snapshots";

const CONTENT = {
  version: 2,
  sections: [{ id: "s1", type: "experience", items: [{ id: "i1", bullets: [{ id: "b1", text: "Built it" }] }] }],
};

const resume = {
  id: "r1",
  name: "Backend",
  content: CONTENT,
  contact: { fullName: "Ada", email: "ada@example.com", links: [] },
  template: "compact",
  schema_version: 2,
};

let db: SupabaseMock;

const app = (overrides: Record<string, unknown> = {}) => ({
  id: "app1",
  resume_id: "r1",
  resumes: resume,
  ...overrides,
});

const updates = () =>
  db
    .callsFor("applications")
    .flatMap((c) => c.chain.filter((m) => m.method === "update"))
    .map((m) => m.args[0] as Record<string, unknown>);

const updateChains = () => db.callsFor("applications").filter((c) => c.chain.some((m) => m.method === "update"));

/**
 * Reads answer from `pages`, in order; a read past the end is an empty page.
 * Writes succeed, except the ones `failWrite` names. Every call gets the same
 * responder, so a write can't consume a page meant for a read.
 */
function queueReads(pages: unknown[][], { failWrite }: { failWrite?: (call: number) => boolean } = {}) {
  let page = 0;
  let writes = 0;
  const answer = (call: RecordedCall): MockResponse => {
    if (call.chain.some((m) => m.method === "update")) {
      const failed = failWrite?.(writes++) ?? false;
      return { data: null, error: failed ? new Error("boom") : null };
    }
    return { data: pages[page++] ?? [], error: null };
  };
  // Enough responders for a full page of reads and every write it makes.
  for (let i = 0; i < 1_000; i++) db.queue("applications", answer);
}

beforeEach(() => {
  db = createSupabaseMock();
});

describe("backfillApplicationSnapshots (RE-REQ-066/097)", () => {
  it("fills a null snapshot from the linked resume", async () => {
    queueReads([[app()]]);

    const counts = await backfillApplicationSnapshots(db.client as never);

    expect(counts).toEqual({ filled: 1, skipped: 0, failed: 0 });
    expect(updates()[0]).toEqual({
      resume_snapshot: { name: "Backend", template: "compact", content: CONTENT },
      resume_contact_snapshot: resume.contact,
    });
    const read = db.callsFor("applications")[0].chain;
    expect(read).toContainEqual({ method: "is", args: ["resume_snapshot", null] });
    // The write names the one application it fills.
    expect(updateChains()[0].chain).toContainEqual({ method: "eq", args: ["id", "app1"] });
  });

  it("skips an imported candidate, which has no linked resume", async () => {
    queueReads([[app({ resume_id: null, resumes: null })]]);

    const counts = await backfillApplicationSnapshots(db.client as never);

    expect(counts).toEqual({ filled: 0, skipped: 1, failed: 0 });
    expect(updates()).toEqual([]);
  });

  it("skips a resume that has no content yet, rather than writing an empty snapshot", async () => {
    queueReads([[app({ resumes: { ...resume, content: null } })]]);

    const counts = await backfillApplicationSnapshots(db.client as never);

    expect(counts).toEqual({ filled: 0, skipped: 1, failed: 0 });
    expect(updates()).toEqual([]);
  });

  it("reads a resume PostgREST embeds as a one-row array", async () => {
    queueReads([[app({ resumes: [resume] })]]);

    await backfillApplicationSnapshots(db.client as never);

    expect(updates()).toHaveLength(1);
  });

  it("writes nothing in a dry run, but counts what it would fill", async () => {
    queueReads([[app(), app({ id: "app2" })]]);

    const counts = await backfillApplicationSnapshots(db.client as never, { dryRun: true });

    expect(counts).toEqual({ filled: 2, skipped: 0, failed: 0 });
    expect(updates()).toEqual([]);
  });

  it("counts a failed write and carries on", async () => {
    queueReads([[app(), app({ id: "app2" })]], { failWrite: (call) => call === 0 });

    const counts = await backfillApplicationSnapshots(db.client as never);

    expect(counts).toEqual({ filled: 1, skipped: 0, failed: 1 });
  });

  it("is re-runnable: a second run finds no null snapshots and writes nothing", async () => {
    queueReads([[app()], []]);

    await backfillApplicationSnapshots(db.client as never);
    const second = await backfillApplicationSnapshots(db.client as never);

    expect(second).toEqual({ filled: 0, skipped: 0, failed: 0 });
    expect(updates()).toHaveLength(1);
  });

  it("pages until it gets a short page", async () => {
    const many = Array.from({ length: 500 }, (_, i) => app({ id: `app${i}` }));
    queueReads([many, [app({ id: "last" })]]);

    const counts = await backfillApplicationSnapshots(db.client as never);

    expect(counts.filled).toBe(501);
    expect(db.callsFor("applications").filter((c) => c.chain.some((m) => m.method === "range"))).toHaveLength(2);
    expect(db.callsFor("applications").find((c) => c.chain.some((m) => m.method === "range" && m.args[0] === 500))).toBeTruthy();
  });

  it("throws when the read fails, rather than reporting a partial run", async () => {
    db.queue("applications", { data: null, error: new Error("boom") });

    await expect(backfillApplicationSnapshots(db.client as never)).rejects.toThrow("boom");
  });
});
