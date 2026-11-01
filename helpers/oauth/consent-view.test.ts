/**
 * What the consent page shows about the app asking for access (MCP-SEC-012,
 * MCP TASK-004). Dynamic registration lets anyone register a client called
 * "Claude", so the page shows where the code really goes.
 */
import { describe, expect, it } from "vitest";
import { consentLoginPath, consentView } from "./consent-view";

describe("consentView", () => {
  it.each([
    ["Claude", "https://claude.ai/api/mcp/auth_callback", "claude.ai"],
    ["ChatGPT", "https://chatgpt.com/connector_platform_oauth_redirect", "chatgpt.com"],
    ["Cursor", "cursor://anysphere.cursor-retrieval/oauth/user-gethired/callback", "anysphere.cursor-retrieval"],
    ["Visual Studio Code", "https://vscode.dev/redirect", "vscode.dev"],
  ])("matches %s to %s", (clientName, redirectUri, host) => {
    expect(consentView({ clientName, redirectUri })).toEqual({
      clientName,
      redirectHost: host,
      isLocal: false,
      nameMatchesHost: true,
    });
  });

  it("warns when the name doesn't match where the code goes", () => {
    expect(consentView({ clientName: "Claude", redirectUri: "https://evil.example/cb" })).toMatchObject({
      redirectHost: "evil.example",
      nameMatchesHost: false,
    });
  });

  it("doesn't count generic words as a match", () => {
    expect(
      consentView({ clientName: "My MCP Client", redirectUri: "https://mcp-client.example/cb" }),
    ).toMatchObject({ nameMatchesHost: false });
  });

  it.each(["http://localhost:6274/oauth/callback", "http://127.0.0.1:33418/", "http://[::1]:8080/cb"])(
    "treats %s as an app on this device, without the warning",
    (redirectUri) => {
      expect(consentView({ clientName: "Claude Code", redirectUri })).toMatchObject({
        isLocal: true,
        nameMatchesHost: true,
      });
    },
  );

  it("warns when the redirect URI can't be read", () => {
    expect(consentView({ clientName: "Claude", redirectUri: "not a url" })).toEqual({
      clientName: "Claude",
      redirectHost: null,
      isLocal: false,
      nameMatchesHost: false,
    });
  });

  it("falls back to a placeholder name", () => {
    expect(consentView({ clientName: "  ", redirectUri: "https://claude.ai/cb" }).clientName).toBe(
      "An unnamed app",
    );
  });
});

describe("consentLoginPath", () => {
  it("encodes the whole return path, so its query survives the login redirect", () => {
    const path = consentLoginPath("abc&returnTo=https://evil.example");
    const returnTo = new URL(path, "http://localhost").searchParams.get("returnTo");

    expect(new URL(path, "http://localhost").pathname).toBe("/auth/login");
    expect(returnTo).toBe("/oauth/consent?authorization_id=abc%26returnTo%3Dhttps%3A%2F%2Fevil.example");
    expect(new URL(returnTo!, "http://localhost").searchParams.get("authorization_id")).toBe(
      "abc&returnTo=https://evil.example",
    );
  });
});
