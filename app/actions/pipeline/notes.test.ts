import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { addNote, deleteNote, updateNote } from "@/helpers/pipeline/notes";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { noteOf, pipelineAppOf } from "@/test/utils/pipeline";
import { PostHogEvent } from "@/utils/types";
import { addNoteAction } from "./add-note";
import { updateNoteAction } from "./update-note";
import { deleteNoteAction } from "./delete-note";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/pipeline/notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/pipeline/notes")>()),
  addNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
}));
vi.mock("server-only", () => ({}));

const APP = pipelineAppOf();
const NOTE = noteOf({ application_id: APP.id, rating: "yes" });

async function signIn(user = COMPANY_A.user) {
  const supabase = createSupabaseMock({ user });
  supabase.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });
  await setRequestUser(user, supabase.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn();
  vi.mocked(addNote).mockResolvedValue({ ok: true, note: NOTE });
  vi.mocked(updateNote).mockResolvedValue({ ok: true });
  vi.mocked(deleteNote).mockResolvedValue({ ok: true });
});

describe("addNoteAction (PLT-053)", () => {
  it("refuses a caller who isn't a company", async () => {
    await signIn(mockUser({ type: "applicant" }));

    expect(await addNoteAction({ applicationId: APP.id, body: "Hi" })).toMatchObject({ ok: false });
    expect(addNote).not.toHaveBeenCalled();
  });

  it.each([
    ["neither id", { body: "Hi" }],
    ["both ids", { body: "Hi", applicationId: APP.id, candidateUserId: PUBLIC_APPLICANT.id }],
    ["a non-UUID id", { body: "Hi", applicationId: "x" }],
    ["an unknown rating", { body: "Hi", applicationId: APP.id, rating: "maybe" }],
    ["an author id", { body: "Hi", applicationId: APP.id, authorUserId: PUBLIC_APPLICANT.id }],
  ])("rejects %s", async (_, input) => {
    expect(await addNoteAction(input as never)).toMatchObject({ ok: false });
    expect(addNote).not.toHaveBeenCalled();
  });

  it("adds the note as the session user, revalidates and captures pipeline_note_added", async () => {
    const result = await addNoteAction({ applicationId: APP.id, body: "Hi", rating: "yes" });

    expect(result).toEqual({ ok: true, note: NOTE });
    const [deps, params] = vi.mocked(addNote).mock.calls[0];
    expect(deps.company.id).toBe(COMPANY_A.id);
    expect(deps.user.id).toBe(COMPANY_A.user.id);
    expect(params).toEqual({ applicationId: APP.id, body: "Hi", rating: "yes" });
    expect(revalidatePath).toHaveBeenCalledWith(`/company/applicants/${APP.id}`);
    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.PipelineNoteAdded,
      distinctId: COMPANY_A.user.id,
      properties: { rated: true },
    });
  });

  it("passes refusals through without capturing", async () => {
    vi.mocked(addNote).mockResolvedValue({ ok: false, error: "Application not found." });

    expect(await addNoteAction({ applicationId: APP.id, body: "Hi" })).toEqual({
      ok: false,
      error: "Application not found.",
    });
    expect(eventCaptureServer).not.toHaveBeenCalled();
  });
});

describe("updateNoteAction and deleteNoteAction", () => {
  it("updates with the session user", async () => {
    expect(await updateNoteAction({ noteId: NOTE.id, body: "Edited", rating: null })).toEqual({ ok: true });

    const [deps, noteId, changes] = vi.mocked(updateNote).mock.calls[0];
    expect(deps.user.id).toBe(COMPANY_A.user.id);
    expect(noteId).toBe(NOTE.id);
    expect(changes).toEqual({ body: "Edited", rating: null });
  });

  it("deletes with the session user", async () => {
    expect(await deleteNoteAction({ noteId: NOTE.id })).toEqual({ ok: true });

    expect(vi.mocked(deleteNote).mock.calls[0][1]).toBe(NOTE.id);
  });

  it("validates the note id", async () => {
    expect(await updateNoteAction({ noteId: "x", body: "Edited", rating: null })).toMatchObject({ ok: false });
    expect(await deleteNoteAction({ noteId: "x" })).toMatchObject({ ok: false });
    expect(updateNote).not.toHaveBeenCalled();
    expect(deleteNote).not.toHaveBeenCalled();
  });

  it("refuses a caller who isn't a company", async () => {
    await signIn(mockUser({ type: "applicant" }));

    expect(await deleteNoteAction({ noteId: NOTE.id })).toMatchObject({ ok: false });
    expect(deleteNote).not.toHaveBeenCalled();
  });
});
