import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { TRACKER_USER_ID, trackedRow } from "@/test/utils/tracker";
import { TRACKER_COPY } from "@/helpers/tracker/copy";
import { addTrackedApplicationAction } from "./add-tracked-application";
import { removeTrackedApplicationAction } from "./remove-tracked-application";
import { saveApplicationNoteAction } from "./save-application-note";
import { setTrackedStatusAction } from "./set-tracked-status";
import { updateTrackedApplicationAction } from "./update-tracked-application";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/tracker/board-match", () => ({ findBoardJobIdByUrl: vi.fn(async () => null) }));

const ID = "10000000-0000-4000-8000-000000000042";
const APP_ID = "20000000-0000-4000-8000-000000000001";
let mock: SupabaseMock;

const ownerFiltered = (target: string, column = "user_id") => {
  const chain = mock.callsFor(target).at(-1)!.chain;
  expect(chain).toContainEqual({ method: "eq", args: [column, TRACKER_USER_ID] });
};

beforeEach(async () => {
  vi.mocked(revalidatePath).mockClear();
  mock = createSupabaseMock();
  await setRequestUser(mockUser({ id: TRACKER_USER_ID }), mock.client);
});

describe("who may call the tracker actions", () => {
  const calls = {
    add: () => addTrackedApplicationAction({ jobTitle: "Engineer", companyName: "Acme" }),
    update: () => updateTrackedApplicationAction(ID, { notes: "x" }),
    status: () => setTrackedStatusAction({ id: ID, status: "offer" }),
    remove: () => removeTrackedApplicationAction(ID),
    note: () => saveApplicationNoteAction({ applicationId: APP_ID, notes: "x" }),
  };

  it.each(Object.entries(calls))("%s refuses a signed-out visitor", async (_, call) => {
    await setRequestUser(null);
    expect(await call()).toMatchObject({ ok: false, error: TRACKER_COPY.signIn });
    expect(mock.calls).toHaveLength(0);
  });

  it.each(Object.entries(calls))("%s refuses a company user", async (_, call) => {
    await setRequestUser(mockUser({ type: "company" }), mock.client);
    expect(await call()).toMatchObject({ ok: false, error: TRACKER_COPY.applicantsOnly });
    expect(mock.calls).toHaveLength(0);
  });
});

describe("addTrackedApplicationAction", () => {
  it("inserts for the session user with the given source, ignoring any user id in the input", async () => {
    mock.queue("tracked_applications", { data: { id: ID, status: "applied" }, error: null });
    const result = await addTrackedApplicationAction(
      { jobTitle: "Engineer", companyName: "Acme", user_id: "someone-else" } as never,
      "url",
    );

    expect(result).toMatchObject({ ok: true, created: true, id: ID });
    const insert = mock.callsFor("tracked_applications").at(-1)!.chain.find((c) => c.method === "insert")!;
    expect(insert.args[0]).toMatchObject({ user_id: TRACKER_USER_ID, source: "url" });
    expect(revalidatePath).toHaveBeenCalledWith("/my-jobs", "layout");
  });

  it("refuses invalid input with the first issue", async () => {
    const result = await addTrackedApplicationAction({ jobTitle: "", companyName: "Acme" });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(mock.calls).toHaveLength(0);
  });

  it("never takes a source other than manual or url", async () => {
    mock.queue("tracked_applications", { data: { id: ID, status: "applied" }, error: null });
    await addTrackedApplicationAction({ jobTitle: "Engineer", companyName: "Acme" }, "migrated" as never);
    const insert = mock.callsFor("tracked_applications").at(-1)!.chain.find((c) => c.method === "insert")!;
    expect(insert.args[0]).toMatchObject({ source: "manual" });
  });
});

describe("updateTrackedApplicationAction", () => {
  it("filters on the session user and the id", async () => {
    mock.queue("tracked_applications", { data: trackedRow({ id: ID }), error: null });
    expect(await updateTrackedApplicationAction(ID, { notes: "Called" })).toMatchObject({ ok: true });
    ownerFiltered("tracked_applications");
  });

  it("is not found for a foreign id", async () => {
    mock.queue("tracked_applications", { data: null, error: null });
    expect(await updateTrackedApplicationAction(ID, { notes: "x" })).toMatchObject({ ok: false, reason: "not_found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("is not found for a malformed id, without a query", async () => {
    expect(await updateTrackedApplicationAction("nope", { notes: "x" })).toMatchObject({ reason: "not_found" });
    expect(mock.calls).toHaveLength(0);
  });
});

describe("setTrackedStatusAction", () => {
  it("moves the card with its position for the session user", async () => {
    mock.queue("tracked_applications", { data: trackedRow({ id: ID, status: "offer" }), error: null });
    expect(await setTrackedStatusAction({ id: ID, status: "offer", position: 3.5 })).toMatchObject({ ok: true });
    expect(mock.callsFor("tracked_applications")[0].chain).toContainEqual({
      method: "update",
      args: [{ status: "offer", position: 3.5 }],
    });
    ownerFiltered("tracked_applications");
  });

  it("refuses a move back to saved", async () => {
    expect(await setTrackedStatusAction({ id: ID, status: "saved" as never })).toMatchObject({ reason: "invalid" });
    expect(mock.calls).toHaveLength(0);
  });
});

describe("removeTrackedApplicationAction", () => {
  it("deletes only the session user's card", async () => {
    mock.queue("tracked_applications", { data: [{ id: ID }], error: null });
    expect(await removeTrackedApplicationAction(ID)).toEqual({ ok: true, id: ID });
    ownerFiltered("tracked_applications");
  });

  it("is not found for a foreign id", async () => {
    mock.queue("tracked_applications", { data: [], error: null });
    expect(await removeTrackedApplicationAction(ID)).toMatchObject({ ok: false, reason: "not_found" });
  });
});

describe("saveApplicationNoteAction", () => {
  it("checks the application is the session user's before writing", async () => {
    mock.queue("applications", { data: { id: APP_ID }, error: null });
    expect(await saveApplicationNoteAction({ applicationId: APP_ID, notes: "Ping Friday" })).toEqual({ ok: true });
    ownerFiltered("applications", "applicant_user_id");
    const upsert = mock.callsFor("applicant_application_notes")[0].chain.find((c) => c.method === "upsert")!;
    expect(upsert.args[0]).toMatchObject({ application_id: APP_ID, user_id: TRACKER_USER_ID, notes: "Ping Friday" });
  });

  it("is not found for someone else's application", async () => {
    mock.queue("applications", { data: null, error: null });
    expect(await saveApplicationNoteAction({ applicationId: APP_ID, notes: "x" })).toMatchObject({ reason: "not_found" });
    expect(mock.callsFor("applicant_application_notes")).toHaveLength(0);
  });
});
