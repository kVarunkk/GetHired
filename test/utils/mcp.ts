import { CLIENT_CAPABILITIES_META_KEY } from "@modelcontextprotocol/server";

export const MODERN_PROTOCOL = "2026-07-28";

type RequestOptions = {
  /** Client capabilities sent in the 2026 `_meta` envelope. */
  capabilities?: Record<string, unknown>;
  headers?: Record<string, string>;
  url?: string;
};

/** A 2026-07-28 MCP request: the `_meta` envelope plus the Mcp-* headers. */
export function modernRequest(
  method: string,
  params: Record<string, unknown>,
  { capabilities = {}, headers = {}, url = "http://localhost:3000/api/mcp" }: RequestOptions = {},
) {
  const name = typeof params.name === "string" ? params.name : undefined;
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": MODERN_PROTOCOL,
      "mcp-method": method,
      ...(name ? { "mcp-name": name } : {}),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL,
          [CLIENT_CAPABILITIES_META_KEY]: capabilities,
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
        },
      },
    }),
  });
}

/** A 2025-era request (no envelope), served by the stateless legacy path. */
export function legacyRequest(
  body: unknown,
  { headers = {}, url = "http://localhost:3000/api/mcp" }: Omit<RequestOptions, "capabilities"> = {},
) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** Reads a JSON-RPC response from a JSON body or a one-event SSE stream. */
export async function rpc(res: Response) {
  const text = await res.text();
  const json = res.headers.get("content-type")?.includes("text/event-stream")
    ? text.split("\n").find((line) => line.startsWith("data: "))!.slice(6)
    : text;
  return { status: res.status, body: JSON.parse(json) };
}
