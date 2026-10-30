/**
 * Agent tool outputs as MCP tool results (MCP spec §4.5).
 */
import type { CallToolResult } from "@modelcontextprotocol/server";
import { INSUFFICIENT_CREDITS } from "@/helpers/agent/tools/shared";
import { deploymentUrl } from "@/utils/formatters";

// Links in tool outputs are app paths ("/jobs/<id>"); an MCP client needs the full URL.
const isLinkKey = (key: string) => key === "url" || key.endsWith("Url");

function absoluteLinks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(absoluteLinks);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isLinkKey(key) && typeof entry === "string" && entry.startsWith("/") && !entry.startsWith("//")
        ? `${deploymentUrl()}${entry}`
        : absoluteLinks(entry),
    ]),
  );
}

export function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

/** `structuredContent` plus the same JSON as text, as the MCP spec says it SHOULD be. */
export function jsonResult(value: Record<string, unknown>, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * An agent tool's output as an MCP result: `{ error }` becomes `isError` with
 * that text, anything else is `structuredContent` plus the same JSON as text.
 */
export function toCallToolResult(output: unknown): CallToolResult {
  const result = absoluteLinks(output ?? {}) as Record<string, unknown>;
  // A plain sentence the model can pass on, with the full link (§4.7).
  if (result.error === INSUFFICIENT_CREDITS.error) {
    return textResult(
      `${INSUFFICIENT_CREDITS.message} The user can buy more at ${deploymentUrl()}${INSUFFICIENT_CREDITS.rechargeUrl}.`,
      true,
    );
  }
  // A recruiter allowance ran out (planLimitError): its sentence plus the full upgrade link (RMCP-REQ-006).
  if (result.error === "PLAN_LIMIT" && typeof result.message === "string") {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { error, message, upgradeUrl, ...rest } = result;
    const text = `${message}${typeof upgradeUrl === "string" ? ` The user can upgrade at ${upgradeUrl}.` : ""}`;
    return textResult(Object.keys(rest).length ? `${text} ${JSON.stringify(rest)}` : text, true);
  }
  if (typeof result.error === "string") {
    const onlyError = Object.keys(result).length === 1;
    return textResult(onlyError ? result.error : JSON.stringify(result), true);
  }
  return jsonResult(result);
}
