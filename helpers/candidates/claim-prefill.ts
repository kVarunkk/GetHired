import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import type { ClaimPrefill, ClaimPrefillFields } from "./claim-prefill-form";
import { hashClaimToken } from "./claim-token";
import { RESUME_BUCKET } from "./resume-files";

// BIT-105 (BI-REQ-043): after a claim, the person may start their own profile
// from the company's record. Nothing here writes the profile: the fields
// prefill the onboarding form, which saves only when they submit it (through
// the onboarding schema, the `user_info` allowlist).

/** The applicant upload limit (uploadResumeAction); imports allow 10 MB. */
const MAX_COPY_BYTES = 2 * 1024 * 1024;

type ClaimedCandidate = {
  companyName: string;
  candidate: {
    full_name: string;
    current_title: string | null;
    location: string | null;
    experience_years: number | null;
    skills: string[];
    links: Database["public"]["Tables"]["company_candidates"]["Row"]["links"];
    resume_path: string | null;
  };
};

/**
 * The company candidate behind a claim link, only when this user used the
 * link and the candidate is claimed by them. Anyone else (another account,
 * another company's link, an unused link) gets null.
 */
async function loadClaimedCandidate(
  admin: SupabaseClient<Database>,
  token: string,
  userId: string,
): Promise<ClaimedCandidate | null> {
  if (!/^[\w-]{20,200}$/.test(token)) return null;
  const { data, error } = await admin
    .from("company_candidate_claims")
    .select(
      "used_by, company_info(name), company_candidates(full_name, current_title, location, experience_years, skills, links, resume_path, claimed_user_id)",
    )
    .eq("token_hash", hashClaimToken(token))
    .eq("used_by", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the claim: ${error.message}`);
  const candidate = data?.company_candidates;
  if (!data || data.used_by !== userId || !candidate || candidate.claimed_user_id !== userId) return null;
  return { companyName: data.company_info?.name ?? "The company", candidate };
}

const link = (links: ClaimedCandidate["candidate"]["links"], key: string) => {
  const value = links && typeof links === "object" && !Array.isArray(links) ? links[key] : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const isPdf = (path: string | null): path is string => !!path && /\.pdf$/i.test(path);

/** What the onboarding form can prefill from the claim, or null when there's nothing. */
export async function loadClaimPrefill(
  admin: SupabaseClient<Database>,
  token: string,
  userId: string,
): Promise<ClaimPrefill | null> {
  const claimed = await loadClaimedCandidate(admin, token, userId);
  if (!claimed) return null;
  const { candidate } = claimed;
  const fields: ClaimPrefillFields = {
    full_name: candidate.full_name.trim(),
    desired_roles: candidate.current_title?.trim() ? [candidate.current_title.trim()] : [],
    preferred_locations: candidate.location ? await canonicalizeLocations([candidate.location]) : [],
    experience_years: candidate.experience_years,
    top_skills: candidate.skills.filter((skill) => skill.trim()),
    linkedin_url: link(candidate.links, "linkedin"),
    github_url: link(candidate.links, "github"),
  };
  const resume = isPdf(candidate.resume_path) ? { name: `Resume from ${claimed.companyName}.pdf` } : null;
  return { companyName: claimed.companyName, fields, resume };
}

/** Whether the claim page should offer the prefill: there's something to use. */
export function hasPrefill(prefill: ClaimPrefill | null): prefill is ClaimPrefill {
  if (!prefill) return false;
  const { fields } = prefill;
  return (
    !!prefill.resume ||
    fields.desired_roles.length > 0 ||
    fields.preferred_locations.length > 0 ||
    fields.top_skills.length > 0 ||
    fields.experience_years != null
  );
}

/**
 * Copies the claimed candidate's resume into the user's own resumes, as a
 * new (not primary) resume, and returns its id. `supabase` is the user's
 * client, so the upload and insert go through the same storage and RLS as
 * an onboarding upload; `admin` only reads the company's file.
 */
export async function copyClaimResume(
  supabase: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  userId: string,
  token: string,
): Promise<{ ok: true; resumeId: string } | { ok: false; error: string }> {
  const claimed = await loadClaimedCandidate(admin, token, userId);
  const path = claimed?.candidate.resume_path ?? null;
  if (!claimed || !isPdf(path)) return { ok: false, error: "That resume is no longer available. Upload your own." };

  const { data: file, error: downloadError } = await admin.storage.from(RESUME_BUCKET).download(path);
  if (downloadError || !file) throw new Error(`Failed to read the resume: ${downloadError?.message ?? "no file"}`);
  if (file.size > MAX_COPY_BYTES) {
    return { ok: false, error: "That resume is larger than 2 MB. Upload your own." };
  }

  const name = `Resume from ${claimed.companyName}.pdf`;
  const fileName = `resumes/${userId}/${Date.now()}-${name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
  const { error: storageError } = await supabase.storage
    .from("resumes")
    .upload(fileName, Buffer.from(await file.arrayBuffer()), { contentType: "application/pdf" });
  if (storageError) throw storageError;

  const { data: resume, error: insertError } = await supabase
    .from("resumes")
    .insert({ user_id: userId, name, resume_path: fileName, is_primary: false, content: null })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return { ok: true, resumeId: resume.id };
}
