/**
 * The zod 3 → MCP schema adapter (MCP spec §4.5, TASK-041).
 */
import { describe, expect, it } from "vitest";
import { asSchema } from "ai";
import { z } from "zod";
import { toMcpSchema } from "./schema";

const schema = z.object({
  jobId: z.string().uuid().describe("The job id."),
  limit: z.number().int().min(1).max(50).optional(),
  action: z.enum(["save", "unsave"]).default("save"),
});

describe("toMcpSchema", () => {
  it("advertises the same JSON Schema the agent's model sees, without a dialect", async () => {
    const { $schema: _dialect, ...agentJson } = (await asSchema(schema).jsonSchema) as Record<string, unknown>;
    void _dialect;

    const mcp = toMcpSchema(schema)["~standard"].jsonSchema;

    expect(mcp.input({ target: "draft-2020-12" })).toEqual(agentJson);
    expect(mcp.input({ target: "draft-2020-12" })).toMatchObject({
      type: "object",
      required: ["jobId"],
      properties: { jobId: { type: "string", description: "The job id." } },
    });
    expect(mcp.input({ target: "draft-2020-12" })).not.toHaveProperty("$schema");
  });

  it("validates with zod, applying defaults", async () => {
    const validate = toMcpSchema(schema)["~standard"].validate;

    expect(await validate({ jobId: "11111111-1111-4111-8111-111111111111" })).toEqual({
      value: { jobId: "11111111-1111-4111-8111-111111111111", action: "save" },
    });
    expect(await validate({ jobId: "nope" })).toHaveProperty("issues");
  });
});

describe("toMcpSchema with a confirmation_token (§4.6 path B)", () => {
  const strict = z
    .object({ desiredRoles: z.array(z.string()).optional() })
    .strict()
    .refine((input) => Object.keys(input).length > 0, { message: "Provide at least one." });
  const withToken = toMcpSchema(strict, { confirmationToken: true })["~standard"];

  it("advertises an optional confirmation_token next to the tool's own fields", () => {
    const json = withToken.jsonSchema.input({ target: "draft-2020-12" }) as {
      properties: Record<string, { type: string }>;
      required?: string[];
    };

    expect(json.properties.confirmation_token).toMatchObject({ type: "string" });
    expect(json.properties.desiredRoles).toBeDefined();
    expect(json.required ?? []).not.toContain("confirmation_token");
  });

  it("validates the rest with the tool's own schema, strict and refined, and keeps the token", async () => {
    expect(await withToken.validate({ desiredRoles: ["Designer"], confirmation_token: "v1.a.b" })).toEqual({
      value: { desiredRoles: ["Designer"], confirmation_token: "v1.a.b" },
    });
    expect(await withToken.validate({ desiredRoles: ["Designer"] })).toEqual({
      value: { desiredRoles: ["Designer"] },
    });
    expect(await withToken.validate({ confirmation_token: "v1.a.b" })).toHaveProperty("issues");
    expect(await withToken.validate({ desiredRoles: ["Designer"], other: 1 })).toHaveProperty("issues");
    expect(await withToken.validate({ desiredRoles: ["Designer"], confirmation_token: 7 })).toHaveProperty("issues");
  });
});
