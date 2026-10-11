import { vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

type MockUserOptions = Partial<Omit<User, "app_metadata">> & {
  type?: "applicant" | "company";
  onboardingComplete?: boolean;
};

/** A Supabase `User` shaped like the ones the middleware and routes expect. */
export function mockUser({
  type = "applicant",
  onboardingComplete = true,
  ...overrides
}: MockUserOptions = {}): User {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    email: "user@example.com",
    created_at: "2026-01-01T00:00:00.000Z",
    user_metadata: {},
    ...overrides,
    app_metadata: { type, onboarding_complete: onboardingComplete },
  } as User;
}

/**
 * Sets the user (and optionally the Supabase client) seen by route handlers.
 *
 * The calling test file must mock both modules first:
 *   vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
 *   vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
 */
export async function setRequestUser(
  user: User | null,
  supabase?: SupabaseClient<Database>,
) {
  vi.mocked(getUserFromRequest).mockResolvedValue(user);
  if (supabase) {
    vi.mocked(createClient).mockResolvedValue(supabase);
  }
}
