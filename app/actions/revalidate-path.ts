"use server";

import { revalidatePath } from "next/cache";
import { isAllowedRevalidationPath } from "@/helpers/cache/revalidation-allowlist";

export async function revalidatePathAction(path: string) {
  if (!isAllowedRevalidationPath(path)) return { success: false };

  revalidatePath(path);

  return {
    success: true,
  };
}
