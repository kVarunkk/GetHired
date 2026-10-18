import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { OWNER_A } from "@/test/utils/team";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { outreachOf } from "@/test/utils/outreach";
import { withdrawOutreachAction } from "./withdraw-outreach";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));

const SENT = outreachOf("sent");
let db: SupabaseMock;

async function signIn(user = COMPANY_A.user) {
  db = createSupabaseMock({ user });
  db.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  await setRequestUser(user, db.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn();
});

describe("withdrawOutreachAction (ORT-024)", () => {
  it("withdraws only the company's own sent row", async () => {
    db.queue("candidate_outreach", { data: [{ id: SENT.id, candidate_user_id: PUBLIC_APPLICANT.id }], error: null });

    expect(await withdrawOutreachAction({ outreachId: SENT.id })).toEqual({ ok: true });

    const chain = db.callsFor("candidate_outreach")[0].chain;
    expect(chain).toContainEqual({ method: "update", args: [{ status: "withdrawn" }] });
    expect(chain).toContainEqual({ method: "eq", args: ["id", SENT.id] });
    expect(chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(chain).toContainEqual({ method: "eq", args: ["status", "sent"] });
    expect(eventCaptureServer).toHaveBeenCalledWith(
      expect.objectContaining({ distinctId: COMPANY_A.user.id, properties: { source: "manual" } }),
    );
  });

  it("returns { ok: false } when nothing was updated (another company's id, or answered)", async () => {
    db.queue("candidate_outreach", { data: [], error: null });

    expect(await withdrawOutreachAction({ outreachId: SENT.id })).toMatchObject({ ok: false });
  });

  it("refuses an applicant", async () => {
    await signIn(mockUser({ type: "applicant" }));
    expect(await withdrawOutreachAction({ outreachId: SENT.id })).toMatchObject({ ok: false });
    expect(db.callsFor("candidate_outreach")).toHaveLength(0);
  });

  it("rejects a non-UUID id", async () => {
    expect(await withdrawOutreachAction({ outreachId: "x" })).toMatchObject({ ok: false });
    expect(db.callsFor("candidate_outreach")).toHaveLength(0);
  });
});
