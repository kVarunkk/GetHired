"use server";

import { randomUUID } from "node:crypto";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/**
 * SERVER ACTION (CP-REQ-009, CP-SEC-002): uploads a careers cover image to
 * the public `careers` bucket under the session company's folder and returns
 * its URL. PNG, JPEG or WebP, at most 2 MB. Saving the page stores the URL.
 */
export async function uploadCareersImageAction(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "careers.edit" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image." };
  const ext = TYPES[file.type];
  if (!ext) return { ok: false, error: "Use a PNG, JPEG or WebP image." };
  if (file.size > MAX_BYTES) return { ok: false, error: "Images can be at most 2 MB." };

  // The folder comes from the session, never from input.
  const path = `${auth.company.id}/cover-${randomUUID()}.${ext}`;
  const storage = createServiceRoleClient().storage.from("careers");
  const { error } = await storage.upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    console.error("[careers] upload failed", error.message);
    return { ok: false, error: "Couldn't upload the image. Please try again." };
  }
  return { ok: true, url: storage.getPublicUrl(path).data.publicUrl };
}
