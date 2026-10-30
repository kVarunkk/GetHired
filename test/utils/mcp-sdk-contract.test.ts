/**
 * Pins the MCP server SDK behaviour /api/mcp depends on (MCP spec §10,
 * TASK-010/011). If an SDK upgrade renames or reshapes any of these, this
 * file fails first.
 */
import { describe, expect, it } from "vitest";
import {
  McpServer,
  acceptedContent,
  createMcpHandler,
  createRequestStateCodec,
  hostHeaderValidationResponse,
  inputRequired,
  originValidationResponse,
  type ServerContext,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  legacyRequest as legacyMcpRequest,
  modernRequest as modernMcpRequest,
  rpc,
} from "./mcp";

const authInfo = { token: "t", clientId: "client-1", scopes: [], extra: { userId: "u1" } };
const modernRequest = (
  method: string,
  params: Record<string, unknown>,
  capabilities: Record<string, unknown> = {},
) => modernMcpRequest(method, params, { capabilities, url: "http://localhost/api/mcp" });
const legacyRequest = (body: unknown) => legacyMcpRequest(body, { url: "http://localhost/api/mcp" });

const zod3 = z.object({ limit: z.number().int().optional() });

describe("MCP server SDK contract", () => {
  it("zod 3 schemas have no ~standard.jsonSchema, so tools/list can't advertise them", async () => {
    expect(Object.keys(zod3["~standard"])).not.toContain("jsonSchema");

    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: "t", version: "0" });
      server.registerTool(
        "t",
        { inputSchema: zod3 as unknown as StandardSchemaWithJSON },
        async () => ({ content: [] }),
      );
      return server;
    });
    const { body } = await rpc(await handler.fetch(modernRequest("tools/list", {})));

    expect(body.error.message).toMatch(/zod 3/);
  });

  it("serves a modern tools/call, validates arguments and passes authInfo through", async () => {
    let seen: ServerContext | undefined;
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: "t", version: "0" });
      server.registerTool(
        "t",
        {
          inputSchema: {
            "~standard": {
              version: 1,
              vendor: "test",
              validate: zod3["~standard"].validate,
              jsonSchema: { input: () => ({ type: "object" }), output: () => ({ type: "object" }) },
            },
          } as StandardSchemaWithJSON,
        },
        async (_args, ctx) => {
          seen = ctx;
          return { content: [{ type: "text", text: "ran" }], structuredContent: { ok: true } };
        },
      );
      return server;
    });

    const ok = await rpc(
      await handler.fetch(modernRequest("tools/call", { name: "t", arguments: {} }), { authInfo }),
    );
    expect(ok.body.result.structuredContent).toEqual({ ok: true });
    expect(seen?.http?.authInfo).toEqual(authInfo);

    const bad = await rpc(
      await handler.fetch(modernRequest("tools/call", { name: "t", arguments: { limit: "x" } }), {
        authInfo,
      }),
    );
    expect(bad.body.result.isError).toBe(true);
  });

  describe("inputRequired (§4.6 path A)", () => {
    function confirmHandler() {
      return createMcpHandler(() => {
        const server = new McpServer({ name: "t", version: "0" });
        server.registerTool("confirm", {}, async (ctx: ServerContext) => {
          const answer = acceptedContent<{ confirm: boolean }>(ctx.mcpReq.inputResponses, "confirm");
          if (answer) return { content: [{ type: "text", text: `confirm=${answer.confirm}` }] };
          return inputRequired({
            inputRequests: {
              confirm: inputRequired.elicit({
                message: "Apply?",
                requestedSchema: {
                  type: "object",
                  properties: { confirm: { type: "boolean" } },
                  required: ["confirm"],
                },
              }),
            },
            requestState: "state-1",
          });
        });
        return server;
      });
    }

    it.each([{ form: {} }, {}])(
      "asks a modern client that declares elicitation %j, and runs on the retry",
      async (elicitation) => {
        const handler = confirmHandler();
        const first = await rpc(
          await handler.fetch(
            modernRequest("tools/call", { name: "confirm", arguments: {} }, { elicitation }),
          ),
        );
        expect(first.body.result).toMatchObject({
          resultType: "input_required",
          requestState: "state-1",
        });

        const retry = await rpc(
          await handler.fetch(
            modernRequest(
              "tools/call",
              {
                name: "confirm",
                arguments: {},
                inputResponses: { confirm: { action: "accept", content: { confirm: true } } },
                requestState: "state-1",
              },
              { elicitation },
            ),
          ),
        );
        expect(retry.body.result.content[0].text).toBe("confirm=true");
      },
    );

    it("is a hard -32021 error when the modern client can't elicit, so callers must check first", async () => {
      const { status, body } = await rpc(
        await confirmHandler().fetch(
          modernRequest("tools/call", { name: "confirm", arguments: {} }),
        ),
      );
      expect(status).toBe(400);
      expect(body.error.code).toBe(-32021);
    });

    it("can't elicit on the stateless legacy path, so 2025 clients need path B", async () => {
      const { body } = await rpc(
        await confirmHandler().fetch(
          legacyRequest({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "confirm", arguments: {} },
          }),
        ),
      );
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toMatch(/per-request legacy serving/);
    });
  });

  describe("legacy (2025) serving", () => {
    const handler = createMcpHandler(() => new McpServer({ name: "t", version: "0" }));

    it("answers initialize statelessly", async () => {
      const { body } = await rpc(
        await handler.fetch(
          legacyRequest({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "l", version: "1" },
            },
          }),
        ),
      );
      expect(body.result.protocolVersion).toBe("2025-06-18");
    });

    it("answers GET with 405", async () => {
      const res = await handler.fetch(
        new Request("http://localhost/api/mcp", {
          method: "GET",
          headers: { accept: "text/event-stream" },
        }),
      );
      expect(res.status).toBe(405);
    });
  });

  it("exports the request-state codec and the Origin/Host checks", () => {
    expect(typeof createRequestStateCodec).toBe("function");
    expect(typeof originValidationResponse).toBe("function");
    expect(typeof hostHeaderValidationResponse).toBe("function");
  });
});
