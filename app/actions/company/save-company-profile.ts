"use server";

import { reportError } from "@/helpers/posthog/report-error";
import { revalidatePath } from "next/cache";
import { markMyOnboardingComplete } from "@/app/actions/update-user-metadata";
import {
  companyProfileSchema,
  LOGO_MAX_BYTES,
  LOGO_TYPES,
} from "@/helpers/companies/company-profile-schema";
import { embedCompanyProfile } from "@/helpers/companies/embed-company-profile";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const BUCKET_NAME = "images";

export type SaveCompanyProfileResult = { ok: true; logoUrl: string | null } | { ok: false; error: string };

/**
 * SERVER ACTION: saves the session company's profile (`company.profile`),
 * its logo and its embedding, and marks the user's onboarding complete.
 * FormData: `values` (JSON of `companyProfileSchema`), optional `logo` file,
 * `removeLogo` = "true" to drop the current logo.
 */
export async function saveCompanyProfileAction(formData: FormData): Promise<SaveCompanyProfileResult> {
  const auth = await requireCompanyForAction({ permission: "company.profile" });
  if (!auth.ok) return { ok: false, error: auth.error };
  const { supabase, company } = auth;

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("values") ?? ""));
  } catch {
    return { ok: false, error: "Check the form and try again." };
  }
  const parsed = companyProfileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const values = parsed.data;

  const logo = formData.get("logo");
  const newLogo = logo instanceof File && logo.size > 0 ? logo : null;
  if (newLogo) {
    if (!LOGO_TYPES.includes(newLogo.type)) return { ok: false, error: "Use a PNG, JPEG or WebP logo." };
    if (newLogo.size > LOGO_MAX_BYTES) return { ok: false, error: "The logo can be at most 900 KB." };
  }
  const removeLogo = formData.get("removeLogo") === "true";

  const { data: current, error: loadError } = await supabase
    .from("company_info")
    .select("logo_url")
    .eq("id", company.id)
    .maybeSingle();
  if (loadError || !current) return { ok: false, error: "Company profile not found." };

  let embedding: number[];
  try {
    embedding = await embedCompanyProfile(values);
  } catch (err) {
    reportError("[company-profile] embedding failed", err);
    return { ok: false, error: "An error occurred while saving information. Please try again." };
  }

  // The folder comes from the session company, never from input.
  const service = createServiceRoleClient();
  const storage = service.storage.from(BUCKET_NAME);
  const logoPath = `company_logos/${company.id}/logo`;
  let logoUrl = current.logo_url;
  if (newLogo) {
    const { error } = await storage.upload(logoPath, newLogo, {
      contentType: newLogo.type,
      cacheControl: "3600",
      upsert: true,
    });
    if (error) {
      reportError("[company-profile] logo upload failed", error.message);
      return { ok: false, error: "Couldn't upload the logo. Please try again." };
    }
    // A new query string, so the CDN and browsers don't keep the old logo.
    logoUrl = `${storage.getPublicUrl(logoPath).data.publicUrl}?v=${Date.now()}`;
  } else if (removeLogo) {
    await storage.remove([logoPath]);
    logoUrl = null;
  }

  // RLS (company.profile) and the column guard check this update too.
  const { data: saved, error: saveError } = await supabase
    .from("company_info")
    .update({ ...values, logo_url: logoUrl, filled: true })
    .eq("id", company.id)
    .select("id");
  if (saveError || !saved || saved.length === 0) {
    return { ok: false, error: "An error occurred while saving information. Please try again." };
  }

  // The column guard keeps embeddings away from non-owners, so the service
  // role writes it, scoped to the session company.
  const { error: embedError } = await service
    .from("company_info")
    .update({ embedding_new: embedding as unknown as string, updated_at: new Date().toISOString() })
    .eq("id", company.id);
  if (embedError) reportError("[company-profile] embedding save failed", embedError.message);

  const { error: metadataError } = await markMyOnboardingComplete("company");
  if (metadataError) return { ok: false, error: metadataError };

  revalidatePath("/company", "layout");
  return { ok: true, logoUrl };
}
