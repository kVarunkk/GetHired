"use server";

import { revalidateTag } from "next/cache";

/**
 * Tag that no fetch or cache uses, so revalidating it purges nothing on the
 * server. It only marks the action as revalidating.
 */
const ROUTER_CACHE_TAG = "client-router-cache";

/**
 * Makes the calling browser drop its client router cache. A server action
 * that revalidates anything does that, so after signing in the next
 * router.push fetches fresh instead of replaying what was cached while signed
 * out. For a protected page that's the middleware's redirect to login, e.g.
 * from the landing banner's prefetched /agent link, which Next also reuses for
 * /agent?prompt=….
 */
export async function clearRouterCacheAction() {
  revalidateTag(ROUTER_CACHE_TAG);
}
