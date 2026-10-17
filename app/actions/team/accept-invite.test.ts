import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { setUserAppMetadata } from "@/helpers/user/set-app-metadata";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { mockUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { inviteOf } from "@/test/utils/team";
import { PostHogEvent } from "@/utils/types";
import { acceptInviteAction } from "./accept-invite";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/user/set-app-metadata", () => ({ setUserAppMetadata: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));

const INVITE = inviteOf();
const INVITEE = mockUser({
  type: "company",
  onboardingComplete: false,
  id: "c4000000-0000-4000-8000-000000000001",
  email: "invitee@gmail.com",
});

let db: SupabaseMock;
let refreshSession: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: INVITEE });
  refreshSession = vi.fn(async () => ({ data: {}, error: null }));
  Object.assign((db.client as unknown as { auth: object }).auth, { refreshSession });
  vi.mocked(createClient).mockResolvedValue(db.client);
  vi.mocked(getUserFromRequest).mockResolvedValue(INVITEE);
  vi.mocked(setUserAppMetadata).mockResolvedValue({ error: null });
});

const accepted = () =>
  db.queueRpc("accept_company_invite", {
    data: { ok: true, company_id: COMPANY_A.id, role: "member" },
    error: null,
  });

describe("acceptInviteAction (TM-TEST-002)", () => {
  it("needs a signed-in user", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(null);

    expect(await acceptInviteAction({ token: INVITE.token })).toMatchObject({ ok: false });
    expect(db.calls).toHaveLength(0);
  });

  it("calls accept_company_invite with the token and the display name", async () => {
    accepted();

    await acceptInviteAction({ token: INVITE.token, displayName: " Ivy " });

    expect(db.callsFor("accept_company_invite")[0].chain[0].args[1]).toEqual({
      p_token: INVITE.token,
      p_display_name: "Ivy",
    });
  });

  it("sets app_metadata once, only after the RPC succeeds, then refreshes the session (TM-SEC-004)", async () => {
    const order: string[] = [];
    db.queueRpc("accept_company_invite", () => {
      order.push("rpc");
      return {
        data: { ok: true, company_id: COMPANY_A.id, role: { id: "r1", name: "Member" }, fell_back: false },
        error: null,
      };
    });
    vi.mocked(setUserAppMetadata).mockImplementation(async () => {
      order.push("metadata");
      return { error: null };
    });
    refreshSession.mockImplementation(async () => {
      order.push("refresh");
      return { data: {}, error: null };
    });

    expect(await acceptInviteAction({ token: INVITE.token })).toEqual({
      ok: true,
      roleName: "Member",
      fellBack: false,
    });

    expect(order).toEqual(["rpc", "metadata", "refresh"]);
    expect(setUserAppMetadata).toHaveBeenCalledTimes(1);
    expect(setUserAppMetadata).toHaveBeenCalledWith(INVITEE.id, { type: "company", onboarding_complete: true });
    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.TeamInviteAccepted,
      distinctId: INVITEE.id,
    });
  });

  it("reports that the invite's deleted role fell back to the default (RP-REQ-007)", async () => {
    db.queueRpc("accept_company_invite", {
      data: { ok: true, company_id: COMPANY_A.id, role: { id: "r1", name: "Member" }, fell_back: true },
      error: null,
    });
    vi.mocked(setUserAppMetadata).mockResolvedValue({ error: null } as never);

    expect(await acceptInviteAction({ token: INVITE.token })).toEqual({
      ok: true,
      roleName: "Member",
      fellBack: true,
    });
  });

  it.each([
    ["expired", "This invite link isn't valid any more. Ask for a new one."],
    ["used", "This invite link isn't valid any more. Ask for a new one."],
    ["wrong_email", "This invite was sent to a different email address. Sign in with that email to accept it."],
    ["seat_limit", "Your plan's seats are all in use. Upgrade to add more."],
    [
      "applicant",
      "This email already has a GetHired candidate account (signing in with Google creates one). Ask for an invite to a different email, such as your work email.",
    ],
  ])("maps %s and never touches app_metadata", async (reason, error) => {
    db.queueRpc("accept_company_invite", { data: { ok: false, reason }, error: null });

    expect(await acceptInviteAction({ token: INVITE.token })).toEqual({ ok: false, error });
    expect(setUserAppMetadata).not.toHaveBeenCalled();
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("never touches app_metadata on an RPC error", async () => {
    db.queueRpc("accept_company_invite", { data: null, error: { message: "boom" } });

    expect(await acceptInviteAction({ token: INVITE.token })).toMatchObject({ ok: false });
    expect(setUserAppMetadata).not.toHaveBeenCalled();
  });

  it("refuses a candidate account with the TM-REQ-003 message, before the RPC", async () => {
    vi.mocked(getUserFromRequest).mockResolvedValue(mockUser({ type: "applicant" }));

    expect(await acceptInviteAction({ token: INVITE.token })).toEqual({
      ok: false,
      error:
        "This email already has a GetHired candidate account (signing in with Google creates one). Ask for an invite to a different email, such as your work email.",
    });
    expect(db.callsFor("accept_company_invite")).toHaveLength(0);
  });

  it("rejects a malformed token without calling the RPC", async () => {
    expect(await acceptInviteAction({ token: "x" })).toMatchObject({ ok: false });
    expect(db.calls).toHaveLength(0);
  });
});
