"use server";

import { createClient } from "@/lib/supabase/server";
import { setUserAppMetadata } from "@/helpers/user/set-app-metadata";

const ACCOUNT_TYPES = ["applicant", "company"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * Marks the signed-in user's onboarding complete (SEC-008).
 *
 * Server actions are public endpoints, and this one is imported by client
 * components, so it acts only on the session user and can only set
 * `onboarding_complete: true`. `type` can be chosen once, by a user who has
 * none yet; an existing type can't be changed.
 */
export async function markMyOnboardingComplete(
  type: AccountType,
): Promise<{ error: string | null }> {
  if (!ACCOUNT_TYPES.includes(type)) return { error: "Invalid account type." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication required." };

  const currentType = user.app_metadata?.type;
  if (currentType && currentType !== type) {
    return { error: "You can't change your account type." };
  }

  return setUserAppMetadata(user.id, { type, onboarding_complete: true });
}
