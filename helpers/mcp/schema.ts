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
    "Only when confirming: the confirmation_token from this tool's earlier preview, sent with the same input once the user has said yes.",
};

type Validate = StandardSchemaV1["~standard"]["validate"];

/**
 * Takes the confirmation_token out before the tool's own schema sees the
 * input (the agent's schemas are strict), then puts it back on the value.
 */
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
  { confirmationToken = false }: { confirmationToken?: boolean } = {},
): StandardSchemaWithJSON {
  const json = asSchema(schema).jsonSchema;
  if (typeof (json as PromiseLike<unknown>).then === "function") {
    throw new Error("toMcpSchema needs a schema whose JSON Schema is available synchronously.");
  }
  // The JSON Schema dialect is the server's to declare, not each tool's.
  const { $schema: _dialect, ...jsonSchema } = json as JsonObject;
  void _dialect;
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
