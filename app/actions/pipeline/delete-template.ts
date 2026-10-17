"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";

const inputSchema = z.object({ templateId: z.string().uuid() }).strict();

/**
 * SERVER ACTION: deletes one of the session company's own templates. The
 * seeded default of each purpose can be edited but not deleted, so every move
 * always has a template to offer.
 */
export async function deleteTemplateAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "settings.templates" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Template not found." };

  const { data, error } = await auth.supabase
    .from("company_email_templates")
    .delete()
    .eq("id", parsed.data.templateId)
    .eq("company_id", auth.company.id)
    .eq("is_default", false)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: "Couldn't delete the template. Please try again." };
  if (!data) return { ok: false, error: "Template not found, or it's a default template." };

  revalidatePath("/company/settings");
  return { ok: true };
}
