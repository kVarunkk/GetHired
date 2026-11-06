import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { createResume } from "@/helpers/resumes/create-resume";
import { deleteResume } from "@/helpers/resumes/delete-resume";
import { duplicateResume } from "@/helpers/resumes/duplicate-resume";
import { saveResume, type SaveResumeInput } from "@/helpers/resumes/save-resume";
import { upgradeResumeFromFile } from "@/helpers/resumes/upgrade-resume";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { createResumeAction } from "./create-resume";
import { deleteResumeAction } from "./delete-resume";
import { dismissResumeNotesAction } from "./dismiss-resume-notes";
import { duplicateResumeAction } from "./duplicate-resume";
import { saveResumeAction } from "./save-resume";
import { upgradeResumeAction } from "./upgrade-resume";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/resumes/create-resume", () => ({ createResume: vi.fn() }));
vi.mock("@/helpers/resumes/delete-resume", () => ({ deleteResume: vi.fn() }));
vi.mock("@/helpers/resumes/duplicate-resume", () => ({ duplicateResume: vi.fn() }));
vi.mock("@/helpers/resumes/save-resume", () => ({ saveResume: vi.fn() }));
vi.mock("@/helpers/resumes/upgrade-resume", () => ({ upgradeResumeFromFile: vi.fn() }));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER = "00000000-0000-4000-8000-000000000002";
const RESUME_ID = "22222222-2222-4222-8222-222222222222";

const SAVE_INPUT: SaveResumeInput = {
  resumeId: RESUME_ID,
  expectedRevision: 1,
  contact: { fullName: "Ada", links: [] },
  content: { version: 2, sections: [] },
  name: "Backend",
  template: "classic",
};

let supabase: SupabaseMock;

function signIn(user: { id: string } | null) {
  supabase = createSupabaseMock({ user });
  vi.mocked(createClient).mockResolvedValue(supabase.client);
}

beforeEach(() => {
  vi.clearAllMocks();
  signIn({ id: USER_ID });
  vi.mocked(saveResume).mockResolvedValue({ ok: true, revision: 2 });
  vi.mocked(createResume).mockResolvedValue({ ok: true, resumeId: RESUME_ID });
  vi.mocked(duplicateResume).mockResolvedValue({ ok: true, resumeId: RESUME_ID });
  vi.mocked(deleteResume).mockResolvedValue({ ok: true, reviewsDeleted: 0 });
  vi.mocked(upgradeResumeFromFile).mockResolvedValue({ ok: true, upgraded: true, coverage: 1 });
});

describe("no session", () => {
  it.each<[string, () => Promise<{ ok: boolean }>]>([
    ["save", () => saveResumeAction(SAVE_INPUT)],
    ["create", () => createResumeAction()],
    ["duplicate", () => duplicateResumeAction({ resumeId: RESUME_ID })],
    ["delete", () => deleteResumeAction({ resumeId: RESUME_ID })],
    ["dismiss", () => dismissResumeNotesAction({ resumeId: RESUME_ID })],
    ["upgrade", () => upgradeResumeAction({ resumeId: RESUME_ID })],
  ])("%s refuses", async (_label, run) => {
    signIn(null);

    expect(await run()).toMatchObject({ ok: false });

    expect(supabase.calls).toHaveLength(0);
    expect(saveResume).not.toHaveBeenCalled();
    expect(createResume).not.toHaveBeenCalled();
    expect(duplicateResume).not.toHaveBeenCalled();
    expect(deleteResume).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("input can't carry a user id", () => {
  it.each<[string, () => Promise<{ ok: boolean }>]>([
    ["create", () => createResumeAction({ user_id: OTHER_USER } as never)],
    ["duplicate", () => duplicateResumeAction({ resumeId: RESUME_ID, user_id: OTHER_USER } as never)],
    ["delete", () => deleteResumeAction({ resumeId: RESUME_ID, user_id: OTHER_USER } as never)],
    ["dismiss", () => dismissResumeNotesAction({ resumeId: RESUME_ID, user_id: OTHER_USER } as never)],
    ["upgrade", () => upgradeResumeAction({ resumeId: RESUME_ID, user_id: OTHER_USER } as never)],
  ])("%s refuses it", async (_label, run) => {
    expect(await run()).toMatchObject({ ok: false });
    expect(supabase.calls).toHaveLength(0);
  });

  it("save always writes as the session user", async () => {
    await saveResumeAction({ ...SAVE_INPUT, user_id: OTHER_USER } as SaveResumeInput);

    expect(vi.mocked(saveResume).mock.calls[0][1]).toMatchObject({ id: USER_ID });
  });
});

describe("a bad id", () => {
  it.each<[string, () => Promise<{ ok: boolean }>]>([
    ["duplicate", () => duplicateResumeAction({ resumeId: "nope" })],
    ["delete", () => deleteResumeAction({ resumeId: "nope" })],
    ["dismiss", () => dismissResumeNotesAction({ resumeId: "nope" })],
    ["upgrade", () => upgradeResumeAction({ resumeId: "nope" })],
  ])("%s refuses", async (_label, run) => {
    expect(await run()).toMatchObject({ ok: false });
  });
});

describe("saveResumeAction", () => {
  it("saves from the page, and refreshes the list and the resume", async () => {
    expect(await saveResumeAction(SAVE_INPUT)).toEqual({ ok: true, revision: 2 });

    expect(saveResume).toHaveBeenCalledWith(supabase.client, expect.objectContaining({ id: USER_ID }), SAVE_INPUT, { surface: "page" });
    expect(revalidatePath).toHaveBeenCalledWith("/resume");
    expect(revalidatePath).toHaveBeenCalledWith(`/resume/${RESUME_ID}`);
  });

  it("passes on a failed save, refreshing nothing", async () => {
    vi.mocked(saveResume).mockResolvedValue({ ok: false, code: "RESUME_CHANGED", error: "Reload." });

    expect(await saveResumeAction(SAVE_INPUT)).toMatchObject({ ok: false, code: "RESUME_CHANGED" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

it("createResumeAction creates and refreshes the list", async () => {
  expect(await createResumeAction({ name: "Backend" })).toEqual({ ok: true, resumeId: RESUME_ID });

  expect(createResume).toHaveBeenCalledWith(supabase.client, expect.objectContaining({ id: USER_ID }), { name: "Backend" });
  expect(revalidatePath).toHaveBeenCalledWith("/resume");
});

it("duplicateResumeAction copies and refreshes the list", async () => {
  await duplicateResumeAction({ resumeId: RESUME_ID });

  expect(duplicateResume).toHaveBeenCalledWith(supabase.client, expect.objectContaining({ id: USER_ID }), { resumeId: RESUME_ID });
  expect(revalidatePath).toHaveBeenCalledWith("/resume");
});

it("deleteResumeAction deletes and refreshes the list and the resume", async () => {
  expect(await deleteResumeAction({ resumeId: RESUME_ID })).toEqual({ ok: true, reviewsDeleted: 0 });

  expect(revalidatePath).toHaveBeenCalledWith("/resume");
  expect(revalidatePath).toHaveBeenCalledWith(`/resume/${RESUME_ID}`);
});

describe("dismissResumeNotesAction (RE-REQ-016)", () => {
  it("clears the notes on the user's resume, leaving the revision alone", async () => {
    supabase.queue("resumes", { data: [{ id: RESUME_ID }], error: null });

    expect(await dismissResumeNotesAction({ resumeId: RESUME_ID })).toEqual({ ok: true });

    const { chain } = supabase.callsFor("resumes")[0];
    expect(chain).toContainEqual({ method: "update", args: [{ parse_notes: null }] });
    expect(chain).toContainEqual({ method: "eq", args: ["id", RESUME_ID] });
    expect(chain).toContainEqual({ method: "eq", args: ["user_id", USER_ID] });
    expect(revalidatePath).toHaveBeenCalledWith(`/resume/${RESUME_ID}`);
  });

  it("fails for a resume that isn't the user's", async () => {
    supabase.queue("resumes", { data: [], error: null });

    expect(await dismissResumeNotesAction({ resumeId: RESUME_ID })).toMatchObject({ ok: false });
  });
});

describe("upgradeResumeAction (RE-REQ-095)", () => {
  const V1 = { id: RESUME_ID, name: "cv.pdf", content: {}, revision: 1, schema_version: 1, resume_path: "p" };

  it("upgrades the user's version 1 resume", async () => {
    supabase.queue("resumes", { data: V1, error: null });

    expect(await upgradeResumeAction({ resumeId: RESUME_ID })).toEqual({ ok: true });

    expect(supabase.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["user_id", USER_ID] });
    expect(upgradeResumeFromFile).toHaveBeenCalledWith(V1);
    expect(revalidatePath).toHaveBeenCalledWith(`/resume/${RESUME_ID}`);
  });

  it("leaves a version 2 resume alone", async () => {
    supabase.queue("resumes", { data: { ...V1, schema_version: 2 }, error: null });

    expect(await upgradeResumeAction({ resumeId: RESUME_ID })).toEqual({ ok: true });
    expect(upgradeResumeFromFile).not.toHaveBeenCalled();
  });

  it("never reaches the service role for another user's resume", async () => {
    supabase.queue("resumes", { data: null, error: null });

    expect(await upgradeResumeAction({ resumeId: RESUME_ID })).toMatchObject({ ok: false });
    expect(upgradeResumeFromFile).not.toHaveBeenCalled();
  });

  it("passes on a failed upgrade", async () => {
    supabase.queue("resumes", { data: V1, error: null });
    vi.mocked(upgradeResumeFromFile).mockResolvedValue({ ok: false, error: "Upload it again." });

    expect(await upgradeResumeAction({ resumeId: RESUME_ID })).toEqual({ ok: false, error: "Upload it again." });
  });
});
