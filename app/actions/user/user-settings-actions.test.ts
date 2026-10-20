import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidateTag } from "next/cache";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { setEmailPreferenceAction } from "./set-email-preference";
import { setProfileVisibilityAction } from "./set-profile-visibility";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

let db: SupabaseMock;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: PUBLIC_APPLICANT.user });
  await setRequestUser(PUBLIC_APPLICANT.user, db.client);
});

describe("setEmailPreferenceAction (BW-F01)", () => {
  it.each(["is_job_digest_active", "is_promotion_active"] as const)(
    "writes only %s for the session user",
    async (key) => {
      expect(await setEmailPreferenceAction({ key, value: false })).toEqual({ ok: true });

      const chain = db.callsFor("user_info")[0].chain;
      expect(chain).toContainEqual({ method: "update", args: [{ [key]: false }] });
      expect(chain).toContainEqual({ method: "eq", args: ["user_id", PUBLIC_APPLICANT.id] });
    },
  );

  it("rejects any other column", async () => {
    const result = await setEmailPreferenceAction({ key: "email" as never, value: true });
    expect(result).toMatchObject({ ok: false });
    expect(db.callsFor("user_info")).toHaveLength(0);
  });

  it("refuses a signed-out caller", async () => {
    await setRequestUser(null);
    expect(await setEmailPreferenceAction({ key: "is_promotion_active", value: true })).toMatchObject({
      ok: false,
    });
  });

  it("reports a failed write", async () => {
    db.queue("user_info", { data: null, error: { message: "denied" } });
    expect(await setEmailPreferenceAction({ key: "is_promotion_active", value: true })).toMatchObject({
      ok: false,
    });
  });
});

describe("setProfileVisibilityAction (BW-F01)", () => {
  it("writes only is_public and refreshes the cached profile", async () => {
    expect(await setProfileVisibilityAction({ isPublic: false })).toEqual({ ok: true });

    const chain = db.callsFor("user_info")[0].chain;
    expect(chain).toContainEqual({ method: "update", args: [{ is_public: false }] });
    expect(chain).toContainEqual({ method: "eq", args: ["user_id", PUBLIC_APPLICANT.id] });
    expect(revalidateTag).toHaveBeenCalledWith(`profile-${PUBLIC_APPLICANT.id}`);
  });

  it("rejects extra columns", async () => {
    const result = await setProfileVisibilityAction({ isPublic: true, email: "x@y.z" } as never);
    expect(result).toMatchObject({ ok: false });
    expect(db.callsFor("user_info")).toHaveLength(0);
  });

  it("doesn't refresh the cache when the write fails", async () => {
    db.queue("user_info", { data: null, error: { message: "denied" } });
    expect(await setProfileVisibilityAction({ isPublic: true })).toMatchObject({ ok: false });
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
