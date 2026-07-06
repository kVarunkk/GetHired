"use server";

import { revalidateTag } from "next/cache";

export async function revalidateCacheAction(tag: string) {
  revalidateTag(tag);

  return {
    success: true,
  };
}
