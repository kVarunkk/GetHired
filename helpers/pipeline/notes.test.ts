import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { noteOf, pipelineAppOf } from "@/test/utils/pipeline";
import {
  MAX_NOTE_LENGTH,
  NOTE_FAIRNESS_ERROR,
  addNote,
  deleteNote,
  listNotes,
  ratingSummary,
  updateNote,
} from "./notes";

vi.mock("server-only", () => ({}));

const company = { id: COMPANY_A.id, name: COMPANY_A.info.name, email: COMPANY_A.info.email };
const user = { ...COMPANY_A.user, user_metadata: { full_name: "Asha Rao" } } as typeof COMPANY_A.user;
const APP = pipelineAppOf();
const NOTE_ID = "70e00000-0000-4000-8000-0000000000aa";

let db: SupabaseMock;
const ctx = () => ({ supabase: db.client, company, user });

const methodArgs = (call: RecordedCall, method: string) =>
  call.chain.find((m) => m.method === method)?.args;
const inserted = (table: string) =>
  db.callsFor(table).flatMap((c) => {
    const args = methodArgs(c, "insert");
    return args ? [args[0] as Record<string, unknown>] : [];
  });

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user });
});

describe("addNote (PLT-052)", () => {
  /** The application belongs to the company; the insert returns the note. */
  function onOwnApplication() {
    db.queue("applications", { data: { id: APP.id, applicant_user_id: PUBLIC_APPLICANT.id }, error: null });
    db.queue("candidate_notes", { data: noteOf({ id: NOTE_ID, application_id: APP.id }), error: null });
    db.queue("application_events", { data: null, error: null });
  }

  it("trims the body and saves it as the session user, with a note_added event", async () => {
    onOwnApplication();

    const result = await addNote(ctx(), {
      applicationId: APP.id,
      body: "  Strong systems answers.  ",
      rating: "yes",
    });

    expect(result).toEqual({ ok: true, note: expect.objectContaining({ id: NOTE_ID }) });
    expect(inserted("candidate_notes")).toEqual([
      {
        company_id: COMPANY_A.id,
        candidate_user_id: PUBLIC_APPLICANT.id,
        application_id: APP.id,
        author_user_id: user.id,
        author_name: "Asha Rao",
        body: "Strong systems answers.",
        rating: "yes",
      },
    ]);
    expect(inserted("application_events")).toEqual([
      {
        company_id: COMPANY_A.id,
        application_id: APP.id,
        candidate_user_id: PUBLIC_APPLICANT.id,
        actor_user_id: user.id,
        actor_name: "Asha Rao",
        type: "note_added",
        payload: { note_id: NOTE_ID, rated: true },
      },
    ]);
    // The event never carries the body.
    expect(JSON.stringify(inserted("application_events"))).not.toContain("Strong systems");
  });

  it("only accepts an application on the company's own jobs", async () => {
    db.queue("applications", { data: null, error: null });

    const result = await addNote(ctx(), { applicationId: APP.id, body: "Hi" });

    expect(result).toEqual({ ok: false, error: "Application not found." });
    const [load] = db.callsFor("applications");
    expect(load.chain).toContainEqual({ method: "eq", args: ["job_postings.company_id", COMPANY_A.id] });
    expect(db.callsFor("candidate_notes")).toHaveLength(0);
  });

  it("accepts a talent-pool candidate the company can view", async () => {
    db.queueRpc("company_can_view_candidate", { data: true, error: null });
    db.queue("candidate_notes", { data: noteOf({ id: NOTE_ID }), error: null });

    const result = await addNote(ctx(), { candidateUserId: PUBLIC_APPLICANT.id, body: "Saw their OSS work." });

    expect(result.ok).toBe(true);
    expect(db.callsFor("company_can_view_candidate")[0].chain[0].args).toEqual([
      "company_can_view_candidate",
      { p_user_id: PUBLIC_APPLICANT.id },
    ]);
    expect(inserted("candidate_notes")[0]).toMatchObject({ application_id: null, rating: null });
    expect(inserted("application_events")[0]).toMatchObject({
      application_id: null,
      payload: { note_id: NOTE_ID, rated: false },
    });
  });

  it("refuses a candidate the company can't view", async () => {
    db.queueRpc("company_can_view_candidate", { data: false, error: null });

    const result = await addNote(ctx(), { candidateUserId: PUBLIC_APPLICANT.id, body: "Hi" });

    expect(result).toEqual({ ok: false, error: "Candidate not found." });
    expect(db.callsFor("candidate_notes")).toHaveLength(0);
  });

  it.each([
    ["an empty body", "   "],
    ["a body over 5,000 chars", "x".repeat(MAX_NOTE_LENGTH + 1)],
  ])("rejects %s", async (_, body) => {
    const result = await addNote(ctx(), { applicationId: APP.id, body });

    expect(result).toEqual({ ok: false, error: "Notes are 1 to 5,000 characters." });
    expect(db.calls).toHaveLength(0);
  });

  it("rejects text about a protected characteristic", async () => {
    const result = await addNote(ctx(), { applicationId: APP.id, body: "Seems too old for a startup." });

    expect(result).toEqual({
      ok: false,
      error: NOTE_FAIRNESS_ERROR,
    });
    expect(db.calls).toHaveLength(0);
  });

  it("rejects a malformed id or neither id without querying", async () => {
    expect(await addNote(ctx(), { applicationId: "nope", body: "Hi" })).toEqual({
      ok: false,
      error: "Application not found.",
    });
    expect(await addNote(ctx(), { body: "Hi" })).toEqual({ ok: false, error: "Candidate not found." });
    expect(db.calls).toHaveLength(0);
  });

  it("still returns the note when the event insert fails", async () => {
    db.queue("applications", { data: { id: APP.id, applicant_user_id: PUBLIC_APPLICANT.id }, error: null });
    db.queue("candidate_notes", { data: noteOf({ id: NOTE_ID }), error: null });
    db.queue("application_events", { data: null, error: { message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await addNote(ctx(), { applicationId: APP.id, body: "Hi" })).ok).toBe(true);
  });
});

describe("updateNote and deleteNote", () => {
  it("updateNote filters by the author and the company", async () => {
    db.queue("candidate_notes", { data: [{ id: NOTE_ID }], error: null });

    const result = await updateNote(ctx(), NOTE_ID, { body: " Edited ", rating: "strong_yes" });

    expect(result).toEqual({ ok: true });
    const [call] = db.callsFor("candidate_notes");
    expect(methodArgs(call, "update")).toEqual([{ body: "Edited", rating: "strong_yes" }]);
    expect(call.chain).toContainEqual({ method: "eq", args: ["id", NOTE_ID] });
    expect(call.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(call.chain).toContainEqual({ method: "eq", args: ["author_user_id", user.id] });
  });

  it("updateNote reports someone else's note as not found", async () => {
    db.queue("candidate_notes", { data: [], error: null });

    expect(await updateNote(ctx(), NOTE_ID, { body: "Edited", rating: null })).toEqual({
      ok: false,
      error: "Note not found.",
    });
  });

  it("updateNote validates like addNote", async () => {
    expect(await updateNote(ctx(), NOTE_ID, { body: "", rating: null })).toEqual({
      ok: false,
      error: "Notes are 1 to 5,000 characters.",
    });
    expect(db.calls).toHaveLength(0);
  });

  it("deleteNote filters by the author and the company", async () => {
    db.queue("candidate_notes", { data: [{ id: NOTE_ID }], error: null });

    expect(await deleteNote(ctx(), NOTE_ID)).toEqual({ ok: true });
    const [call] = db.callsFor("candidate_notes");
    expect(call.chain.some((m) => m.method === "delete")).toBe(true);
    expect(call.chain).toContainEqual({ method: "eq", args: ["author_user_id", user.id] });
    expect(call.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it("deleteNote reports a missing note", async () => {
    db.queue("candidate_notes", { data: [], error: null });

    expect(await deleteNote(ctx(), NOTE_ID)).toEqual({ ok: false, error: "Note not found." });
  });
});

describe("listNotes", () => {
  it.each([
    [{ applicationId: APP.id }, "application_id", APP.id],
    [{ candidateUserId: PUBLIC_APPLICANT.id }, "candidate_user_id", PUBLIC_APPLICANT.id],
  ] as const)("lists by %o, newest first", async (by, column, value) => {
    const notes = [noteOf(), noteOf()];
    db.queue("candidate_notes", { data: notes, error: null });

    expect(await listNotes(ctx(), by)).toEqual(notes);
    const [call] = db.callsFor("candidate_notes");
    expect(call.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(call.chain).toContainEqual({ method: "eq", args: [column, value] });
    expect(call.chain).toContainEqual({ method: "order", args: ["created_at", { ascending: false }] });
  });

  it("throws on a database error", async () => {
    db.queue("candidate_notes", { data: null, error: { message: "boom" } });

    await expect(listNotes(ctx(), { applicationId: APP.id })).rejects.toThrow(/boom/);
  });
});

describe("ratingSummary", () => {
  it("scores strong_no..strong_yes 1–4 and counts each", () => {
    const summary = ratingSummary([
      noteOf({ rating: "strong_yes" }),
      noteOf({ rating: "yes" }),
      noteOf({ rating: "no" }),
      noteOf({ rating: null }),
    ]);

    expect(summary).toEqual({
      count: 3,
      average: 3,
      byRating: { strong_no: 0, no: 1, yes: 1, strong_yes: 1 },
    });
  });

  it("has a null average with no ratings", () => {
    expect(ratingSummary([noteOf()])).toEqual({
      count: 0,
      average: null,
      byRating: { strong_no: 0, no: 0, yes: 0, strong_yes: 0 },
    });
  });
});
