import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireApplicant } from "./auth";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

let supabase: SupabaseMock;

beforeEach(() => {
  supabase = createSupabaseMock();
});

describe("requireApplicant", () => {
  it("returns the applicant and a request-scoped client", async () => {
    const user = mockUser({ id: "u1" });
    await setRequestUser(user, supabase.client);

    expect(await requireApplicant()).toEqual({ ok: true, user, supabase: supabase.client });
  });

  it("responds 401 without a user", async () => {
    await setRequestUser(null, supabase.client);

    const result = await requireApplicant();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual({ error: "Unauthorized" });
  });

  it("responds 403 for company users", async () => {
    await setRequestUser(mockUser({ type: "company" }), supabase.client);

    const result = await requireApplicant();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({
      error: "The agent is only available to job seekers.",
    });
  });
});
