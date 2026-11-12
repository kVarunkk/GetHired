/**
 * The MCP SDK advertises a tool's input through Standard Schema's
 * `~standard.jsonSchema`, which zod 3 doesn't have (MCP spec §4.5, §10).
 * This keeps zod's own validation and takes the JSON Schema from the AI SDK,
 * so an MCP client sees the same schema as the agent's model.
 */
import { asSchema } from "ai";
import type { StandardSchemaV1, StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { z } from "zod";

type JsonObject = Record<string, unknown>;

/** The confirm tools' extra input for the two-step fallback (§4.6 path B). */
export const CONFIRMATION_TOKEN_KEY = "confirmation_token";

const CONFIRMATION_TOKEN_JSON = {
  type: "string",
  description:
    "Leave out on the first call, which returns a preview and this token. Once the user approves the preview, call again with the same input plus the token.",
};

/**
 * MCP-only descriptions for a tool's inputs, keyed by path: property names
 * joined with dots, `*` for an array's items. A path reaches into every
 * `anyOf` branch that has it (update_resume's operations). The agent keeps
 * its own descriptions: its schemas are pinned by the applicant baseline.
 */
export type McpInputDescriptions = Readonly<Record<string, string>>;

const isObject = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function nodesAt(node: JsonObject, path: readonly string[]): JsonObject[] {
  if (path.length === 0) return [node];
  const [segment, ...rest] = path;
  const branches = Array.isArray(node.anyOf) ? node.anyOf.filter(isObject) : [node];
  return branches.flatMap((branch) => {
    const next = segment === "*" ? branch.items : (branch.properties as JsonObject | undefined)?.[segment];
    return isObject(next) ? nodesAt(next, rest) : [];
  });
}

/** Sets each description on a copy of the schema. A path that matches nothing is a catalog bug. */
export function describeInputs(jsonSchema: JsonObject, descriptions: McpInputDescriptions): JsonObject {
  const described = structuredClone(jsonSchema);
  for (const [path, description] of Object.entries(descriptions)) {
    const nodes = nodesAt(described, path.split("."));
    if (nodes.length === 0) throw new Error(`No input at ${path} to describe.`);
    for (const node of nodes) node.description = description;
  }
  return described;
}

type Validate = StandardSchemaV1["~standard"]["validate"];

/**
 * Takes the confirmation_token out before the tool's own schema sees the
 * input (the agent's schemas are strict), then puts it back on the value.
 */
function jsonSchemaOf(schema: z.ZodTypeAny): JsonObject {
  const json = asSchema(schema).jsonSchema;
  if (typeof (json as PromiseLike<unknown>).then === "function") {
    throw new Error("toMcpSchema needs a schema whose JSON Schema is available synchronously.");
  }
  // The JSON Schema dialect is the server's to declare, not each tool's.
  const { $schema: _dialect, ...jsonSchema } = json as JsonObject;
  void _dialect;
  return jsonSchema;
}

function withConfirmationToken(validate: Validate): Validate {
  return async (value) => {
    if (!value || typeof value !== "object" || !(CONFIRMATION_TOKEN_KEY in value)) {
      return validate(value);
    }
    const { [CONFIRMATION_TOKEN_KEY]: token, ...rest } = value as JsonObject;
    if (token !== undefined && typeof token !== "string") {
      return {
        issues: [{ message: `${CONFIRMATION_TOKEN_KEY} must be a string.`, path: [CONFIRMATION_TOKEN_KEY] }],
      };
    }
    const result = await validate(rest);
    if (result.issues || token === undefined) return result;
    return { value: { ...(result.value as JsonObject), [CONFIRMATION_TOKEN_KEY]: token } };
  };
}

export function toMcpSchema(
  schema: z.ZodTypeAny,
  {
    confirmationToken = false,
    descriptions,
  }: { confirmationToken?: boolean; descriptions?: McpInputDescriptions } = {},
): StandardSchemaWithJSON {
  const own = jsonSchemaOf(schema);
  const jsonSchema = descriptions ? describeInputs(own, descriptions) : own;
  if (confirmationToken) {
    jsonSchema.properties = {
      ...(jsonSchema.properties as JsonObject | undefined),
      [CONFIRMATION_TOKEN_KEY]: CONFIRMATION_TOKEN_JSON,
    };
  }

  const validate = schema["~standard"].validate as Validate;
  return {
    "~standard": {
      version: 1,
      vendor: "zod",
      validate: confirmationToken ? withConfirmationToken(validate) : validate,
      jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
    },
  } as StandardSchemaWithJSON;
}

/**
 * A tool's outputSchema (MCP spec 2026-07-28, tools §outputSchema). The SDK
 * checks each successful result's structuredContent against it, and error
 * results (isError) skip the check.
 */
export function toMcpOutputSchema(schema: z.ZodTypeAny): StandardSchemaWithJSON {
  const jsonSchema = jsonSchemaOf(schema);
  return {
    "~standard": {
      version: 1,
      vendor: "zod",
      validate: schema["~standard"].validate as Validate,
      jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
    },
  } as StandardSchemaWithJSON;
}
