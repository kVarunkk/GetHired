/**
 * RFC 9728 protected resource metadata for /api/mcp (MCP TASK-032, MCP-SEC-007).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildRequest } from "@/test/utils/request";
import { mcpResourceUrl } from "@/helpers/mcp/config";
import { GET } from "./route";

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
});

const get = (path?: string[]) => {
  const suffix = path ? `/${path.join("/")}` : "";
  return GET(buildRequest(`/.well-known/oauth-protected-resource${suffix}`), {
    params: Promise.resolve({ path }),
  });
};

describe("GET /.well-known/oauth-protected-resource", () => {
  it.each([[["api", "mcp"]], [undefined]])("serves the MCP resource's metadata for %j", async (path) => {
    const res = await get(path);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      resource: mcpResourceUrl(),
      authorization_servers: ["https://project.supabase.co/auth/v1"],
      bearer_methods_supported: ["header"],
      resource_name: "GetHired",
      resource_documentation: expect.stringMatching(/\/mcp$/),
    });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("answers the same document whatever the query (RMCP spec §4.5)", async () => {
    const plain = await (await get(["api", "mcp"])).json();
    const res = await GET(buildRequest("/.well-known/oauth-protected-resource/api/mcp?toolsets=jobs&readonly=true"), {
      params: Promise.resolve({ path: ["api", "mcp"] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(plain);
  });

  it("names this app's MCP endpoint as the resource", () => {
    expect(mcpResourceUrl()).toMatch(/\/api\/mcp$/);
  });

  it.each([[["api", "jobs"]], [["api"]], [["api", "mcp", "extra"]]])("answers 404 for %j", async (path) => {
    const res = await get(path);

    expect(res.status).toBe(404);
  });
});
