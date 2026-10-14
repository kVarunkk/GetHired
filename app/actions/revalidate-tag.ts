"use server";

import { revalidateTag } from "next/cache";
import { isAllowedRevalidationTag } from "@/helpers/cache/revalidation-allowlist";

export async function revalidateCacheAction(tag: string) {
  if (!isAllowedRevalidationTag(tag)) return { success: false };

  revalidateTag(tag);

  return {
    success: true,
  };
}
