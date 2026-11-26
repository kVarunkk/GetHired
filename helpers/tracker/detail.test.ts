import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { TRACKER_USER_ID, gethiredItem, trackedRow } from "@/test/utils/tracker";

vi.mock("server-only", () => ({}));
const listMyApplications = vi.fn();
vi.mock("./list-my-applications", () => ({ listMyApplications: (...args: unknown[]) => listMyApplications(...args) }));

import { loadTrackerDetail } from "./detail";

let mock: SupabaseMock;
const ctx = () => ({ supabase: mock.client, user: { id: TRACKER_USER_ID } });
const ID = "10000000-0000-4000-8000-000000000099";

beforeEach(() => {
  mock = createSupabaseMock();
  listMyApplications.mockReset();
});

describe("loadTrackerDetail (AT-REQ-023)", () => {
  it("loads a tracked card with its timeline, filtered on the session user", async () => {
    mock.queue("tracked_applications", { data: trackedRow({ id: ID }), error: null });
    mock.queue("tracked_application_events", {
      data: [{ id: "e1", kind: "created", from_status: null, to_status: "applied", created_at: "2026-11-01T00:00:00Z" }],
      error: null,
    });

    const detail = await loadTrackerDetail(ctx(), ID);

    expect(detail).toMatchObject({ kind: "tracked", events: [{ kind: "created", toStatus: "applied" }] });
    expect(mock.callsFor("tracked_applications")[0].chain).toContainEqual({ method: "eq", args: ["user_id", TRACKER_USER_ID] });
    expect(mock.callsFor("tracked_application_events")[0].chain).toContainEqual({ method: "eq", args: ["user_id", TRACKER_USER_ID] });
  });

  it("falls back to the user's GetHired application", async () => {
    mock.queue("tracked_applications", { data: null, error: null });
    listMyApplications.mockResolvedValue([gethiredItem({ id: ID })]);

    expect(await loadTrackerDetail(ctx(), ID)).toMatchObject({ kind: "gethired", item: { id: ID } });
  });

  it("is null for an id that isn't the user's", async () => {
    mock.queue("tracked_applications", { data: null, error: null });
    listMyApplications.mockResolvedValue([gethiredItem({ id: "someone-else" })]);

    expect(await loadTrackerDetail(ctx(), ID)).toBeNull();
  });
});
