const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * The only cache tags and paths the browser may ask to revalidate through
 * `revalidateCacheAction` / `revalidatePathAction` (RS-F12). Server code that
 * needs anything else calls `revalidateTag` / `revalidatePath` directly.
 */
const ALLOWED_TAGS = [new RegExp(`^job-${UUID}$`, "i"), new RegExp(`^profile-${UUID}$`, "i")];
const ALLOWED_PATHS = [new RegExp(`^/jobs/${UUID}$`, "i")];

export const isAllowedRevalidationTag = (tag: unknown) =>
  typeof tag === "string" && ALLOWED_TAGS.some((re) => re.test(tag));

export const isAllowedRevalidationPath = (path: unknown) =>
  typeof path === "string" && ALLOWED_PATHS.some((re) => re.test(path));
