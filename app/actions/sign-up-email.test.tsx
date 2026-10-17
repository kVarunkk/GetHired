import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { setUserAppMetadata } from "@/helpers/user/set-app-metadata";
import { flushAfter } from "@/test/utils/after";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { inviteOf } from "@/test/utils/team";
import { sendEmail } from "@/utils/email";
import { sendSignupEmail } from "./sign-up-email";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/user/set-app-metadata", () => ({ setUserAppMetadata: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({ eventCaptureServerException: vi.fn() }));

const NEW_USER_ID = "c9000000-0000-4000-8000-000000000001";
const INVITE = inviteOf({ email: "priya@gmail.com" });

let service: SupabaseMock;
let generateLink: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  service = createSupabaseMock();
  generateLink = vi.fn(async () => ({
    data: { user: { id: NEW_USER_ID }, properties: { hashed_token: "hashed" } },
    error: null,
  }));
  (service.client as unknown as { auth: unknown }).auth = { admin: { generateLink } };
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  vi.mocked(setUserAppMetadata).mockResolvedValue({ error: null });
});

const inserts = (table: string) =>
  service.callsFor(table).filter((c) => c.chain.some((m) => m.method === "insert"));

async function confirmLink() {
  await flushAfter();
  const html = vi.mocked(sendEmail).mock.calls[0]?.[0].htmlContent ?? "";
  const match = html.match(/href="([^"]*auth\/confirm[^"]*)"/);
  return match ? new URL(match[1].replace(/&amp;/g, "&")) : null;
}

describe("sendSignupEmail: existing sign-ups (characterisation)", () => {
  it("creates a company account with a company_info row, not onboarded", async () => {
    expect(await sendSignupEmail("hr@acme.com", "password123", true)).toMatchObject({ success: true });

    expect(setUserAppMetadata).toHaveBeenCalledWith(NEW_USER_ID, { type: "company", onboarding_complete: false });
    expect(inserts("company_info")).toHaveLength(1);
    expect(inserts("user_info")).toHaveLength(0);
    expect((await confirmLink())?.searchParams.get("next")).toBe("/get-started?company=true");
  });

  it("creates an applicant account with a user_info row", async () => {
    expect(await sendSignupEmail("ada@example.com", "password123", false)).toMatchObject({ success: true });

    expect(setUserAppMetadata).toHaveBeenCalledWith(NEW_USER_ID, { type: "applicant", onboarding_complete: false });
    expect(inserts("user_info")).toHaveLength(1);
    expect(inserts("company_info")).toHaveLength(0);
  });
});

describe("sendSignupEmail: invite mode (TM-TEST-006, difference 5)", () => {
  const openInvite = () =>
    service.queue("company_invites", { data: { id: INVITE.row.id, email: INVITE.row.email }, error: null });

  it("looks the invite up by the token's hash, never the token", async () => {
    openInvite();

    await sendSignupEmail("priya@gmail.com", "password123", true, { inviteToken: INVITE.token });

    const [lookup] = service.callsFor("company_invites");
    expect(lookup.chain).toContainEqual({ method: "eq", args: ["token_hash", INVITE.row.token_hash] });
    expect(JSON.stringify(lookup.chain)).not.toContain(INVITE.token);
    for (const filter of ["accepted_at", "revoked_at"]) {
      expect(lookup.chain).toContainEqual({ method: "is", args: [filter, null] });
    }
    expect(lookup.chain.some((m) => m.method === "gt" && m.args[0] === "expires_at")).toBe(true);
  });

  it("refuses without an open invite, before creating a user", async () => {
    service.queue("company_invites", { data: null, error: null });

    expect(await sendSignupEmail("priya@gmail.com", "password123", true, { inviteToken: INVITE.token })).toEqual({
      success: false,
      error: "This invite link isn't valid any more. Ask for a new one.",
    });
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("refuses an email that isn't the invited one, case-insensitively", async () => {
    openInvite();
    expect(
      await sendSignupEmail("someone@else.com", "password123", true, { inviteToken: INVITE.token }),
    ).toMatchObject({ success: false });
    expect(generateLink).not.toHaveBeenCalled();

    openInvite();
    expect(
      await sendSignupEmail("PRIYA@Gmail.com", "password123", true, { inviteToken: INVITE.token }),
    ).toMatchObject({ success: true });
  });

  it("sets a company type, not onboarded, and inserts no company_info or user_info", async () => {
    openInvite();

    await sendSignupEmail("priya@gmail.com", "password123", true, { inviteToken: INVITE.token, fullName: "Priya S" });

    expect(setUserAppMetadata).toHaveBeenCalledWith(NEW_USER_ID, { type: "company", onboarding_complete: false });
    expect(inserts("company_info")).toHaveLength(0);
    expect(inserts("user_info")).toHaveLength(0);
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ options: { data: { full_name: "Priya S" } } }),
    );
  });

  it("sends the confirmation link back to the join page with the token intact", async () => {
    openInvite();

    await sendSignupEmail("priya@gmail.com", "password123", true, { inviteToken: INVITE.token });

    const next = (await confirmLink())?.searchParams.get("next");
    expect(next).toBe(`/company/join?token=${INVITE.token}`);
  });
});
