import { revalidateTag } from "next/cache";
import { describe, expect, it } from "vitest";
import { clearRouterCacheAction } from "./clear-router-cache";

describe("clearRouterCacheAction", () => {
  // Any revalidation makes the action's response clear the client router
  // cache. The tag is used by nothing, so the server cache is untouched.
  it("revalidates only its own unused tag", async () => {
    await clearRouterCacheAction();
    expect(revalidateTag).toHaveBeenCalledWith("client-router-cache");
  });
});
